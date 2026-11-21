import { config } from '../config.js'
import { log } from './logger.js'
import { isAllowedTarget, upstreamHeaders } from './net.js'

/**
 * Vyora TV - Turbo prebuffer
 * ------------------------------------------------------------------
 * The single biggest reason a channel took seconds to appear was that the
 * manifest had to be fetched from the broadcaster's CDN *after* the user
 * pressed OK, and the first media segment was a second round trip.
 *
 * This pool keeps hot channels "already running":
 *   - the manifest is fetched in the background (hover / focus / list view)
 *   - the first media segments are pulled into memory while the user browses
 *   - a live playlist is refreshed continuously so the buffer stays at the
 *     live edge
 *
 * When the user finally clicks, the server answers from memory: no upstream
 * round trip, no waiting -> the picture appears in milliseconds.
 */

const MANIFEST_FRESH_MS = 5000 // a cached manifest younger than this is "fresh"
const SLOT_HOT_MS = 90_000 // a slot stays hot (refreshing) this long after use
const SEGMENT_TTL_MS = 90_000
const MAX_SEGMENTS = 400
const MAX_SEGMENT_BYTES = 8 * 1024 * 1024
const MAX_SLOTS = 120
const MAX_LIVE_SLOTS = 14 // how many channels may keep a live refresh loop
const SEGMENTS_PER_WARM = 3

export class WarmPool {
  constructor({ concurrency = Number(process.env.WARM_PARALLEL || 8) } = {}) {
    this.slots = new Map() // key -> slot
    this.segments = new Map() // absolute segment url -> { data, contentType, ts }
    this.queue = [] // pending jobs
    this.running = 0
    this.concurrency = concurrency
    this.inflight = new Map() // key -> Promise
    this.liveCount = 0
    this.stats = { warmed: 0, hits: 0, misses: 0, bytes: 0, failed: 0 }
  }

  /* ---------------------------------------------------------------- */
  /* keys                                                              */
  /* ---------------------------------------------------------------- */

  key(target, referer, ua) {
    return `${target}|${referer || ''}|${ua || ''}`
  }

  slotFor(target, referer, ua) {
    const key = this.key(target, referer, ua)
    let slot = this.slots.get(key)
    if (!slot) {
      slot = {
        key,
        target,
        referer: referer || '',
        ua: ua || '',
        text: '',
        ts: 0,
        finalUrl: target,
        live: false,
        targetDuration: 6,
        timer: null,
        hits: 0,
      }
      this.slots.set(key, slot)
      if (this.slots.size > MAX_SLOTS) {
        // drop the coldest slot
        let oldestKey = null
        let oldestTs = Infinity
        for (const [k, s] of this.slots) {
          if (s.timer) continue // never drop a live slot
          if (s.ts < oldestTs) {
            oldestTs = s.ts
            oldestKey = k
          }
        }
        if (oldestKey) {
          this.slots.delete(oldestKey)
          this.inflight.delete(oldestKey)
        }
      }
    }
    return slot
  }

  /* ---------------------------------------------------------------- */
  /* public API                                                        */
  /* ---------------------------------------------------------------- */

  /** Queue a channel for prebuffering (low latency, non blocking). */
  enqueue(target, { referer, ua } = {}, priority = 0) {
    if (!target) return
    const slot = this.slotFor(target, referer, ua)
    slot.lastUsed = Date.now()
    const fresh = slot.text && Date.now() - slot.ts < MANIFEST_FRESH_MS
    if (fresh) {
      this.stats.hits++
      return
    }
    if (this.inflight.has(slot.key)) {
      // already being fetched - just raise its priority
      const job = this.queue.find((j) => j.slot.key === slot.key)
      if (job) job.priority = Math.max(job.priority, priority)
      return
    }
    this.queue.push({ slot, priority })
    this.queue.sort((a, b) => b.priority - a.priority)
    if (this.queue.length > 400) this.queue.length = 400
    this.pump()
  }

  /**
   * Fetch (or reuse) a manifest. Concurrent callers share one upstream
   * request, so a click during a background warm costs nothing extra.
   */
  async manifest(target, { referer, ua } = {}, timeoutMs = 0) {
    const slot = this.slotFor(target, referer, ua)
    slot.lastUsed = Date.now()
    if (slot.text && Date.now() - slot.ts < MANIFEST_FRESH_MS) {
      this.stats.hits++
      return { ok: true, text: slot.text, cached: true, ms: 0 }
    }
    const existing = this.inflight.get(slot.key)
    if (existing) {
      this.stats.hits++
      return existing
    }
    const job = this.runJob(slot, timeoutMs)
    this.inflight.set(slot.key, job)
    try {
      return await job
    } finally {
      this.inflight.delete(slot.key)
    }
  }

  /**
   * Race several sources of the same channel and return the first one that
   * answers. One slow / dead CDN never delays the picture again.
   */
  async race(streams, { timeoutMs = 3500, limit = 4 } = {}) {
    const list = (streams || []).slice(0, limit)
    if (!list.length) return null
    if (list.length === 1) {
      const only = list[0]
      const res = await this.manifest(only.url, { referer: only.referer, ua: only.ua }, timeoutMs)
      return res.ok ? { index: 0, stream: only, ms: res.ms || 0, cached: !!res.cached } : null
    }
    const attempts = list.map(async (s, i) => {
      const res = await this.manifest(s.url, { referer: s.referer, ua: s.ua }, timeoutMs)
      if (!res.ok) throw new Error(res.error || `stream ${i} failed`)
      return { index: i, stream: s, ms: res.ms || 0, cached: !!res.cached }
    })
    try {
      return await Promise.any(attempts)
    } catch {
      return null
    }
  }

  /** Cached media segment (already downloaded while the user browsed). */
  getSegment(url) {
    const hit = this.segments.get(url)
    if (!hit) return null
    if (Date.now() - hit.ts > SEGMENT_TTL_MS) {
      this.segments.delete(url)
      return null
    }
    return hit
  }

  /** Fresh manifest copy (no upstream round trip needed). */
  peek(target, { referer, ua } = {}) {
    const slot = this.slots.get(this.key(target, referer, ua))
    if (!slot || !slot.text) return null
    if (Date.now() - slot.ts > MANIFEST_FRESH_MS) return null
    slot.lastUsed = Date.now()
    this.stats.hits++
    return { text: slot.text, ts: slot.ts, finalUrl: slot.finalUrl || target }
  }

  putSegment(url, data, contentType) {
    if (!data || !data.length) return
    if (data.length > MAX_SEGMENT_BYTES) return
    this.segments.set(url, { data, contentType, ts: Date.now() })
    this.stats.bytes += data.length
    if (this.segments.size > MAX_SEGMENTS) {
      // drop the oldest entries
      const keys = [...this.segments.keys()].slice(0, this.segments.size - MAX_SEGMENTS)
      for (const k of keys) this.segments.delete(k)
    }
  }

  /* ---------------------------------------------------------------- */
  /* worker                                                            */
  /* ---------------------------------------------------------------- */

  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()
      this.running++
      this.runJob(job.slot)
        .catch(() => undefined)
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }

  async runJob(slot, timeoutMs = 0) {
    const started = Date.now()
    const check = await isAllowedTarget(slot.target)
    if (!check.ok) {
      this.stats.failed++
      return { ok: false, error: check.reason }
    }

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs > 0 ? timeoutMs : config.proxy.timeoutMs,
    )
    try {
      const res = await fetch(slot.target, {
        headers: upstreamHeaders({ referer: slot.referer, ua: slot.ua }),
        redirect: 'follow',
        signal: controller.signal,
      })
      if (!res.ok) {
        try {
          await res.body?.cancel()
        } catch {
          /* ignore */
        }
        this.stats.failed++
        return { ok: false, status: res.status }
      }
      const text = await res.text()
      slot.text = text
      slot.ts = Date.now()
      slot.finalUrl = res.url || slot.target
      slot.hits++
      this.stats.warmed++
      slot.live = !text.includes('#EXT-X-ENDLIST')
      slot.targetDuration = parseTargetDuration(text)

      // Pull the first media segments into memory: the first frame then only
      // needs a local copy, not a broadcaster round trip.
      void this.warmSegments(slot, text)

      this.scheduleRefresh(slot)

      return { ok: true, text, cached: false, ms: Date.now() - started }
    } catch (err) {
      this.stats.failed++
      log.debug('warm failed', { target: slot.target, error: String(err.message || err) })
      return { ok: false, error: String(err.message || err) }
    } finally {
      clearTimeout(timer)
    }
  }

  async warmSegments(slot, text) {
    const uris = firstSegmentUris(text, slot.finalUrl || slot.target)
    if (!uris.length) return
    await Promise.all(
      uris.slice(0, SEGMENTS_PER_WARM).map(async (u) => {
        if (this.getSegment(u)) return
        try {
          const res = await fetch(u, {
            headers: upstreamHeaders({ referer: slot.referer, ua: slot.ua }),
            redirect: 'follow',
          })
          if (!res.ok) return
          const buf = Buffer.from(await res.arrayBuffer())
          this.putSegment(u, buf, res.headers.get('content-type') || 'video/mp2t')
        } catch {
          /* best effort */
        }
      }),
    )
  }

  /** Keep a live playlist at the live edge while the channel is hot. */
  scheduleRefresh(slot) {
    if (slot.timer) {
      clearTimeout(slot.timer)
      slot.timer = null
    }
    if (!slot.live) return
    if (this.liveCount >= MAX_LIVE_SLOTS) return

    const delay = Math.min(Math.max(slot.targetDuration * 1000 * 2, 2000), 8000)
    slot.timer = setTimeout(() => {
      slot.timer = null
      const hot = slot.lastUsed && Date.now() - slot.lastUsed < SLOT_HOT_MS
      if (!hot) {
        slot.live = false
        return
      }
      this.liveCount++
      this.enqueue(slot.target, { referer: slot.referer, ua: slot.ua }, 5)
      const job = this.queue.find((j) => j.slot.key === slot.key)
      if (job) {
        job.priority = 5
        this.pump()
      }
      setTimeout(() => {
        this.liveCount = Math.max(0, this.liveCount - 1)
      }, delay)
    }, delay)
    if (slot.timer.unref) slot.timer.unref()
  }

  info() {
    return {
      slots: this.slots.size,
      segments: this.segments.size,
      queued: this.queue.length,
      running: this.running,
      live: this.liveCount,
      ...this.stats,
    }
  }
}

/** Extract the media segment URIs of an HLS playlist. */
export function firstSegmentUris(text, baseUrl) {
  const out = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.includes('KEY') || line.includes('MAP')) continue
    try {
      out.push(new URL(line, baseUrl).toString())
    } catch {
      /* ignore */
    }
    if (out.length >= 8) break
  }
  return out
}

function parseTargetDuration(text) {
  const m = /#EXT-X-TARGETDURATION:(\d+)/i.exec(String(text))
  const n = m ? Number(m[1]) : 6
  return Number.isFinite(n) && n > 0 ? n : 6
}

export const warmPool = new WarmPool()

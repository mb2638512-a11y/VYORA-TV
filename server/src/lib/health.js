import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { config } from '../config.js'
import { log } from './logger.js'

/**
 * Channel health tracker (Real-time SSE + priority queue + auto sweeper).
 *
 * Status states:
 *   online   - stream manifest/playlist answered with valid media/EXTM3U
 *   offline  - every source failed (404, 403, 502, timeout, or HTML error page)
 *   unknown  - not probed yet
 */
export class HealthStore extends EventEmitter {
  constructor({ store }) {
    super()
    this.store = store
    this.status = new Map() // channelId -> { status, ts, ms, source }
    this.priority = [] // channel ids waiting for priority probe
    this.sweeper = [] // rotating list of every channel id
    this.sweeperPos = 0
    this.inFlight = new Set()
    this.bandwidth = { bytes: 0, ms: 0, kbps: 0, samples: 0 }
    this.persistFile = path.join(config.dataDir, 'status.json')
    this.persistTimer = null
    this.probeTimeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 3000)
    this.maxParallel = Number(process.env.PROBE_PARALLEL || 8)
    this.sseClients = new Set()
    this.activePlayback = false
    this.activePlaybackCid = ''
  }

  setActivePlayback(active, cid = '') {
    this.activePlayback = Boolean(active)
    this.activePlaybackCid = cid
    if (active) {
      log.debug('playback active: background sweeper paused to prioritize stream bandwidth', { cid })
    } else {
      log.debug('playback inactive: background sweeper resumed')
    }
  }

  /* ---------------- persistence ---------------- */

  load() {
    try {
      if (!fs.existsSync(this.persistFile)) return
      const raw = JSON.parse(fs.readFileSync(this.persistFile, 'utf8'))
      const maxAge = 60 * 60 * 1000 // 1 hour valid cache
      for (const [id, rec] of Object.entries(raw || {})) {
        if (!rec || !rec.ts) continue
        if (Date.now() - rec.ts > maxAge) continue
        this.status.set(id, rec)
      }
      log.info('health state loaded', { channels: this.status.size })
    } catch (err) {
      log.warn('health state load failed', { error: String(err.message || err) })
    }
  }

  persist() {
    try {
      const maxAge = 60 * 60 * 1000
      const out = {}
      for (const [id, rec] of this.status) {
        if (Date.now() - rec.ts > maxAge) continue
        out[id] = rec
      }
      fs.writeFileSync(this.persistFile, JSON.stringify(out))
    } catch (err) {
      log.debug('health persist failed', { error: String(err.message || err) })
    }
  }

  /* ---------------- status access & updates ---------------- */

  get(id) {
    const rec = this.status.get(id)
    if (!rec || rec.status === 'offline') return { status: 'online', ts: Date.now(), ms: 0, source: 'default' }
    return rec
  }

  getAll() {
    const out = {}
    for (const [id, rec] of this.status) {
      out[id] = rec
    }
    return out
  }

  set(id, status, ms = 0, source = 'probe', bestStream = 0) {
    if (!id) return
    const prev = this.status.get(id)
    const rec = { id, status, ts: Date.now(), ms: Math.round(ms), source, bestStream }
    this.status.set(id, rec)

    // Notify listeners if status changed or if refreshed
    const hasChanged = !prev || prev.status !== status || prev.bestStream !== bestStream
    if (hasChanged) {
      const line = { id, from: prev?.status || 'unknown', to: status, ms: Math.round(ms), bestStream }
      if (status === 'online') log.info('channel back online', line)
      else log.debug('channel status changed', line)
      this.broadcastChange(rec)
    }
  }

  /** Real-time SSE broadcasting to all connected clients */
  broadcastChange(rec) {
    if (!this.sseClients.size) return
    const payload = `data: ${JSON.stringify(rec)}\n\n`
    for (const client of this.sseClients) {
      try {
        client.write(payload)
      } catch {
        this.sseClients.delete(client)
      }
    }
  }

  /** Subscribe an HTTP response to Server-Sent Events */
  subscribeSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
    })
    res.write(': connected\n\n')

    // Send initial snapshot of all currently known active statuses
    const snapshot = this.getAll()
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)

    this.sseClients.add(res)

    // Periodic heartbeat to keep connection alive
    const hb = setInterval(() => {
      try {
        res.write(': heartbeat\n\n')
      } catch {
        clearInterval(hb)
        this.sseClients.delete(res)
      }
    }, 15000)

    req.on('close', () => {
      clearInterval(hb)
      this.sseClients.delete(res)
    })
  }

  /** Called by the stream proxy or client: playback success/failure is ground truth */
  report(id, ok, ms = 0, bestStream = 0) {
    if (!id) return
    if (ok) {
      this.set(id, 'online', ms, 'playback', bestStream)
    } else {
      this.set(id, 'offline', ms, 'playback', 0)
    }
  }

  /** Track throughput of segment downloads (used for auto quality) */
  sampleBandwidth(bytes, ms) {
    if (!bytes || !ms) return
    this.bandwidth.bytes += bytes
    this.bandwidth.ms += ms
    this.bandwidth.samples++
    const kbps = this.bandwidth.bytes / (this.bandwidth.ms / 1000) / 1000
    this.bandwidth.kbps = this.bandwidth.kbps
      ? Math.round(this.bandwidth.kbps * 0.7 + kbps * 0.3)
      : Math.round(kbps)
  }

  networkInfo() {
    return {
      kbps: this.bandwidth.kbps,
      samples: this.bandwidth.samples,
      quality: qualityForBandwidth(this.bandwidth.kbps),
    }
  }

  /* ---------------- probing ---------------- */

  /** Mark channels as interesting (the user is viewing them). Prioritize and probe immediately. */
  track(ids) {
    const toProbeNow = []
    for (const id of ids) {
      if (!id || this.inFlight.has(id)) continue
      const rec = this.status.get(id)
      // If probed in the last 45s, skip
      if (rec && Date.now() - rec.ts < 45000) continue
      if (!this.priority.includes(id)) {
        this.priority.unshift(id) // Put at the front of queue
        if (toProbeNow.length < 4) toProbeNow.push(id)
      }
    }
    // Keep priority queue bounded
    if (this.priority.length > 500) this.priority = this.priority.slice(0, 500)

    // Immediately trigger probes for the top visible items
    if (toProbeNow.length > 0) {
      for (const id of toProbeNow) {
        void this.probe(id)
      }
    }
  }

  async probe(channelId) {
    if (this.inFlight.has(channelId)) return
    this.inFlight.add(channelId)
    const started = Date.now()
    try {
      const ch = this.store.getChannel(channelId)
      if (!ch || !ch.streams?.length) {
        this.set(channelId, 'offline', 0, 'probe', 0)
        return
      }

      // Probe up to 4 streams in parallel for ultra-fast discovery
      const streamsToProbe = ch.streams.slice(0, 4)
      const results = await Promise.all(
        streamsToProbe.map(async (s, index) => {
          const t0 = Date.now()
          const res = await this.probeStream(s)
          return { index, ok: res.ok, ms: Date.now() - t0, error: res.error }
        }),
      )

      const successful = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)
      if (successful.length > 0) {
        const winner = successful[0]
        this.set(channelId, 'online', winner.ms, 'probe', winner.index)
      } else {
        const lastErr = results[0]?.error || 'all streams offline'
        this.set(channelId, 'offline', Date.now() - started, 'probe', 0)
        log.debug('probe failed', { id: channelId, error: lastErr })
      }
    } catch {
      this.set(channelId, 'offline', 0, 'probe', 0)
    } finally {
      this.inFlight.delete(channelId)
    }
  }

  async probeStream(stream) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs)
    try {
      const headers = {
        'User-Agent': config.proxy.userAgent,
        Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
      }
      if (stream.referer) headers.Referer = stream.referer
      const res = await fetch(stream.url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      })

      // Must be HTTP 200..299 or redirect to be considered online
      if (!res.ok) {
        try {
          await res.body?.cancel()
        } catch { /* ignore */ }
        return { ok: false, error: `HTTP ${res.status}`, retry: res.status >= 500 }
      }

      // Check first chunk to verify this is not an HTML captcha/error page
      const reader = res.body?.getReader()
      if (reader) {
        try {
          const { value } = await reader.read()
          await reader.cancel()
          if (value && value.length > 0) {
            const sample = Buffer.from(value.slice(0, 300)).toString('utf8').trim()
            if (
              sample.startsWith('<!DOCTYPE') ||
              sample.startsWith('<html') ||
              sample.startsWith('{"error"') ||
              sample.includes('<title>404') ||
              sample.includes('<title>Access Denied')
            ) {
              return { ok: false, error: 'HTML error page' }
            }
          }
        } catch {
          /* ignore reader errors if headers were ok */
        }
      }

      return { ok: true }
    } catch (err) {
      const aborted = controller.signal.aborted
      return { ok: false, error: String(err.message || err), retry: aborted }
    } finally {
      clearTimeout(timer)
    }
  }

  /* ---------------- background sweeper ---------------- */

  start() {
    this.load()
    this.sweeper = []
    for (const list of this.store.countries.values()) {
      for (const ch of list) this.sweeper.push(ch.id)
    }
    this.persistTimer = setInterval(() => this.persist(), 60000)

    const tick = async () => {
      // Bandwidth Priority Focus: When user is actively streaming, pause sweeper
      // so 100% network throughput, sockets, and CPU belong to the video stream!
      if (this.activePlayback) {
        return
      }

      // Priority first (what the user is looking at)
      const priorityJobs = []
      while (priorityJobs.length < 8 && this.priority.length) {
        const id = this.priority.shift()
        if (!id || this.inFlight.has(id)) continue
        const rec = this.status.get(id)
        if (rec && Date.now() - rec.ts < 30000) continue
        priorityJobs.push(id)
      }

      // Background sweeper
      const sweepJobs = []
      while (sweepJobs.length < this.maxParallel) {
        if (this.sweeper.length === 0) break
        this.sweeperPos = (this.sweeperPos + 1) % this.sweeper.length
        const id = this.sweeper[this.sweeperPos]
        const rec = this.status.get(id)
        if (rec && Date.now() - rec.ts < 300000) continue
        if (this.inFlight.has(id)) continue
        sweepJobs.push(id)
      }

      await Promise.all([...priorityJobs, ...sweepJobs].map((id) => this.probe(id)))
    }

    this.timer = setInterval(() => {
      tick().catch(() => undefined)
    }, 2500) // Fast 2.5s cadence
    log.info('health sweeper started', { channels: this.sweeper.length })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.persistTimer) clearInterval(this.persistTimer)
    this.persist()
  }

  stats() {
    let online = 0
    let offline = 0
    for (const rec of this.status.values()) {
      if (rec.status === 'online') online++
      else if (rec.status === 'offline') offline++
    }
    return {
      online,
      offline,
      unknown: Math.max(0, this.sweeper.length - this.status.size),
      tracked: this.status.size,
      queue: this.priority.length,
      sseClients: this.sseClients.size,
      network: this.networkInfo(),
    }
  }
}

/** Map a measured bandwidth to a sensible maximum quality. */
export function qualityForBandwidth(kbps) {
  if (!kbps || kbps <= 0) return 'auto'
  if (kbps >= 22000) return '2160p'
  if (kbps >= 12000) return '1440p'
  if (kbps >= 6000) return '1080p'
  if (kbps >= 2500) return '720p'
  if (kbps >= 1200) return '480p'
  return '360p'
}

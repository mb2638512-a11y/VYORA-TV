import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../config.js'
import { log } from './logger.js'
import { isAllowedTarget, upstreamHeaders } from './net.js'
import { warmPool } from './warm.js'

export { isAllowedTarget }

function encodeParam(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url')
}

/**
 * Rewrite an HLS playlist so every URI (segments, keys, maps) points back
 * through this proxy. This keeps the required Referer/User-Agent headers on
 * every request and avoids CORS problems in the browser.
 */
export function rewritePlaylist(text, baseUrl, { referer, ua }) {
  const lines = text.split(/\r?\n/)
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      out.push(raw)
      continue
    }
    if (line.startsWith('#')) {
      // rewrite URI="..." attributes (keys, init sections, maps)
      const rewritten = line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        try {
          const abs = new URL(uri, baseUrl).toString()
          return `URI="${proxyUrl(abs, referer, ua)}"`
        } catch {
          return _m
        }
      })
      out.push(rewritten)
      continue
    }
    try {
      const abs = new URL(line, baseUrl).toString()
      out.push(proxyUrl(abs, referer, ua))
    } catch {
      out.push(raw)
    }
  }
  return out.join('\n')
}

export function proxyUrl(target, referer, ua) {
  const params = new URLSearchParams()
  params.set('u', encodeParam(target))
  if (referer) params.set('r', encodeParam(referer))
  if (ua) params.set('a', encodeParam(ua))
  return `/api/proxy?${params.toString()}`
}

/* ------------------------------------------------------------------ */
/* logo proxy (cached on disk)                                         */
/* ------------------------------------------------------------------ */

const logoCacheDir = path.join(config.dataDir, 'logos')
const logoMemory = new Map() // url -> { file, type }

function logoKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex')
}

/**
 * Channel logos live on many different CDNs (Wikimedia, Pluto, imgur, ...).
 * Serving them through the server with a disk cache makes the grid load
 * instantly instead of waiting 2-4 seconds per image.
 */
export async function proxyLogo(req, res, target) {
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': config.corsOrigin })
    res.end(JSON.stringify({ error: { code: 'bad-url' } }))
    return
  }
  const key = logoKey(target)
  const file = path.join(logoCacheDir, `${key}.img`)
  const typeFile = path.join(logoCacheDir, `${key}.type`)

  try {
    if (logoMemory.has(key) || fs.existsSync(file)) {
      const buf = fs.readFileSync(file)
      const type = fs.existsSync(typeFile)
        ? fs.readFileSync(typeFile, 'utf8')
        : 'image/png'
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=604800, immutable',
        'Access-Control-Allow-Origin': config.corsOrigin,
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': '*',
      })
      res.end(buf)
      return
    }
  } catch {
    /* fall through to a fresh fetch */
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': config.proxy.userAgent, Accept: 'image/*,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!upstream.ok) throw new Error(`http ${upstream.status}`)
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > 4 * 1024 * 1024) throw new Error('too large')
    const type = upstream.headers.get('content-type') || 'image/png'
    try {
      fs.mkdirSync(logoCacheDir, { recursive: true })
      fs.writeFileSync(file, buf)
      fs.writeFileSync(typeFile, type)
      logoMemory.set(key, { file, type })
    } catch {
      /* cache write is best effort */
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=604800, immutable',
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
    })
    res.end(buf)
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': config.corsOrigin })
    res.end(JSON.stringify({ error: { code: 'logo-failed', message: String(err.message || err) } }))
  } finally {
    clearTimeout(timer)
  }
}

export function decodeParam(value) {
  try {
    return Buffer.from(String(value), 'base64url').toString('utf8')
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ */
/* manifest cache + prefetch (fast start)                             */
/* ------------------------------------------------------------------ */

const manifestCache = new Map() // key -> { text, expires, warmExpires }
const MANIFEST_TTL_MS = 4000
const MANIFEST_WARM_TTL_MS = 45000

function manifestKey(target, referer, ua) {
  return `${target}|${referer || ''}|${ua || ''}`
}

function storeManifest(key, text) {
  manifestCache.set(key, {
    text,
    expires: Date.now() + MANIFEST_TTL_MS,
    warmExpires: Date.now() + MANIFEST_WARM_TTL_MS,
  })
  if (manifestCache.size > 300) {
    const oldest = manifestCache.keys().next().value
    manifestCache.delete(oldest)
  }
}

/**
 * Fetch an HLS/DASH manifest with a short lived cache.
 */
export async function fetchManifest(target, { referer, ua }, attempt = 0) {
  const key = manifestKey(target, referer, ua)
  const hit = manifestCache.get(key)
  if (hit && hit.warmExpires > Date.now()) {
    return { ok: true, text: hit.text, cached: true }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.proxy.timeoutMs)
  try {
    const res = await fetch(target, {
      headers: upstreamHeaders({ referer, ua }),
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) {
      if (res.status >= 500 && attempt < 1) {
        clearTimeout(timer)
        return fetchManifest(target, { referer, ua }, attempt + 1)
      }
      return { ok: false, status: res.status }
    }
    const text = await res.text()
    if (!text.trim().startsWith('#EXTM3U') && !text.includes('#EXT-X-')) {
      return { ok: false, status: 502, error: 'Not an HLS manifest' }
    }
    storeManifest(key, text)
    return { ok: true, text, cached: false }
  } catch (err) {
    if (attempt < 1) {
      clearTimeout(timer)
      return fetchManifest(target, { referer, ua }, attempt + 1)
    }
    log.warn('manifest fetch failed', { target, error: String(err.message || err) })
    return { ok: false, error: String(err.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

/** Warm the cache for a channel without sending any body to the client. */
export async function prefetch(target, { referer, ua }) {
  const t0 = Date.now()
  const res = await fetchManifest(target, { referer, ua })
  if (!res.ok) {
    return { ...res, ms: Date.now() - t0 }
  }

  const segments = firstSegmentUris(res.text, target).slice(0, 3)
  await Promise.all(segments.map((u) => warmSegment(u, { referer, ua })))

  // Keep the channel pre-buffered (live edge) while the user is nearby.
  warmPool.enqueue(target, { referer, ua }, 3)

  return { ...res, ms: Date.now() - t0, segments: segments.length }
}

/* ------------------------------------------------------------------ */
/* segment cache                                                      */
/* ------------------------------------------------------------------ */

const segmentCache = new Map() // target -> { data, contentType, expires }
const SEGMENT_TTL_MS = 45000
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024

/** Extract the first media segment URIs of an HLS playlist. */
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
    if (out.length >= 6) break
  }
  return out
}

/** Fetch one segment into the cache so the first frames arrive instantly. */
export async function warmSegment(target, { referer, ua }) {
  if (segmentCache.has(target)) return { ok: true, cached: true }
  try {
    const res = await fetch(target, {
      headers: upstreamHeaders({ referer, ua }),
      redirect: 'follow',
    })
    if (!res.ok) return { ok: false, status: res.status }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_SEGMENT_BYTES) return { ok: false, reason: 'too-large' }
    segmentCache.set(target, {
      data: buf,
      contentType: res.headers.get('content-type') || 'video/mp2t',
      expires: Date.now() + SEGMENT_TTL_MS,
    })
    if (segmentCache.size > 120) {
      const oldest = segmentCache.keys().next().value
      segmentCache.delete(oldest)
    }
    // Also keep it in the turbo prebuffer (served to the player instantly).
    warmPool.putSegment(target, buf, res.headers.get('content-type') || 'video/mp2t')
    return { ok: true, bytes: buf.length }
  } catch (err) {
    return { ok: false, error: String(err.message || err) }
  }
}

function getCachedSegment(target) {
  // Turbo prebuffer first: these segments were pulled while the user browsed.
  const pre = warmPool.getSegment(target)
  if (pre) return pre
  const hit = segmentCache.get(target)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    segmentCache.delete(target)
    return null
  }
  return hit
}

/**
 * Proxy one upstream resource to the client.
 * Handles HLS playlists (rewritten), byte-range media (206 pass-through)
 * and plain files with strict validation.
 */
export async function proxyResource(req, res, target, { referer, ua, cid, health }) {
  const started = Date.now()
  const check = await isAllowedTarget(target)
  if (!check.ok) {
    res.writeHead(403, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
    })
    res.end(JSON.stringify({ error: { code: 'blocked', reason: check.reason } }))
    log.warn('proxy blocked', { target, reason: check.reason })
    return
  }

  // Warm segment cache hit -> serve instantly
  const cached = getCachedSegment(target)
  if (cached) {
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m && m[1] ? parseInt(m[1], 10) : 0
      const end = m && m[2] ? parseInt(m[2], 10) : cached.data.length - 1
      const slice = cached.data.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Type': cached.contentType,
        'Content-Range': `bytes ${start}-${end}/${cached.data.length}`,
        'Content-Length': slice.length,
        'Access-Control-Allow-Origin': config.corsOrigin,
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': '*',
      })
      res.end(slice)
      return
    }
    res.writeHead(200, {
      'Content-Type': cached.contentType,
      'Content-Length': cached.data.length,
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Cache-Control': 'no-store',
    })
    res.end(cached.data)
    return
  }

  // Turbo prebuffer hit: the manifest (and its first segments) are already in
  // memory because the channel was warmed while the user browsed the list.
  // Serving it here means zero upstream round trips -> instant picture.
  if (/\.m3u8(\?|$)/i.test(target)) {
    const pre = warmPool.peek(target, { referer, ua })
    if (pre) {
      const rewritten = rewritePlaylist(pre.text, pre.finalUrl || target, { referer, ua })
      const body = Buffer.from(rewritten, 'utf8')
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': config.corsOrigin,
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': '*',
        'Cache-Control': 'no-cache',
        'X-Vyora-Cache': 'prebuffer',
      })
      res.end(body)
      if (health) health.report(cid, true, Date.now() - started)
      return
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.proxy.timeoutMs)
  req.on('close', () => controller.abort())

  const headers = upstreamHeaders({
    referer,
    ua,
    extra: req.headers.range ? { Range: req.headers.range } : undefined,
  })

  let upstream
  try {
    upstream = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (health) health.report(cid, false, Date.now() - started)
    res.writeHead(502, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
    })
    res.end(JSON.stringify({ error: { code: 'upstream-failed', message: String(err.message || err) } }))
    log.warn('proxy upstream failed', { target, error: String(err.message || err) })
    return
  }

  // If upstream responded with an HTTP error (404, 403, 500 etc)
  if (!upstream.ok) {
    clearTimeout(timer)
    if (health) health.report(cid, false, Date.now() - started)
    res.writeHead(upstream.status >= 500 ? 502 : upstream.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
    })
    res.end(JSON.stringify({ error: { code: 'upstream-error', status: upstream.status } }))
    return
  }

  const ctype = (upstream.headers.get('content-type') || '').toLowerCase()
  const isPlaylist =
    ctype.includes('mpegurl') ||
    ctype.includes('m3u8') ||
    /\.m3u8(\?|$)/i.test(upstream.url || target)

  if (isPlaylist) {
    clearTimeout(timer)
    const key = manifestKey(target, referer, ua)
    const cachedEntry = manifestCache.get(key)
    let text = null

    if (cachedEntry && cachedEntry.expires > Date.now()) {
      text = cachedEntry.text
    } else if (cachedEntry && cachedEntry.warmExpires > Date.now()) {
      text = cachedEntry.text
      cachedEntry.expires = Date.now() + MANIFEST_TTL_MS
      void fetchManifest(target, { referer, ua }).then((fresh) => {
        if (fresh.ok) {
          const entry = manifestCache.get(key)
          if (entry) entry.text = fresh.text
        }
      })
    }

    if (text === null) {
      text = await upstream.text()
    } else {
      try {
        await upstream.body?.cancel()
      } catch {
        /* ignore */
      }
    }

    // Verify it is actually an HLS manifest, not an HTML error or captcha page
    const trimmed = text.trim()
    if (!trimmed.startsWith('#EXTM3U') && !trimmed.includes('#EXT-X-')) {
      if (health) health.report(cid, false, Date.now() - started)
      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': config.corsOrigin,
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': '*',
      })
      res.end(JSON.stringify({ error: { code: 'invalid-playlist', message: 'Upstream returned invalid HLS manifest' } }))
      return
    }

    // Playlist is genuine!
    if (health) health.report(cid, true, Date.now() - started)
    storeManifest(key, text)

    const finalUrl = upstream.url || target
    const rewritten = rewritePlaylist(text, finalUrl, { referer, ua })
    const body = Buffer.from(rewritten, 'utf8')
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Cache-Control': 'no-cache',
    })
    res.end(body)
    return
  }

  // Non-playlist media (chunks/segments)
  const outHeaders = {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Cache-Control': 'no-store',
  }
  const range = upstream.headers.get('content-range')
  if (range) outHeaders['Content-Range'] = range
  const len = upstream.headers.get('content-length')
  if (len) outHeaders['Content-Length'] = len
  outHeaders['Content-Type'] = ctype || 'video/mp2t'

  res.writeHead(upstream.status, outHeaders)
  if (!upstream.body) {
    clearTimeout(timer)
    if (health) health.report(cid, true, Date.now() - started)
    res.end()
    return
  }

  let bytes = 0
  const segStart = Date.now()
  try {
    for await (const chunk of upstream.body) {
      const buf = Buffer.from(chunk)
      bytes += buf.length
      res.write(buf)
    }
    if (health) {
      health.report(cid, true, Date.now() - started)
      health.sampleBandwidth(bytes, Date.now() - segStart)
    }
  } catch (err) {
    log.debug('proxy stream aborted', { target, error: String(err.message || err) })
    if (health && bytes === 0) health.report(cid, false, Date.now() - started)
  } finally {
    clearTimeout(timer)
    res.end()
  }
}

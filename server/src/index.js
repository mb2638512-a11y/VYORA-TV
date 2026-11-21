import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log, setLevel } from './lib/logger.js'
import { Cache, mimeFor, sendBuffer, sendError, sendJSON } from './lib/http.js'
import { store } from './lib/store.js'
import { decodeParam, prefetch, proxyLogo, proxyResource, proxyUrl } from './lib/proxy.js'
import { warmPool } from './lib/warm.js'
import { HealthStore } from './lib/health.js'

setLevel(config.logLevel)
const cache = new Cache(config.cache)
const health = new HealthStore({ store })
store.attachHealth(health)

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function parseURL(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`)
}

function withCache(key, producer) {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  return cache.set(key, producer())
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/* ------------------------------------------------------------------ */
/* api                                                                 */
/* ------------------------------------------------------------------ */

async function handleAPI(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/'

  if (p === '/health') {
    return sendJSON(res, 200, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      dataset: store.stats(),
      cache: cache.stats(),
      time: new Date().toISOString(),
    })
  }

  if (p === '/bootstrap') {
    const index = withCache('bootstrap', () => store.getIndex())
    return sendJSON(res, 200, {
      generatedAt: index.generatedAt,
      totals: index.totals,
      featured: index.featured,
      countries: index.countries,
      categories: index.categories,
    })
  }

  if (p === '/countries') {
    return sendJSON(res, 200, { countries: store.getCountries() })
  }

  if (p === '/categories') {
    return sendJSON(res, 200, { categories: store.getCategories() })
  }

  if (p === '/channels') {
    const ids = url.searchParams.get('ids')
    if (ids) {
      const wanted = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
      const found = store.getByIds(wanted)
      return sendJSON(res, 200, {
        total: found.length,
        count: found.length,
        channels: found,
      })
    }
    const country = url.searchParams.get('country') || 'all'
    const category = url.searchParams.get('category') || 'all'
    const search = url.searchParams.get('search') || ''
    const limit = clampInt(url.searchParams.get('limit'), 1, 5000, 800)
    const offset = clampInt(url.searchParams.get('offset'), 0, 100000, 0)
    const result = store.query({ country, category, search, limit, offset })
    return sendJSON(res, 200, {
      country,
      category,
      search,
      total: result.total,
      count: result.items.length,
      offset,
      limit,
      channels: result.items,
    })
  }

  if (p === '/top') {
    const limit = clampInt(url.searchParams.get('limit'), 1, 200, 84)
    const list = store.getTop(limit)
    return sendJSON(res, 200, { total: list.length, channels: list })
  }

  if (p.startsWith('/channels/')) {
    const id = decodeURIComponent(p.slice('/channels/'.length))
    const ch = store.getChannel(id)
    if (!ch) return sendError(res, 404, 'not-found', `No channel '${id}'`)
    return sendJSON(res, 200, { channel: ch })
  }

  if (p.startsWith('/resolve/')) {
    const id = decodeURIComponent(p.slice('/resolve/'.length))
    const ch = store.getChannel(id)
    if (!ch) return sendError(res, 404, 'not-found', `No channel '${id}'`)
    if (!ch.streams?.length) return sendJSON(res, 200, { ok: false, error: 'no-streams', channel: ch })

    // Check health cache first
    const rec = health.get(id)
    let bestIndex = typeof rec?.bestStream === 'number' ? rec.bestStream : 0
    if (bestIndex >= ch.streams.length) bestIndex = 0

    // Probe/warm in parallel with fast race
    const stream = ch.streams[bestIndex]
    const prefResult = await prefetch(stream.url, { referer: stream.referer, ua: stream.ua })
    if (prefResult.ok) {
      health.set(id, 'online', prefResult.ms || 0, 'resolve', bestIndex)
      return sendJSON(res, 200, {
        ok: true,
        channel: ch,
        streamIndex: bestIndex,
        stream,
        cached: !!prefResult.cached,
        ms: prefResult.ms,
      })
    }

    // Best stream failed, race remaining streams in parallel
    const others = ch.streams
      .map((s, idx) => ({ s, idx }))
      .filter((item) => item.idx !== bestIndex)

    if (others.length > 0) {
      const winner = await Promise.any(
        others.map(async ({ s, idx }) => {
          const r = await prefetch(s.url, { referer: s.referer, ua: s.ua })
          if (r.ok) return { idx, s, r }
          throw new Error('stream failed')
        }),
      ).catch(() => null)

      if (winner) {
        health.set(id, 'online', winner.r.ms || 0, 'resolve', winner.idx)
        return sendJSON(res, 200, {
          ok: true,
          channel: ch,
          streamIndex: winner.idx,
          stream: winner.s,
          cached: !!winner.r.cached,
          ms: winner.r.ms,
        })
      }
    }

    health.set(id, 'offline', 0, 'resolve', 0)
    return sendJSON(res, 200, { ok: false, error: 'all-streams-offline', channel: ch })
  }

  if (p === '/search') {
    const q = url.searchParams.get('q') || ''
    const limit = clampInt(url.searchParams.get('limit'), 1, 500, 120)
    const result = store.query({ country: 'all', category: 'all', search: q, limit })
    return sendJSON(res, 200, { query: q, total: result.total, channels: result.items })
  }

  if (p === '/proxy') {
    if (!config.proxy.enabled) return sendError(res, 503, 'proxy-disabled', 'Stream proxy is off')
    const target = decodeParam(url.searchParams.get('u') || '')
    const referer = decodeParam(url.searchParams.get('r') || '')
    const ua = decodeParam(url.searchParams.get('a') || '')
    const cid = url.searchParams.get('cid') || ''
    if (!target) return sendError(res, 400, 'missing-target', 'Missing ?u=')
    return proxyResource(req, res, target, { referer, ua, cid, health })
  }

  if (p === '/status') {
    const idsParam = url.searchParams.get('ids')
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
      const out = {}
      for (const id of ids.slice(0, 500)) out[id] = health.get(id)
      return sendJSON(res, 200, { status: out, stats: health.stats() })
    }
    return sendJSON(res, 200, { status: health.getAll(), stats: health.stats() })
  }

  if (p === '/status/stream') {
    return health.subscribeSSE(req, res)
  }

  if (p === '/status/report') {
    const id = url.searchParams.get('id') || ''
    const ok = url.searchParams.get('ok') === '1' || url.searchParams.get('ok') === 'true'
    const ms = parseInt(url.searchParams.get('ms') || '0', 10)
    const streamIndex = parseInt(url.searchParams.get('stream') || '0', 10)
    if (id) {
      health.report(id, ok, ms, streamIndex)
    }
    return sendJSON(res, 200, { ok: true, id, status: health.get(id) })
  }

  if (p === '/status/track') {
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
    health.track(ids.slice(0, 500))
    return sendJSON(res, 200, { tracked: ids.length, queue: health.priority.length })
  }

  if (p === '/playback/active') {
    const cid = url.searchParams.get('cid') || ''
    health.setActivePlayback(true, cid)
    return sendJSON(res, 200, { ok: true, active: true, cid })
  }

  if (p === '/playback/inactive') {
    health.setActivePlayback(false)
    return sendJSON(res, 200, { ok: true, active: false })
  }

  if (p === '/playback/lookahead') {
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const results = []
    for (const id of ids.slice(0, 8)) {
      const ch = store.getChannel(id)
      if (ch && ch.streams?.length) {
        const rec = health.get(id)
        const bestIdx = typeof rec?.bestStream === 'number' ? rec.bestStream : 0
        const ordered = [ch.streams[bestIdx] || ch.streams[0], ...ch.streams.filter((_, i) => i !== bestIdx)]
        // Warm the two best sources so a click never waits for a cold CDN.
        for (const stream of ordered.slice(0, 2)) {
          if (stream) warmPool.enqueue(stream.url, { referer: stream.referer, ua: stream.ua }, 6)
        }
        results.push(id)
      }
    }
    return sendJSON(res, 200, { ok: true, prefetched: results })
  }

  if (p === '/network') {
    return sendJSON(res, 200, health.networkInfo())
  }

  if (p === '/prefetch') {
    // Warms the manifest cache so the channel opens instantly.
    const target = decodeParam(url.searchParams.get('u') || '')
    const referer = decodeParam(url.searchParams.get('r') || '')
    const ua = decodeParam(url.searchParams.get('a') || '')
    if (!target) return sendError(res, 400, 'missing-target', 'Missing ?u=')
    // Keep the channel pre-buffered in the background (live edge) so the
    // next click is served from memory.
    warmPool.enqueue(target, { referer, ua }, 4)
    const result = await prefetch(target, { referer, ua })
    return sendJSON(res, result.ok ? 200 : 502, {
      ok: result.ok,
      cached: !!result.cached,
      ms: result.ms,
      status: result.status,
      error: result.error,
      segments: result.segments,
    })
  }

  if (p === '/warm') {
    return sendJSON(res, 200, { ok: true, ...warmPool.info() })
  }

  if (p === '/play') {
    // Stream racing: several sources of the same channel are tried in
    // parallel and the fastest one wins. A dead / slow CDN can no longer
    // delay the picture.
    const cid = url.searchParams.get('cid') || ''
    const ch = store.getChannel(cid)
    const streams = ch?.streams || []
    if (!streams.length) return sendError(res, 404, 'no-streams', `No streams for '${cid}'`)

    const winner = await warmPool.race(streams, {
      timeoutMs: Number(process.env.RACE_TIMEOUT_MS || 3500),
      limit: 4,
    })
    if (!winner) {
      if (health) health.report(cid, false, 0)
      return sendError(res, 502, 'all-streams-failed', 'No source answered')
    }

    const s = winner.stream
    const params = new URLSearchParams()
    params.set('u', Buffer.from(String(s.url), 'utf8').toString('base64url'))
    if (s.referer) params.set('r', Buffer.from(String(s.referer), 'utf8').toString('base64url'))
    if (s.ua) params.set('a', Buffer.from(String(s.ua), 'utf8').toString('base64url'))
    if (cid) params.set('cid', cid)
    const location = `/api/proxy?${params.toString()}`

    res.writeHead(302, {
      Location: location,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': config.corsOrigin,
      'X-Vyora-Stream': String(winner.index),
      'X-Vyora-Ms': String(winner.ms || 0),
    })
    res.end()
    return
  }

  if (p === '/prefetch/batch') {
    // Warm the top sources of several channels in one round trip.
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const depth = clampInt(url.searchParams.get('depth'), 1, 4, 2)
    let count = 0
    for (const id of ids.slice(0, 40)) {
      const ch = store.getChannel(id)
      if (!ch?.streams?.length) continue
      for (const s of ch.streams.slice(0, depth)) {
        warmPool.enqueue(s.url, { referer: s.referer, ua: s.ua }, 2)
        count++
      }
    }
    return sendJSON(res, 200, { ok: true, queued: count, channels: ids.length })
  }

  if (p === '/logo') {
    const target = decodeParam(url.searchParams.get('u') || '')
    if (!target) return sendError(res, 400, 'missing-target', 'Missing ?u=')
    return proxyLogo(req, res, target)
  }

  if (p === '/proxy-url') {
    // helper so the client can build proxied URLs without duplicating logic
    const target = url.searchParams.get('u') || ''
    const referer = url.searchParams.get('r') || ''
    const ua = url.searchParams.get('a') || ''
    if (!target) return sendError(res, 400, 'missing-target', 'Missing ?u=')
    return sendJSON(res, 200, { url: proxyUrl(target, referer, ua) })
  }

  return sendError(res, 404, 'not-found', `Unknown API route ${p}`)
}

/* ------------------------------------------------------------------ */
/* static file serving                                                 */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, url) {
  const webDir = config.webDir
  if (!fs.existsSync(webDir)) {
    return sendError(res, 503, 'no-build', 'Web build not found. Run: npm run build')
  }
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.join(webDir, rel)
  if (!file.startsWith(webDir)) return sendError(res, 403, 'forbidden', 'Path traversal')

  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const buf = fs.readFileSync(file)
    const ext = path.extname(file).toLowerCase()
    const immutable = /\/assets\//.test(rel)
    return sendBuffer(req, res, buf, mimeFor(file), {
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    })
  }

  // SPA fallback
  const indexFile = path.join(webDir, 'index.html')
  if (fs.existsSync(indexFile)) {
    const buf = fs.readFileSync(indexFile)
    return sendBuffer(req, res, buf, 'text/html; charset=utf-8', {
      'Cache-Control': 'no-cache',
    })
  }
  return sendError(res, 404, 'not-found', 'Not found')
}

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  const url = parseURL(req)

  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Access-Control-Max-Age': '86400',
    })
    return res.end()
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleAPI(req, res, url)
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url)
    } else {
      sendError(res, 405, 'method-not-allowed', 'Only GET/HEAD are supported')
    }
  } catch (err) {
    log.error('request failed', { path: url.pathname, error: String(err?.stack || err) })
    if (!res.headersSent) sendError(res, 500, 'internal-error', 'Unexpected server error')
    else res.end()
  } finally {
    log.debug('request', {
      method: req.method,
      path: url.pathname,
      status: res.statusCode,
      ms: Date.now() - started,
    })
  }
})

server.keepAliveTimeout = 65000
server.headersTimeout = 70000

server.listen(config.port, config.host, () => {
  try {
    store.load()
  } catch (err) {
    log.error('dataset load failed', { error: String(err.message || err) })
  }
  try {
    health.start()
  } catch (err) {
    log.error('health tracker failed', { error: String(err.message || err) })
  }
  log.info('Vyora TV server listening', {
    url: `http://127.0.0.1:${config.port}`,
    host: config.host,
    webDir: config.webDir,
    proxy: config.proxy.enabled,
  })
})

process.on('SIGINT', () => {
  log.info('shutting down')
  health.stop()
  server.close(() => process.exit(0))
})
process.on('uncaughtException', (err) => {
  log.error('uncaught exception', { error: String(err?.stack || err) })
})

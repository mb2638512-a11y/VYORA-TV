import zlib from 'node:zlib'
import { config } from '../config.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.ts': 'video/mp2t',
}

export function mimeFor(file) {
  const i = file.lastIndexOf('.')
  const ext = i === -1 ? '' : file.slice(i).toLowerCase()
  return MIME[ext] || 'application/octet-stream'
}

export function sendJSON(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Cache-Control': 'public, max-age=60',
    ...extraHeaders,
  }
  res.writeHead(status, headers)
  res.end(payload)
}

export function sendError(res, status, code, message) {
  sendJSON(res, status, { error: { code, message } })
}

/** Small LRU-ish memory cache with TTL. */
export class Cache {
  constructor({ ttlMs = 300000, maxEntries = 500 } = {}) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.map = new Map()
  }
  get(key) {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (Date.now() > hit.expires) {
      this.map.delete(key)
      return undefined
    }
    // refresh LRU position
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.value
  }
  set(key, value) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs })
    return value
  }
  stats() {
    return { entries: this.map.size, ttlMs: this.ttlMs }
  }
}

/** Send a buffer with optional gzip compression. */
export function sendBuffer(req, res, buffer, contentType, extraHeaders = {}) {
  const headers = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': config.corsOrigin,
    ...extraHeaders,
  }
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '')
  if (acceptsGzip && buffer.length > 1024) {
    const gz = zlib.gzipSync(buffer)
    headers['Content-Encoding'] = 'gzip'
    headers['Content-Length'] = gz.length
    res.writeHead(200, headers)
    res.end(gz)
    return
  }
  headers['Content-Length'] = buffer.length
  res.writeHead(200, headers)
  res.end(buffer)
}

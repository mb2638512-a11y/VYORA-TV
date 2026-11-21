import dns from 'node:dns'
import { config } from '../config.js'

/**
 * Shared upstream helpers (SSRF guard + request headers).
 * Kept in its own module so both the proxy and the turbo prebuffer can use
 * it without a circular import.
 */

const PRIVATE_V4 = [
  [10, 0, 0, 0, 8],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [100, 64, 0, 0, 10],
]

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false
  const [a, b] = parts
  for (const [n, m, o, p, bits] of PRIVATE_V4) {
    if (n === a) {
      const inRange =
        a === n &&
        (n === 10 ||
          n === 127 ||
          n === 169 ||
          n === 172 ||
          n === 192 ||
          n === 100)
      if (inRange) {
        const start = n << 24
        const size = bits === 0 ? 0 : 2 ** (32 - bits)
        const value = (a << 24) | (b << 16) | (parts[2] << 8) | parts[3]
        if (value >= start && value < start + size) return true
      }
    }
  }
  return false
}

/** SSRF guard: only public hosts may be proxied. */
const dnsCache = new Map() // host -> { ok, reason, expires }
const DNS_TTL_MS = 15 * 60 * 1000

export async function isAllowedTarget(rawUrl) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'protocol-not-allowed' }
  }
  const host = u.hostname.toLowerCase()
  const blocked = config.proxy.blockHost.split(',').map((s) => s.trim()).filter(Boolean)
  if (blocked.includes(host)) return { ok: false, reason: 'host-blocked' }
  if (config.proxy.allowHost) {
    const allow = config.proxy.allowHost.split(',').map((s) => s.trim().toLowerCase())
    if (!allow.some((a) => host === a || host.endsWith('.' + a))) {
      return { ok: false, reason: 'host-not-allowlisted' }
    }
  }

  // Fast path for raw IPv4 addresses: skip DNS query entirely
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    if (isPrivateIPv4(host)) {
      return { ok: false, reason: 'private-address' }
    }
    return { ok: true }
  }

  // DNS is cached: resolving on every segment request adds hundreds of ms.
  const cached = dnsCache.get(host)
  if (cached && cached.expires > Date.now()) return cached.verdict
  if (cached) dnsCache.delete(host)

  let verdict = { ok: true }
  try {
    const records = await dns.promises.lookup(host, { all: true })
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) {
        verdict = { ok: false, reason: 'private-address' }
        break
      }
      if (r.family === 6 && /^(::1|fc|fd|fe80)/.test(r.address)) {
        verdict = { ok: false, reason: 'private-address' }
        break
      }
    }
  } catch {
    verdict = { ok: false, reason: 'dns-failed' }
  }
  dnsCache.set(host, { verdict, expires: Date.now() + DNS_TTL_MS })
  return verdict
}

export function upstreamHeaders({ referer, ua, extra }) {
  const headers = {
    'User-Agent': ua || config.proxy.userAgent,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Connection: 'keep-alive',
  }
  if (referer) {
    headers.Referer = referer
    try {
      headers.Origin = new URL(referer).origin
    } catch {
      /* ignore malformed referer */
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers[k] = v
  }
  return headers
}

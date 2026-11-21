#!/usr/bin/env node
/**
 * VYORA source audit (opt-in, rate-limited).
 * Checks every stream URL independently; this is a network probe, not a decoder test.
 *
 * Usage:
 *   node scripts/audit-streams.mjs --confirm-network
 *   node scripts/audit-streams.mjs --confirm-network --country PK --limit 50
 */
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = process.cwd()
const DATA_DIR = path.resolve(ROOT, process.env.VYORA_DATA_DIR || 'server/data')
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const int = (name, fallback, min, max) => {
  const n = Number(value(name, fallback))
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}: expected ${min}-${max}`)
  return n
}

if (!has('--confirm-network')) {
  console.error('Safety stop: this command contacts third-party stream hosts. Re-run with --confirm-network after reviewing the rate limits.')
  process.exit(2)
}

const concurrency = int('--concurrency', 2, 1, 4)
const timeoutMs = int('--timeout-ms', 8000, 1000, 20000)
const limit = int('--limit', 0, 0, 50000)
const countryFilter = String(value('--country', '')).toUpperCase()
const delayMs = int('--delay-ms', 300, 100, 5000)
const MAX_BYTES = 128 * 1024

function csvCell(v) {
  const s = String(v ?? '')
  return '"' + s.replaceAll('"', '""') + '"'
}
function safeUrl(raw) {
  try {
    const u = new URL(raw)
    return u.origin + u.pathname // omit query/hash: source URLs may contain access tokens
  } catch {
    return ''
  }
}
function classify(url, contentType, body) {
  const text = body.toString('utf8').trim()
  const lower = text.toLowerCase()
  const ct = String(contentType || '').toLowerCase()
  if (!text) return { kind: 'empty', manifestValid: false }
  if (ct.includes('text/html') || lower.includes('<html') || lower.startsWith('<!doctype html')) {
    return { kind: 'html_or_block_page', manifestValid: false }
  }
  const pathLower = (() => { try { return new URL(url).pathname.toLowerCase() } catch { return '' } })()
  if (pathLower.endsWith('.m3u8') || ct.includes('mpegurl') || text.startsWith('#EXTM3U')) {
    const valid = text.startsWith('#EXTM3U') && (text.includes('#EXTINF') || text.includes('#EXT-X-'))
    return { kind: 'hls_manifest', manifestValid: valid }
  }
  if (pathLower.endsWith('.mpd') || ct.includes('dash+xml') || lower.includes('<mpd')) {
    const valid = /<mpd(?:\s|>)/i.test(text) && /<\/mpd>/i.test(text)
    return { kind: 'dash_manifest', manifestValid: valid }
  }
  return { kind: 'direct_media_or_unknown', manifestValid: null }
}

async function readBounded(response) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (total < MAX_BYTES) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      const take = chunk.subarray(0, MAX_BYTES - total)
      chunks.push(Buffer.from(take))
      total += take.length
      if (take.length < chunk.length) break
    }
  } finally {
    try { await reader.cancel() } catch {}
  }
  return Buffer.concat(chunks)
}

async function probe(item) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = {
      accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, application/dash+xml, video/*, */*',
      'user-agent': item.ua || 'VYORA-TV-Stream-Audit/1.0',
      range: `bytes=0-${MAX_BYTES - 1}`,
    }
    if (item.referer) headers.referer = item.referer
    const response = await fetch(item.url, { method: 'GET', headers, signal: controller.signal, redirect: 'follow' })
    const body = await readBounded(response)
    const elapsedMs = Date.now() - started
    const result = classify(item.url, response.headers.get('content-type'), body)
    let status = 'reachable'
    let reason = ''
    if (!response.ok) {
      status = 'http_error'
      reason = `HTTP ${response.status}`
    } else if (result.manifestValid === false) {
      status = 'invalid_response'
      reason = result.kind === 'html_or_block_page' ? 'HTML/block page, not a media manifest' : 'Empty or malformed response'
    }
    return {
      channelId: item.channelId, channel: item.channel, country: item.country,
      streamId: item.streamId, sourceIndex: item.sourceIndex,
      url: safeUrl(item.url), host: (() => { try { return new URL(response.url || item.url).host } catch { return '' } })(),
      status, httpStatus: response.status, kind: result.kind,
      manifestValid: result.manifestValid, elapsedMs, bytesRead: body.length,
      contentType: response.headers.get('content-type') || '', reason,
    }
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    return {
      channelId: item.channelId, channel: item.channel, country: item.country,
      streamId: item.streamId, sourceIndex: item.sourceIndex,
      url: safeUrl(item.url), host: (() => { try { return new URL(item.url).host } catch { return '' } })(),
      status: aborted ? 'timeout' : 'network_error', httpStatus: 0, kind: 'no_response',
      manifestValid: false, elapsedMs: Date.now() - started, bytesRead: 0,
      contentType: '', reason: aborted ? `Timeout after ${timeoutMs}ms` : String(error?.message || error).slice(0, 240),
    }
  } finally {
    clearTimeout(timer)
  }
}

function loadTargets() {
  const channelsDir = path.join(DATA_DIR, 'channels')
  if (!fs.existsSync(channelsDir)) throw new Error(`Missing ${channelsDir}. Run npm run data first or set VYORA_DATA_DIR.`)
  const files = fs.readdirSync(channelsDir).filter((f) => f.endsWith('.json')).sort()
  const targets = []
  for (const file of files) {
    const country = path.basename(file, '.json').toUpperCase()
    if (countryFilter && country !== countryFilter) continue
    const list = JSON.parse(fs.readFileSync(path.join(channelsDir, file), 'utf8'))
    for (const channel of list) {
      for (const [sourceIndex, stream] of (channel.streams || []).entries()) {
        if (!/^https?:\/\//i.test(stream.url || '')) continue
        targets.push({
          channelId: channel.id, channel: channel.name, country,
          streamId: stream.id || `${channel.id}-${sourceIndex}`,
          sourceIndex, url: stream.url, referer: stream.referer || '', ua: stream.ua || '',
        })
      }
    }
  }
  return limit ? targets.slice(0, limit) : targets
}

async function main() {
  const targets = loadTargets()
  if (!targets.length) throw new Error('No stream URLs found for the selected catalogue/filter.')
  console.log(`VYORA audit: ${targets.length} source URLs | concurrency=${concurrency} | timeout=${timeoutMs}ms | min delay/worker=${delayMs}ms`)
  console.log('This checks reachability and manifest shape only; it does not decode video or prove first-frame playback.')
  const results = new Array(targets.length)
  let cursor = 0
  let completed = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++
      if (index >= targets.length) return
      await sleep(delayMs)
      results[index] = await probe(targets[index])
      completed++
      if (completed % 25 === 0 || completed === targets.length) {
        process.stdout.write(`\rAudited ${completed}/${targets.length}`)
      }
    }
  })
  await Promise.all(workers)
  process.stdout.write('\n')

  const stamp = new Date().toISOString().replaceAll(':', '-')
  const outDir = path.join(ROOT, 'reports', 'stream-audit')
  fs.mkdirSync(outDir, { recursive: true })
  const jsonPath = path.join(outDir, `audit-${stamp}.json`)
  const csvPath = path.join(outDir, `audit-${stamp}.csv`)
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(), targetCount: targets.length,
    concurrency, timeoutMs, delayMs, country: countryFilter || null,
    note: 'Reachability/manifest-shape audit only; not a decoder or first-frame test.',
    summary: results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {}),
    results,
  }, null, 2))
  const columns = ['channelId','channel','country','streamId','sourceIndex','url','host','status','httpStatus','kind','manifestValid','elapsedMs','bytesRead','contentType','reason']
  fs.writeFileSync(csvPath, [columns.join(','), ...results.map(r => columns.map(k => csvCell(r[k])).join(','))].join('\n'))
  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})
  console.log('Summary:', JSON.stringify(counts))
  console.log('JSON:', path.relative(ROOT, jsonPath))
  console.log('CSV: ', path.relative(ROOT, csvPath))
}
main().catch((error) => { console.error('[audit] ' + error.message); process.exitCode = 1 })

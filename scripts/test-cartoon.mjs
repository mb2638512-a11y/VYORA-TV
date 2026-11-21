import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = 'http://127.0.0.1:8787'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url')

async function api(p) {
  const res = await fetch(`${base}${p}`)
  return res.json()
}

// 1) server network info (measured)
const net = await api('/api/network')
console.log('network:', JSON.stringify(net))

// 2) find a Cartoon Network style channel (Cartoon Network US / a slow CDN)
const search = await api('/api/search?q=Cartoon%20Network&limit=5')
console.log('\nCartoon Network matches:')
for (const c of search.channels) {
  console.log(`  ${c.id.padEnd(22)} ${c.name} | streams=${c.streams.length} | ${c.streams[0]?.url?.slice(0, 70)}`)
}

// 3) race + resolve timing for that channel
for (const c of search.channels.slice(0, 3)) {
  const t0 = Date.now()
  try {
    const r = await api(`/api/resolve/${encodeURIComponent(c.id)}`)
    console.log(`\nresolve ${c.id}: winner #${r.streamIndex} ${r.stream.label} in ${Date.now() - t0}ms`)
  } catch (e) {
    console.log(`\nresolve ${c.id}: FAILED in ${Date.now() - t0}ms ${e.message}`)
  }
}

// 4) the whole flow for one channel: warm -> play -> manifest
const c = search.channels[0]
if (c) {
  console.log(`\n--- flow for ${c.id} ---`)
  const u = b64(c.streams[0].url)
  let t = Date.now()
  await fetch(`${base}/api/prefetch?u=${u}&cid=${encodeURIComponent(c.id)}`)
  console.log(`  prefetch queued: ${Date.now() - t}ms`)

  t = Date.now()
  const play = await fetch(`${base}/api/play?cid=${encodeURIComponent(c.id)}`, { redirect: 'manual' })
  console.log(`  /api/play: ${play.status} stream=${play.headers.get('x-vyora-stream')} in ${Date.now() - t}ms`)

  await new Promise((r) => setTimeout(r, 4000))
  t = Date.now()
  const m = await fetch(`${base}/api/proxy?u=${u}&cid=${encodeURIComponent(c.id)}`)
  const body = await m.text()
  console.log(`  manifest: ${m.status} ${body.length}b cache=${m.headers.get('x-vyora-cache')} in ${Date.now() - t}ms`)
  const seg = body.split('\n').find((l) => l.startsWith('/api/proxy?'))
  if (seg) {
    t = Date.now()
    const s = await fetch(`${base}${seg}`)
    const sb = Buffer.from(await s.arrayBuffer())
    const ms = Date.now() - t
    console.log(`  segment: ${s.status} ${sb.length}b in ${ms}ms -> ${Math.round((sb.length * 8) / ms)} kbps`)
  }
}

const net2 = await api('/api/network')
console.log('\nnetwork after:', JSON.stringify(net2))

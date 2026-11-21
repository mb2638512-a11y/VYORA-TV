import fs from 'node:fs'

const base = 'http://127.0.0.1:8787'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url')

const list = await (await fetch(`${base}/api/channels?country=AE&limit=40`)).json()
const ch = list.channels.find((c) => /cartoon/i.test(c.name)) || list.channels[0]
console.log('channel:', ch.id, ch.name, 'streams:', ch.streams.length)

for (let i = 0; i < ch.streams.length; i++) {
  const s = ch.streams[i]
  console.log(`\n--- source ${i}: ${s.label} (${s.quality}) ---`)
  const u = b64(s.url)
  const t0 = Date.now()
  const res = await fetch(`${base}/api/proxy?u=${u}&cid=${encodeURIComponent(ch.id)}`)
  const body = await res.text()
  console.log(`  manifest: ${res.status} ${body.length}b cache=${res.headers.get('x-vyora-cache')} in ${Date.now() - t0}ms`)
  const lines = body.split('\n')
  const isMaster = body.includes('#EXT-X-STREAM-INF')
  const isMedia = body.includes('#EXTINF')
  console.log(`  master=${isMaster} media=${isMedia}`)
  console.log('  ' + lines.filter((l) => l.startsWith('#')).slice(0, 6).join('\n  '))

  const proxied = lines.filter((l) => l.startsWith('/api/proxy?'))
  for (const p of proxied.slice(0, 3)) {
    const t1 = Date.now()
    const r2 = await fetch(`${base}${p}`)
    const b2 = Buffer.from(await r2.arrayBuffer())
    console.log(`  child/segment: ${r2.status} ${b2.length}b in ${Date.now() - t1}ms -> ${Math.round((b2.length * 8) / Math.max(1, Date.now() - t1))} kbps`)
  }
}

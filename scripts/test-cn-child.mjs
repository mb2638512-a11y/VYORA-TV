import fs from 'node:fs'

const base = 'http://127.0.0.1:8787'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url')

const list = await (await fetch(`${base}/api/channels?country=AE&limit=40`)).json()
const ch = list.channels.find((c) => /cartoon/i.test(c.name))
const s0 = ch.streams[0]
console.log('stream url:', s0.url)

const res = await fetch(`${base}/api/proxy?u=${b64(s0.url)}&cid=${ch.id}`)
const body = await res.text()
const lines = body.split('\n')

const raw = lines.filter((l) => l.startsWith('/api/proxy?')).slice(0, 2)
for (const r of raw) {
  const target = Buffer.from(new URL(r, base).searchParams.get('u'), 'base64url').toString('utf8')
  console.log('\nchild target:', target.slice(0, 120))
  for (const [label, opts] of [
    ['direct ', {}],
    ['proxy  ', { dispatcher: undefined, proxy: undefined }],
  ]) {
    const t0 = Date.now()
    try {
      const r3 = await fetch(target, { ...opts, signal: AbortSignal.timeout(20000) })
      const b3 = Buffer.from(await r3.arrayBuffer())
      console.log(`  ${label}: ${r3.status} ${b3.length}b in ${Date.now() - t0}ms`)
      if (r3.status !== 200) console.log(`     body: ${b3.toString('utf8').slice(0, 120)}`)
    } catch (e) {
      console.log(`  ${label}: FAILED ${e.message}`)
    }
  }
}

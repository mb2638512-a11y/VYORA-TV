import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = 'http://127.0.0.1:8787'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url')

const list = await (await fetch(`${base}/api/channels?country=PK&limit=5`)).json()
const ch = list.channels[0]
console.log('channel', ch.id)

const manifest = await (await fetch(`${base}/api/proxy?u=${b64(ch.streams[0].url)}&cid=${ch.id}`)).text()
const segLine = manifest.split('\n').find((l) => l.startsWith('/api/proxy?'))
if (!segLine) {
  console.log('no segment line; manifest:\n' + manifest.slice(0, 400))
  process.exit(0)
}
const target = new URL(segLine, base).searchParams.get('u')
const real = Buffer.from(target, 'base64url').toString('utf8')
console.log('target:', real)

async function timed(label, args) {
  const t0 = Date.now()
  try {
    const res = await fetch(real, { ...args, signal: AbortSignal.timeout(30000) })
    const buf = Buffer.from(await res.arrayBuffer())
    const ms = Date.now() - t0
    console.log(
      `  ${label}: ${res.status} ${buf.length}b in ${ms}ms (${Math.round((buf.length * 8) / ms)} kbps)`,
    )
  } catch (e) {
    console.log(`  ${label}: FAILED in ${Date.now() - t0}ms - ${e.message}`)
  }
}

console.log('--- segment fetch paths ---')
await timed('direct  ', {})
console.log('--- manifest fetch paths ---')
const t1 = Date.now()
try {
  const res = await fetch(ch.streams[0].url, { signal: AbortSignal.timeout(30000) })
  const b = Buffer.from(await res.arrayBuffer())
  console.log(`  direct manifest: ${res.status} ${b.length}b in ${Date.now() - t1}ms`)
} catch (e) {
  console.log(`  direct manifest: FAILED in ${Date.now() - t1}ms - ${e.message}`)
}

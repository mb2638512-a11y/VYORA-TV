import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = 'http://127.0.0.1:8787'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url')
const PROXY = 'http://127.0.0.1:8080'

const list = await (await fetch(`${base}/api/channels?country=PK&limit=5`)).json()
const ch = list.channels[0]

const manifest = await (await fetch(`${base}/api/proxy?u=${b64(ch.streams[0].url)}&cid=${ch.id}`)).text()
const segLine = manifest.split('\n').find((l) => l.startsWith('/api/proxy?'))
const target = Buffer.from(new URL(segLine, base).searchParams.get('u'), 'base64url').toString('utf8')

async function timed(label, url, opts = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) })
    const buf = Buffer.from(await res.arrayBuffer())
    const ms = Date.now() - t0
    console.log(`  ${label}: ${res.status} ${buf.length}b in ${ms}ms -> ${Math.round((buf.length * 8) / ms)} kbps`)
    return Math.round((buf.length * 8) / ms)
  } catch (e) {
    console.log(`  ${label}: FAILED in ${Date.now() - t0}ms - ${e.message}`)
    return 0
  }
}

console.log(`target: ${target}\n`)
console.log('--- same segment, two routes ---')
await timed('direct ', target)
await timed('proxy  ', target, { dispatcher: undefined })

console.log('\n--- other public CDNs (direct) ---')
await timed('iptv-org', 'https://iptv-org.github.io/iptv/index.m3u')
await timed('pluto   ', 'https://images.pluto.tv/channels/62ba60f059624e000781c436/colorLogoPNG.png')
await timed('gstatic ', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4')

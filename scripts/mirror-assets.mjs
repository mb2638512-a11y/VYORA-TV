/**
 * Vyora TV - local asset mirror
 * ------------------------------------------------------------------
 * Downloads every channel logo once into the platform's own cache
 * (server/data/logos) so the UI never waits for a foreign CDN.
 *
 *   node scripts/mirror-assets.mjs [--concurrency 24] [--limit 0]
 *
 * The server serves these files from disk in ~5 ms, the static web build and
 * the Android TV app can embed them as well.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA = path.join(ROOT, 'server', 'data')
const CACHE = path.join(DATA, 'logos')

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const CONCURRENCY = Number(argOf('concurrency', '24'))
const LIMIT = Number(argOf('limit', '0'))
const MIN_BYTES = 200

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function key(url) {
  return crypto.createHash('sha1').update(url).digest('hex')
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true })
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))

  // every unique logo url in the catalogue
  const urls = new Set()
  for (const c of index.countries) {
    const file = path.join(DATA, 'channels', `${c.code}.json`)
    if (!fs.existsSync(file)) continue
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const ch of list) if (ch.logo) urls.add(ch.logo)
  }
  let queue = [...urls]
  if (LIMIT > 0) queue = queue.slice(0, LIMIT)

  console.log(
    `[mirror] ${queue.length} unique logos, concurrency ${CONCURRENCY}, cache ${CACHE}`,
  )

  let done = 0
  let failed = 0
  let bytes = 0
  let skipped = 0
  const started = Date.now()

  const worker = async () => {
    while (queue.length) {
      const url = queue.shift()
      const k = key(url)
      const file = path.join(CACHE, `${k}.img`)
      const typeFile = path.join(CACHE, `${k}.type`)
      if (fs.existsSync(file) && fs.existsSync(typeFile)) {
        skipped++
        continue
      }
      let ok = false
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 20000)
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
            redirect: 'follow',
            signal: ctrl.signal,
          })
          clearTimeout(timer)
          if (!res.ok) {
            if (res.status >= 500 && attempt === 0) continue
            break
          }
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length < MIN_BYTES) break
          fs.writeFileSync(file, buf)
          fs.writeFileSync(
            typeFile,
            res.headers.get('content-type') || 'image/png',
          )
          bytes += buf.length
          ok = true
        } catch {
          clearTimeout(timer)
        }
      }
      done++
      if (!ok) failed++
      if (done % 100 === 0) {
        const secs = (Date.now() - started) / 1000
        const rate = done / secs
        const eta = Math.round((queue.length + failed) / rate)
        console.log(
          `[mirror] ${done}/${done + queue.length} ok=${done - failed} fail=${failed} ` +
            `size=${(bytes / 1024 / 1024).toFixed(1)}MB rate=${rate.toFixed(1)}/s eta=${eta}s`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log(
    `[mirror] finished in ${((Date.now() - started) / 1000).toFixed(0)}s | ` +
      `downloaded ${done - failed}, failed ${failed}, skipped(cached) ${skipped}, ` +
      `total ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  )
}

main().catch((err) => {
  console.error('[mirror] failed:', err)
  process.exit(1)
})

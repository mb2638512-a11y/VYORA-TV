import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

for (const p of ['server/data/index.json', 'web/public/data/index.json']) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))
  console.log(p, 'generatedAt', j.generatedAt, 'totals', JSON.stringify(j.totals), 'featured', JSON.stringify(j.featured))
}

const m3u = fs.readFileSync(path.join(ROOT, 'data/raw/index.m3u'), 'utf8')
const lines = m3u.split(/\r?\n/).slice(0, 24)
console.log('--- first lines of index.m3u ---')
for (const l of lines) console.log(l.slice(0, 200))

const extinf = [...m3u.matchAll(/^#EXTINF:([^\n]*)$/gm)]
console.log('EXTINF count', extinf.length)
console.log('sample EXTINF attrs:', extinf[0]?.[1]?.slice(0, 250))

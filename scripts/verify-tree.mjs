import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function countTree(dir) {
  let channels = 0
  let streams = 0
  let files = 0
  const codes = []
  if (!fs.existsSync(dir)) return { channels, streams, files }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const list = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    if (!Array.isArray(list)) continue
    files++
    codes.push(f.replace('.json', ''))
    channels += list.length
    for (const c of list) streams += (c.streams || []).length
  }
  return { channels, streams, files, codes }
}

for (const base of ['server/data/channels', 'web/public/data/channels']) {
  const r = countTree(path.join(ROOT, base))
  console.log(base, JSON.stringify({ files: r.files, channels: r.channels, streams: r.streams }))
}

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/index.json'), 'utf8'))
console.log('index.json totals:', JSON.stringify(idx.totals), 'generatedAt', idx.generatedAt)

const st = fs.statSync(path.join(ROOT, 'server/data/index.json'))
console.log('index.json mtime:', st.mtime.toISOString())
const one = fs.statSync(path.join(ROOT, 'server/data/channels/PK.json'))
console.log('PK.json mtime:', one.mtime.toISOString())

// how many channels per country file vs country list counts
let mismatch = 0
for (const c of idx.countries) {
  const f = path.join(ROOT, 'server/data/channels', `${c.code}.json`)
  if (!fs.existsSync(f)) {
    mismatch++
    continue
  }
  const list = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (list.length !== c.count) mismatch++
}
console.log('countries whose file count mismatches index:', mismatch, 'of', idx.countries.length)

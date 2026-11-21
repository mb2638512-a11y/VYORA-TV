import fs from 'node:fs'
import path from 'node:path'

const dir = 'E:/Vyora TV/server/data/channels'
const idx = JSON.parse(fs.readFileSync('E:/Vyora TV/server/data/index.json', 'utf8'))

let total = 0
let withLogo = 0
let withQuality = 0
let hls = 0
let dash = 0
const qDist = {}
const feat = {}

for (const c of idx.countries) {
  const list = JSON.parse(fs.readFileSync(path.join(dir, `${c.code}.json`), 'utf8'))
  total += list.length
  let logo = 0
  let qual = 0
  for (const ch of list) {
    if (ch.logo) {
      logo++
      withLogo++
    }
    const best = ch.streams?.[0]
    if (best?.label) {
      qual++
      withQuality++
      qDist[best.label] = (qDist[best.label] || 0) + 1
    }
    for (const s of ch.streams || []) {
      if (s.hls) hls++
      else dash++
    }
  }
  if (['PK', 'IN', 'US', 'UK', 'AE', 'SA'].includes(c.code)) {
    feat[c.code] = { channels: list.length, withLogo: logo, withQuality: qual }
  }
}

console.log('total channels:', total)
console.log('with logo:', withLogo, `(${((withLogo / total) * 100).toFixed(1)}%)`)
console.log('with quality label:', withQuality, `(${((withQuality / total) * 100).toFixed(1)}%)`)
console.log('hls streams:', hls, '| non-hls streams:', dash)
console.log('top quality labels:', JSON.stringify(Object.entries(qDist).sort((a, b) => b[1] - a[1]).slice(0, 12)))
console.log('featured:', JSON.stringify(feat, null, 1))

const pk = JSON.parse(fs.readFileSync(path.join(dir, 'PK.json'), 'utf8'))
const sample = pk.find((c) => c.streams?.length > 1) || pk[0]
console.log('sample PK channel:', JSON.stringify({ name: sample.name, logo: sample.logo, cats: sample.categories, streams: sample.streams.map((s) => s.label) }, null, 1))

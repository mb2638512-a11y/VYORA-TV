/**
 * End-to-end verification of the generated dataset.
 * Checks every country file, the counts, the logos, the qualities and the
 * stream URLs, and prints a report.
 */
import fs from 'node:fs'
import path from 'node:path'

const DATA = 'E:/Vyora TV/server/data'
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))

let problems = []
let totalChannels = 0
let totalStreams = 0
let withLogo = 0
let withQuality = 0
let hls = 0
let dash = 0
let other = 0
const qualityDist = {}
const perCountry = []

for (const c of index.countries) {
  const file = path.join(DATA, 'channels', `${c.code}.json`)
  if (!fs.existsSync(file)) {
    problems.push(`${c.code}: file missing`)
    continue
  }
  let list
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    problems.push(`${c.code}: invalid JSON (${e.message})`)
    continue
  }
  if (list.length !== c.count) {
    problems.push(`${c.code}: count mismatch index=${c.count} file=${list.length}`)
  }
  let noStream = 0
  let noLogo = 0
  for (const ch of list) {
    totalChannels++
    if (!ch.streams || ch.streams.length === 0) {
      noStream++
      problems.push(`${c.code}/${ch.id}: no streams`)
    }
    if (!ch.logo) noLogo++
    else withLogo++
    for (const s of ch.streams || []) {
      totalStreams++
      if (!/^https?:\/\//i.test(s.url)) {
        problems.push(`${c.code}/${ch.id}: bad url ${s.url}`)
      }
      const label = s.label || 'none'
      qualityDist[label] = (qualityDist[label] || 0) + 1
      if (label && label !== 'HLS' && label !== 'Auto') withQuality++
      if (/\.m3u8/i.test(s.url)) hls++
      else if (/\.mpd/i.test(s.url)) dash++
      else other++
    }
  }
  perCountry.push({ code: c.code, name: c.name, count: list.length, noLogo, noStream })
}

/* category counts cross-check */
const catCount = new Map()
for (const c of index.countries) {
  const list = JSON.parse(fs.readFileSync(path.join(DATA, 'channels', `${c.code}.json`), 'utf8'))
  for (const ch of list) for (const cat of ch.categories) catCount.set(cat, (catCount.get(cat) || 0) + 1)
}
for (const cat of index.categories) {
  const real = catCount.get(cat.id) || 0
  if (real !== cat.count) problems.push(`category ${cat.id}: index=${cat.count} real=${real}`)
}

/* featured countries sanity */
const feat = index.featured.map((code) => {
  const c = index.countries.find((x) => x.code === code)
  return c ? `${code}=${c.count}` : `${code}=MISSING`
})

const noLogoCountries = perCountry.filter((c) => c.noLogo > 0)
const emptyCountries = perCountry.filter((c) => c.count === 0)

console.log('=== VYORA TV DATASET VERIFICATION ===')
console.log(`countries        : ${index.countries.length}`)
console.log(`channels         : ${totalChannels}`)
console.log(`streams          : ${totalStreams}  (hls ${hls} / dash ${dash} / other ${other})`)
console.log(`with real logo   : ${withLogo} (${((withLogo / totalChannels) * 100).toFixed(1)}%)`)
console.log(`with quality     : ${withQuality} (${((withQuality / totalChannels) * 100).toFixed(1)}%)`)
console.log(`featured counts  : ${feat.join('  ')}`)
console.log(`countries w/o logo: ${noLogoCountries.length ? noLogoCountries.map((c) => `${c.code}(${c.noLogo})`).join(' ') : 'none'}`)
console.log(`empty countries  : ${emptyCountries.length ? emptyCountries.map((c) => c.code).join(' ') : 'none'}`)
console.log(`top qualities    : ${JSON.stringify(Object.entries(qualityDist).sort((a, b) => b[1] - a[1]).slice(0, 10))}`)
console.log(`problems         : ${problems.length}`)
if (problems.length) {
  for (const p of problems.slice(0, 25)) console.log('   ! ' + p)
  if (problems.length > 25) console.log(`   ... +${problems.length - 25} more`)
  process.exitCode = 1
} else {
  console.log('RESULT           : ALL CHECKS PASSED ✅')
}

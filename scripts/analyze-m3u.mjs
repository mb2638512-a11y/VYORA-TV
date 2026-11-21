import fs from 'node:fs'

const t = fs.readFileSync('E:/Vyora TV/data/raw/index.m3u', 'utf8')
const lines = t.split(/\r?\n/)
let cur = null
const entries = []
for (const l of lines) {
  if (l.startsWith('#EXTINF')) {
    const id = (l.match(/tvg-id="([^"]*)"/) || [])[1] || ''
    const logo = (l.match(/tvg-logo="([^"]*)"/) || [])[1] || ''
    const grp = (l.match(/group-title="([^"]*)"/) || [])[1] || ''
    const name = l.split(',').slice(1).join(',').trim()
    cur = { id, logo, grp, name, url: '' }
  } else if (l && !l.startsWith('#') && cur) {
    cur.url = l
    entries.push(cur)
    cur = null
  }
}

console.log('parsed entries:', entries.length)
console.log('with logo:', entries.filter((e) => e.logo).length)

const q = {}
for (const e of entries) {
  const m = e.name.match(/\((\d{3,4}p|4K|SD|HD|UHD)\)/i)
  const k = m
    ? m[1].toUpperCase()
    : e.id.includes('@')
      ? e.id.split('@')[1]
      : 'none'
  q[k] = (q[k] || 0) + 1
}
console.log('quality buckets:', JSON.stringify(q))

const cc = {}
for (const e of entries) {
  const parts = e.id.split('.')
  const c = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'INT'
  cc[c] = (cc[c] || 0) + 1
}
console.log(
  'top country suffixes:',
  JSON.stringify(Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 14)),
)
console.log(
  'featured:',
  ['PK', 'IN', 'US', 'UK', 'AE', 'SA'].map((c) => `${c}=${cc[c] || 0}`).join(' '),
)

const exts = {}
for (const e of entries) {
  const m = e.url.match(/\.([a-z0-9]{3,5})(\?|$)/i)
  const k = m ? m[1] : 'other'
  exts[k] = (exts[k] || 0) + 1
}
console.log('url types:', JSON.stringify(exts))

const groups = {}
for (const e of entries) groups[e.grp] = (groups[e.grp] || 0) + 1
console.log('groups:', JSON.stringify(Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 20)))

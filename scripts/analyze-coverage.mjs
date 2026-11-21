/**
 * Coverage analysis: why are channels dropped from the dataset?
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAW = path.resolve(__dirname, '..', 'data', 'raw')

const ch = JSON.parse(fs.readFileSync(path.join(RAW, 'channels.json'), 'utf8'))
const st = JSON.parse(fs.readFileSync(path.join(RAW, 'streams.json'), 'utf8'))
const m3u = fs.readFileSync(path.join(RAW, 'index.m3u'), 'utf8')

const closed = ch.filter((c) => c.closed).length
const nsfw = ch.filter((c) => c.is_nsfw).length
console.log('channels.json total      :', ch.length)
console.log('  closed (date set)      :', closed)
console.log('  is_nsfw                :', nsfw)

const byCh = new Map()
let orphanStreams = 0
for (const s of st) {
  if (!s.channel) {
    orphanStreams++
    continue
  }
  byCh.set(s.channel, (byCh.get(s.channel) || 0) + 1)
}
console.log('streams.json total       :', st.length)
console.log('  with channel ref       :', byCh.size)
console.log('  orphan (no channel)    :', orphanStreams)

const withStream = ch.filter((c) => byCh.has(c.id))
console.log('channels w/ dir streams  :', withStream.length)
console.log('  of those, closed       :', withStream.filter((c) => c.closed).length)
console.log('  of those, nsfw         :', withStream.filter((c) => c.is_nsfw).length)

// m3u ids
const ids = new Set()
const re = /tvg-id="([^"]+)"/g
let m
while ((m = re.exec(m3u))) ids.add(m[1])
const chIds = new Set(ch.map((c) => c.id))
const m3uOnly = [...ids].filter((i) => !chIds.has(i))
console.log('m3u unique tvg-id        :', ids.size)
console.log('  m3u ids missing in dir :', m3uOnly.length)

const dirWithM3u = [...ids].filter((i) => chIds.has(i)).length
console.log('  dir+m3u overlap        :', dirWithM3u)

// potential total if closed + nsfw were allowed
const playable = withStream.filter((c) => !c.is_nsfw)
console.log('non-nsfw channels w/ dir streams :', playable.length)
console.log('  incl. closed                    :', playable.length)
const playableNonClosed = playable.filter((c) => !c.closed)
console.log('  excl. closed                    :', playableNonClosed.length)

// streams attached to channels that are closed
const closedStreamCount = withStream.filter((c) => c.closed).reduce((n, c) => n + byCh.get(c.id), 0)
console.log('streams attached to closed channels:', closedStreamCount)

// current dataset
const cur = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'server', 'data', 'index.json'), 'utf8'))
console.log('current dataset channels  :', cur.totals.channels, 'streams:', cur.totals.streams)

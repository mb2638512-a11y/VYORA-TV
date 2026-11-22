import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const catalogFiles = ['index.json', 'movies.json', 'series.json', 'songs.json']
const mirrorRoots = [
  'server/data/vod',
  'web/public/data/vod',
  'web/dist/data/vod',
  'android/app/assets/data/vod',
]

function fail(message) {
  throw new Error(`VOD catalogue validation failed: ${message}`)
}

function requireUniqueIds(items, label) {
  const seen = new Set()
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      fail(`${label} contains an item without a non-empty id`)
    }
    if (seen.has(item.id)) fail(`${label} contains duplicate id "${item.id}"`)
    seen.add(item.id)
  }
}

function validateUrl(raw, label) {
  if (typeof raw !== 'string' || !raw.trim()) fail(`${label} has an empty URL`)
  let parsed
  try { parsed = new URL(raw) } catch { fail(`${label} has an invalid URL: ${raw}`) }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    fail(`${label} uses an unsupported or credential-bearing URL`)
  }
}

function validateStreams(items, label) {
  for (const item of items) {
    const streams = Array.isArray(item.streams) ? item.streams : []
    if (streams.length) {
      for (const stream of streams) validateUrl(stream?.url, `${label} ${item.id} stream`)
    } else if (item.url) {
      validateUrl(item.url, `${label} ${item.id}`)
    } else {
      fail(`${label} ${item.id} has no playable URL`)
    }
  }
}

const serverDir = path.join(root, 'server/data/vod')
const [indexRaw, moviesRaw, seriesRaw, songsRaw] = await Promise.all(
  catalogFiles.map((name) => fs.readFile(path.join(serverDir, name), 'utf8')),
)
const index = JSON.parse(indexRaw)
const movies = JSON.parse(moviesRaw)
const series = JSON.parse(seriesRaw)
const songs = JSON.parse(songsRaw)

for (const [name, items] of [['movies', movies], ['series', series], ['songs', songs]]) {
  if (!Array.isArray(items) || items.length === 0) fail(`${name}.json must contain a non-empty array`)
  requireUniqueIds(items, name)
}
for (const movie of movies) {
  if (typeof movie.title !== 'string' || !movie.title.trim()) fail(`movie ${movie.id} has no title`)
}
validateStreams(movies, 'movie')
for (const show of series) {
  if (typeof show.title !== 'string' || !show.title.trim() || !Array.isArray(show.episodes) || !show.episodes.length) {
    fail(`series ${show.id} must have a title and at least one episode`)
  }
  for (const episode of show.episodes) validateUrl(episode?.url, `series ${show.id} episode ${episode?.id || ''}`)
}
for (const song of songs) {
  if (typeof song.name !== 'string' || !song.name.trim()) fail(`song channel ${song.id} has no name`)
}
validateStreams(songs, 'song channel')

const totals = index?.totals || {}
for (const [key, actual] of [['movies', movies.length], ['series', series.length], ['songs', songs.length]]) {
  if (Number(totals[key]) !== actual) fail(`index totals.${key}=${totals[key]} but catalogue has ${actual}`)
}

for (const dir of mirrorRoots) {
  for (let i = 0; i < catalogFiles.length; i++) {
    const actual = await fs.readFile(path.join(root, dir, catalogFiles[i]))
    const expected = Buffer.from([indexRaw, moviesRaw, seriesRaw, songsRaw][i])
    if (!actual.equals(expected)) fail(`${dir}/${catalogFiles[i]} is out of sync with server/data/vod`)
  }
}

console.log(`VOD catalogue OK: ${movies.length} movies, ${series.length} series, ${songs.length} music channels; all URLs and 4 data mirrors validated.`)

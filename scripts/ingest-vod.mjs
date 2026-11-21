/**
 * Vyora TV - VOD Ingestion Engine (Movies & Web Series)
 * ----------------------------------------------------
 * Downloads and parses verified on-demand movies & series playlists:
 *   - Nexonic Movies VOD (1,800+ movies)
 *   - Nexonic Series VOD (200+ series episodes)
 *   - PublicDomainM3U Movies & Series
 *   - Legal Free IPTV VOD
 *   - ArchiveWatch VOD feeds
 *
 * Emits clean, deduplicated, categorized VOD datasets:
 *   - server/data/vod/movies.json
 *   - server/data/vod/series.json
 *   - server/data/vod/index.json
 * And mirrors them into web/public/data/vod/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_VOD = path.join(ROOT, 'data', 'raw', 'vod')
const SERVER_VOD = path.join(ROOT, 'server', 'data', 'vod')
const WEB_VOD = path.join(ROOT, 'web', 'public', 'data', 'vod')

fs.mkdirSync(RAW_VOD, { recursive: true })
fs.mkdirSync(SERVER_VOD, { recursive: true })
fs.mkdirSync(WEB_VOD, { recursive: true })

const VOD_SOURCES = [
  {
    type: 'movies',
    name: 'Nexonic Movies',
    file: 'nexonic_movies.m3u',
    url: 'https://shahrukhalid.github.io/nexonic-iptv/playlists/vod/movies.m3u',
  },
  {
    type: 'series',
    name: 'Nexonic Series',
    file: 'nexonic_series.m3u',
    url: 'https://shahrukhalid.github.io/nexonic-iptv/playlists/vod/series.m3u',
  },
  {
    type: 'movies',
    name: 'PublicDomain Movies',
    file: 'publicdomain_movies.m3u',
    url: 'https://raw.githubusercontent.com/onlinem3u/publicdomainm3u/main/movies.m3u',
  },
  {
    type: 'series',
    name: 'PublicDomain Series',
    file: 'publicdomain_series.m3u',
    url: 'https://raw.githubusercontent.com/onlinem3u/publicdomainm3u/main/series.m3u',
  },
  {
    type: 'movies',
    name: 'Legal Free IPTV VOD',
    file: 'legalfree_vod.m3u',
    url: 'https://biskyt.github.io/legalFreeIPTVplaylist/vod.m3u',
  },
  {
    type: 'movies',
    name: 'ArchiveWatch Live Movies',
    file: 'archivewatch_live.m3u',
    url: 'https://archivewatch.org/feeds/live.m3u',
  },
]

async function downloadSource(src) {
  const destPath = path.join(RAW_VOD, src.file)
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 500) {
    console.log(`[vod] Using cached ${src.name} (${(fs.statSync(destPath).size / 1024).toFixed(1)} KB)`)
    return fs.readFileSync(destPath, 'utf8')
  }

  console.log(`[vod] Downloading ${src.name}...`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(src.url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 VyoraTV/1.0',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    fs.writeFileSync(destPath, text, 'utf8')
    console.log(`[vod] -> Saved ${src.name} (${(text.length / 1024).toFixed(1)} KB)`)
    return text
  } catch (err) {
    console.warn(`[vod] Failed downloading ${src.name}: ${err.message}`)
    return fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : ''
  } finally {
    clearTimeout(timer)
  }
}

function cleanTitle(raw) {
  return String(raw || '')
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeGenre(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s || s === 'movies' || s === 'vod' || s === 'general') return 'Classic'
  if (s.includes('action')) return 'Action'
  if (s.includes('comedy')) return 'Comedy'
  if (s.includes('horror')) return 'Horror'
  if (s.includes('sci-fi') || s.includes('scifi') || s.includes('science')) return 'Sci-Fi'
  if (s.includes('doc')) return 'Documentary'
  if (s.includes('noir')) return 'Film Noir'
  if (s.includes('drama')) return 'Drama'
  if (s.includes('advent')) return 'Adventure'
  if (s.includes('anim') || s.includes('cartoon')) return 'Animation'
  if (s.includes('myster') || s.includes('thrill')) return 'Mystery'
  if (s.includes('crime')) return 'Crime'
  if (s.includes('west')) return 'Western'
  if (s.includes('romance') || s.includes('love')) return 'Romance'
  if (s.includes('fam') || s.includes('kid')) return 'Family'
  if (s.includes('war')) return 'War'
  // Capitalize words
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function parseM3UVod(content, defaultType = 'movies', sourceName = '') {
  const lines = content.split(/\r?\n/)
  const movies = []
  const seriesEpisodes = []
  let cur = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('#EXTINF')) {
      const durMatch = trimmed.match(/#EXTINF:(-?\d+)/)
      const duration = durMatch ? Math.max(0, parseInt(durMatch[1], 10)) : 0
      const nameMatch = (trimmed.match(/tvg-name="([^"]*)"/) || [])[1] || ''
      const logoMatch = (trimmed.match(/tvg-logo="([^"]*)"/) || [])[1] || ''
      const groupMatch = (trimmed.match(/group-title="([^"]*)"/) || [])[1] || ''
      const typeMatch = (trimmed.match(/x-type="([^"]*)"/) || [])[1] || defaultType
      const yearMatch = (trimmed.match(/x-year="([^"]*)"/) || [])[1] || ''
      const rawTitle = trimmed.split(',').slice(1).join(',').trim()

      const title = cleanTitle(nameMatch || rawTitle)
      let year = yearMatch
      if (!year) {
        const yMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/)
        if (yMatch) year = yMatch[1]
      }

      cur = {
        title,
        logo: logoMatch,
        genre: normalizeGenre(groupMatch),
        type: typeMatch.toLowerCase() === 'series' ? 'series' : 'movies',
        year: year ? parseInt(year, 10) : undefined,
        duration,
        source: sourceName,
        rawGroup: groupMatch,
      }
    } else if (!trimmed.startsWith('#') && cur) {
      if (/^https?:\/\//i.test(trimmed)) {
        cur.url = trimmed
        if (cur.type === 'series') {
          seriesEpisodes.push(cur)
        } else {
          movies.push(cur)
        }
      }
      cur = null
    }
  }

  return { movies, seriesEpisodes }
}

async function main() {
  console.log('[vod] Starting Vyora TV VOD Ingestion Engine...')
  const t0 = Date.now()

  const allMovies = []
  const allSeriesEpisodes = []

  for (const src of VOD_SOURCES) {
    const text = await downloadSource(src)
    if (!text) continue
    const { movies, seriesEpisodes } = parseM3UVod(text, src.type, src.name)
    console.log(`[vod] -> ${src.name}: ${movies.length} movies, ${seriesEpisodes.length} series episodes.`)
    allMovies.push(...movies)
    allSeriesEpisodes.push(...seriesEpisodes)
  }

  // Deduplicate and index movies
  const moviesById = new Map()
  for (const m of allMovies) {
    if (!m.title || !m.url) continue
    const id = m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + (m.year ? `-${m.year}` : '')
    if (moviesById.has(id)) {
      // If existing has no logo and new one does, enrich
      const existing = moviesById.get(id)
      if (!existing.logo && m.logo) existing.logo = m.logo
      continue
    }
    moviesById.set(id, {
      id,
      title: m.title,
      logo: m.logo,
      genre: m.genre,
      year: m.year,
      duration: m.duration,
      url: m.url,
      source: m.source,
    })
  }

  // Deduplicate and group series episodes
  const seriesByName = new Map()
  for (const ep of allSeriesEpisodes) {
    if (!ep.title || !ep.url) continue
    // Detect series name: e.g. "Fireball XL5 - 1x01 - Planet 46" or group-title
    let seriesTitle = ep.rawGroup || ''
    let season = 1
    let episodeNum = 1
    let episodeTitle = ep.title

    const seMatch = ep.title.match(/(\d+)x(\d+)|S(\d+)E(\d+)/i)
    if (seMatch) {
      season = parseInt(seMatch[1] || seMatch[3] || '1', 10)
      episodeNum = parseInt(seMatch[2] || seMatch[4] || '1', 10)
    }

    if (!seriesTitle || seriesTitle.toLowerCase() === 'series') {
      const parts = ep.title.split(/ - | \d+x\d+ | S\d+E\d+ /i)
      if (parts.length > 1) {
        seriesTitle = cleanTitle(parts[0])
        episodeTitle = parts[1].trim()
      } else {
        seriesTitle = ep.title
      }
    }

    seriesTitle = cleanTitle(seriesTitle)
    const seriesId = seriesTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    let series = seriesByName.get(seriesId)
    if (!series) {
      series = {
        id: seriesId,
        title: seriesTitle,
        logo: ep.logo,
        genre: ep.genre,
        year: ep.year,
        episodes: [],
        source: ep.source,
      }
      seriesByName.set(seriesId, series)
    }

    if (!series.logo && ep.logo) series.logo = ep.logo

    series.episodes.push({
      id: `${seriesId}-s${season}e${episodeNum}`,
      title: episodeTitle,
      season,
      episode: episodeNum,
      duration: ep.duration,
      url: ep.url,
      logo: ep.logo,
    })
  }

  // Sort series episodes by season then episode
  for (const series of seriesByName.values()) {
    series.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode)
  }

  const finalMovies = Array.from(moviesById.values()).sort((a, b) => a.title.localeCompare(b.title))
  const finalSeries = Array.from(seriesByName.values()).sort((a, b) => a.title.localeCompare(b.title))

  // Collect genres and counts
  const movieGenres = {}
  for (const m of finalMovies) {
    movieGenres[m.genre] = (movieGenres[m.genre] || 0) + 1
  }
  const seriesGenres = {}
  for (const s of finalSeries) {
    seriesGenres[s.genre] = (seriesGenres[s.genre] || 0) + 1
  }

  const vodIndex = {
    generatedAt: new Date().toISOString(),
    totals: {
      movies: finalMovies.length,
      series: finalSeries.length,
      episodes: finalSeries.reduce((acc, s) => acc + s.episodes.length, 0),
    },
    movieGenres,
    seriesGenres,
  }

  // Write datasets to server/data/vod and web/public/data/vod
  fs.writeFileSync(path.join(SERVER_VOD, 'movies.json'), JSON.stringify(finalMovies), 'utf8')
  fs.writeFileSync(path.join(SERVER_VOD, 'series.json'), JSON.stringify(finalSeries), 'utf8')
  fs.writeFileSync(path.join(SERVER_VOD, 'index.json'), JSON.stringify(vodIndex, null, 2), 'utf8')

  fs.writeFileSync(path.join(WEB_VOD, 'movies.json'), JSON.stringify(finalMovies), 'utf8')
  fs.writeFileSync(path.join(WEB_VOD, 'series.json'), JSON.stringify(finalSeries), 'utf8')
  fs.writeFileSync(path.join(WEB_VOD, 'index.json'), JSON.stringify(vodIndex, null, 2), 'utf8')

  console.log(`[vod] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s!`)
  console.log(`[vod] Ingested ${finalMovies.length} movies and ${finalSeries.length} web series (${vodIndex.totals.episodes} episodes).`)
  console.log(`[vod] Movie Genres:`, Object.keys(movieGenres).join(', '))
}

main().catch((err) => {
  console.error('[vod] FATAL:', err)
  process.exit(1)
})

/**
 * Vyora TV - data pipeline v2
 * ------------------------------------------------------------------
 * Merges two public sources into one production dataset:
 *
 *   1. data/raw/channels.json + streams.json + logos.json  (directory)
 *   2. data/raw/index.m3u                                    (official playlist)
 *
 * The playlist carries the real logo URL (tvg-logo), the real category
 * (group-title), the country (id suffix) and the real resolution
 * ("... (1080p)" / "@SD" / "@HD").
 *
 * Output:
 *   server/data/index.json            -> countries, categories, counts
 *   server/data/channels/<CODE>.json  -> channels (with quality-ranked streams)
 *   web/public/data/...               -> same tree for the static web build
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW = path.join(ROOT, 'data', 'raw')
const OUT_SERVER = path.join(ROOT, 'server', 'data')
const OUT_WEB = path.join(ROOT, 'web', 'public', 'data')

const EXCLUDED_CATEGORIES = new Set(['xxx'])
const VALID_URL = /^https?:\/\//i

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function readJSON(file, optional = false) {
  const p = path.join(RAW, file)
  if (!fs.existsSync(p)) {
    if (optional) return null
    throw new Error(`Missing raw file: ${file}`)
  }
  const txt = fs.readFileSync(p, 'utf8')
  if (!txt.trim()) {
    if (optional) return null
    throw new Error(`Empty raw file: ${file}`)
  }
  try {
    return JSON.parse(txt)
  } catch (err) {
    if (optional) {
      console.warn(`[data] skipping ${file}: ${err.message}`)
      return null
    }
    throw err
  }
}

const FLAG_CODE = { UK: 'gb', XK: 'xk' }

function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌐'
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}

function flagImage(code) {
  if (!code || code.length !== 2) return ''
  const iso = FLAG_CODE[code.toUpperCase()] || code.toLowerCase()
  return `https://flagcdn.com/w80/${iso}.png`
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function writeJSON(file, obj) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8')
  return fs.statSync(file).size
}

/* ------------------------------------------------------------------ */
/* quality handling                                                    */
/* ------------------------------------------------------------------ */

const QUALITY_RANK = {
  '2160p': 2160, '1440p': 1440, '1080p': 1080, '900p': 900, '720p': 720,
  '576p': 576, '540p': 540, '480p': 480, '360p': 360, '240p': 240,
}

function detectQuality(name, idSuffix, group) {
  const text = `${name} ${group || ''}`
  const m = text.match(/\(([^)]+)\)/)
  if (m && /2160p|4k|uhd|1440p|2k|1080p|1080i|720p|576p|540p|480p|360p|240p|1280p/i.test(m[1])) {
    return normalizeQuality(m[1])
  }
  if (idSuffix) {
    const s = normalizeQuality(idSuffix)
    if (s) return s
  }
  const bare = text.match(/2160p|1440p|1080p|1080i|720p|576p|540p|480p|360p|240p|\b4k\b|\buhd\b/i)
  if (bare) return normalizeQuality(bare[0])
  return ''
}

function normalizeQuality(raw) {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  if (s.includes('2160') || s === '4K' || s === 'UHD') return '2160p (4K)'
  if (s.includes('1440') || s === '2K') return '1440p (2K)'
  if (s.includes('1088') || s.includes('1086') || s.includes('1280')) return '1080p'
  if (s.includes('1080')) return '1080p'
  if (s.includes('720')) return '720p'
  if (s.includes('576')) return '576p'
  if (s.includes('540')) return '540p'
  if (s.includes('480')) return '480p'
  if (s.includes('360')) return '360p'
  if (s.includes('240')) return '240p'
  if (s === 'HD' || s === 'FHD' || s === 'FULLHD') return '720p'
  if (s === 'SD') return 'SD'
  return ''
}

function qualityScore(label) {
  if (!label) return 1
  const num = parseInt(label, 10)
  if (Number.isFinite(num)) return num
  if (label.includes('4K')) return 2160
  if (label.includes('2K')) return 1440
  if (label === 'SD') return 480
  return 10
}

function isHls(url) {
  return /\.m3u8(\?|$)/i.test(url)
}

/* ------------------------------------------------------------------ */
/* m3u parsing                                                         */
/* ------------------------------------------------------------------ */

function parseM3U(file) {
  if (!fs.existsSync(file)) return []
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const out = []
  let cur = null
  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const id = (line.match(/tvg-id="([^"]*)"/) || [])[1] || ''
      const logo = (line.match(/tvg-logo="([^"]*)"/) || [])[1] || ''
      const group = (line.match(/group-title="([^"]*)"/) || [])[1] || ''
      const name = line.split(',').slice(1).join(',').trim()
      cur = { id, logo, group, name, url: '' }
    } else if (line && !line.startsWith('#') && cur) {
      cur.url = line.trim()
      out.push(cur)
      cur = null
    }
  }
  return out
}

function cleanName(name) {
  return name
    .replace(/\(([^)]*)\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ */
/* local flag assets                                                   */
/* ------------------------------------------------------------------ */

/**
 * Flags are bundled locally (180 tiny PNGs). Loading them from a CDN took
 * 2-4 seconds each and blocked the browser's 6 connection slots, which made
 * the whole grid look broken.
 */
async function downloadFlags(countryList) {
  const dir = path.join(ROOT, 'web', 'public', 'flags')
  ensureDir(dir)
  const targets = countryList.filter((c) => c.flagImg)
  let done = 0
  let failed = 0

  const worker = async () => {
    while (targets.length) {
      const c = targets.shift()
      const file = path.join(dir, `${c.code.toLowerCase()}.png`)
      if (fs.existsSync(file) && fs.statSync(file).size > 100) {
        c.flagLocal = `flags/${c.code.toLowerCase()}.png`
        done++
        continue
      }
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 15000)
        const res = await fetch(c.flagImg, { signal: ctrl.signal })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`http ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 100) {
          fs.writeFileSync(file, buf)
          c.flagLocal = `flags/${c.code.toLowerCase()}.png`
          done++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, worker))
  console.log(`[data] flags bundled: ${done} ok, ${failed} failed`)
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const t0 = Date.now()
  console.log('[data] reading raw dump ...')
  const countries = readJSON('countries.json')
  const categories = readJSON('categories.json')
  const channels = readJSON('channels.json')
  const streams = readJSON('streams.json')
  const logos = readJSON('logos.json', true)

  const isoCodes = new Set(countries.map((c) => c.code))

  /* --- logos from directory --- */
  const logoByChannel = new Map()
  if (Array.isArray(logos)) {
    for (const l of logos) {
      if (!l || !l.channel || !l.url || !VALID_URL.test(l.url)) continue
      const score =
        (l.in_use ? 1000 : 0) +
        (String(l.format).toUpperCase() === 'PNG' ? 500 : 0) +
        Math.min(Number(l.width) || 0, 1000) / 1000
      const prev = logoByChannel.get(l.channel)
      if (!prev || score > prev.score) logoByChannel.set(l.channel, { url: l.url, score })
    }
  }

  /* --- directory streams --- */
  const streamsByChannel = new Map()
  for (const s of streams) {
    if (!s || !s.channel || !s.url || !VALID_URL.test(s.url)) continue
    const list = streamsByChannel.get(s.channel) || []
    list.push({
      url: s.url,
      quality: s.quality || '',
      referer: s.http_referrer || '',
      ua: s.http_user_agent || '',
    })
    streamsByChannel.set(s.channel, list)
  }

  /* --- playlist (m3u) --- */
  const m3u = parseM3U(path.join(RAW, 'index.m3u'))
  console.log(`[data] playlist entries: ${m3u.length}`)

  const playlistById = new Map() // base id -> {logo, group, name, country, streams[]}
  for (const e of m3u) {
    if (!e.url || !VALID_URL.test(e.url)) continue
    const rawId = e.id || ''
    const [baseId, idSuffix] = rawId.includes('@') ? rawId.split('@') : [rawId, '']
    if (!baseId) continue

    // country from the id suffix (e.g. "BBCNews.uk" -> UK)
    const parts = baseId.split('.')
    const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : ''
    const country = suffix.length === 2 && isoCodes.has(suffix) ? suffix : ''

    const group = (e.group || '').trim()
    const quality = detectQuality(e.name, idSuffix, group)

    let entry = playlistById.get(baseId)
    if (!entry) {
      entry = {
        id: baseId,
        name: cleanName(e.name) || baseId,
        logo: e.logo || '',
        group,
        country,
        streams: [],
      }
      playlistById.set(baseId, entry)
    }
    if (!entry.logo && e.logo) entry.logo = e.logo
    if (!entry.country && country) entry.country = country
    if (entry.group === 'Undefined' && group && group !== 'Undefined') entry.group = group

    entry.streams.push({
      url: e.url,
      quality,
      label: quality || (isHls(e.url) ? 'HLS' : 'Auto'),
      referer: '',
      ua: '',
    })
  }

  /* --- build channel records --- */
  const byCountry = new Map()
  const getList = (code) => {
    let l = byCountry.get(code)
    if (!l) {
      l = []
      byCountry.set(code, l)
    }
    return l
  }

  let skippedNSFW = 0
  let skippedNoStream = 0
  let fromPlaylistOnly = 0

  for (const ch of channels) {
    if (!ch || !ch.id || !ch.name) continue
    if (ch.is_nsfw === true) {
      skippedNSFW++
      continue
    }
    const cats = (ch.categories || []).filter((c) => !EXCLUDED_CATEGORIES.has(c))
    if ((ch.categories || []).some((c) => EXCLUDED_CATEGORIES.has(c))) {
      skippedNSFW++
      continue
    }

    const pl = playlistById.get(ch.id)
    const merged = [...(streamsByChannel.get(ch.id) || [])]
    if (pl) {
      for (const s of pl.streams) {
        if (!merged.some((m) => m.url === s.url)) merged.push(s)
      }
    }
    if (merged.length === 0) {
      skippedNoStream++
      continue
    }

    const code = (ch.country || pl?.country || '').toUpperCase()
    const record = {
      id: ch.id,
      name: ch.name,
      alt: ch.alt_names || [],
      network: ch.network || '',
      owner: (ch.owners && ch.owners[0]) || '',
      categories: cats.length ? cats : [groupToCategory(pl?.group) || 'general'],
      country: code || 'INT',
      website: ch.website || '',
      logo: logoByChannel.get(ch.id)?.url || pl?.logo || '',
      icon: logoByChannel.get(ch.id)?.url || pl?.logo || '',
      launched: ch.launched || null,
      closed: ch.closed || null,
      lang: ch.language || '',
      streams: [],
    }
    record.streams = rankStreams(merged, record)
    getList(record.country).push(record)
  }

  /* --- playlist-only channels (not in the directory) --- */
  for (const [id, pl] of playlistById) {
    if (byCountryHas(byCountry, id)) continue
    const cats = groupToCategory(pl.group)
    const code = pl.country || 'INT'
    const record = {
      id,
      name: pl.name,
      alt: [],
      network: '',
      owner: '',
      categories: cats ? [cats] : ['general'],
      country: code,
      website: '',
      logo: pl.logo || logoByChannel.get(id)?.url || '',
      icon: pl.logo || logoByChannel.get(id)?.url || '',
      launched: null,
      closed: null,
      lang: '',
      streams: [],
    }
    record.streams = rankStreams(pl.streams, record)
    if (!record.streams.length) continue
    getList(record.country).push(record)
    fromPlaylistOnly++
  }

  /* --- country metadata --- */
  const countryMeta = new Map()
  for (const c of countries) {
    if (!c.code) continue
    countryMeta.set(c.code.toUpperCase(), {
      code: c.code.toUpperCase(),
      name: c.name,
      languages: c.languages || [],
    })
  }

  const countryList = []
  for (const [code, list] of byCountry) {
    const meta = countryMeta.get(code)
    const name = code === 'INT' ? 'International' : meta?.name || code
    countryList.push({
      code,
      name,
      flag: flagEmoji(code === 'INT' ? 'UN' : code),
      flagImg: code === 'INT' ? '' : flagImage(code),
      count: list.length,
      languages: meta?.languages || [],
      categories: [...new Set(list.flatMap((c) => c.categories))].sort(),
    })
  }

  const FEATURED = ['PK', 'IN', 'US', 'UK', 'AE', 'SA', 'PS', 'TR']
  countryList.sort((a, b) => {
    const fa = FEATURED.indexOf(a.code)
    const fb = FEATURED.indexOf(b.code)
    if (fa !== -1 || fb !== -1) {
      if (fa === -1) return 1
      if (fb === -1) return -1
      return fa - fb
    }
    return b.count - a.count
  })

  await downloadFlags(countryList)

  const categoryCounts = new Map()
  for (const list of byCountry.values()) {
    for (const ch of list) {
      for (const c of ch.categories) categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1)
    }
  }
  const categoryList = categories
    .filter((c) => !EXCLUDED_CATEGORIES.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, description: c.description, count: categoryCounts.get(c.id) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)

  /* --- write --- */
  ensureDir(path.join(OUT_SERVER, 'channels'))
  ensureDir(path.join(OUT_WEB, 'channels'))

  let total = 0
  let streamTotal = 0
  for (const [code, list] of byCountry) {
    list.sort((a, b) => a.name.localeCompare(b.name))
    total += list.length
    streamTotal += list.reduce((n, c) => n + c.streams.length, 0)
    const file = path.join(OUT_SERVER, 'channels', `${code}.json`)
    writeJSON(file, list)
    fs.copyFileSync(file, path.join(OUT_WEB, 'channels', `${code}.json`))
  }

  const index = {
    generatedAt: new Date().toISOString(),
    source: 'iptv-org public directory + official index.m3u playlist',
    totals: {
      countries: countryList.length,
      channels: total,
      categories: categoryList.length,
      streams: streamTotal,
    },
    countries: countryList,
    categories: categoryList,
    featured: FEATURED,
  }
  writeJSON(path.join(OUT_SERVER, 'index.json'), index)
  fs.copyFileSync(path.join(OUT_SERVER, 'index.json'), path.join(OUT_WEB, 'index.json'))

  console.log(
    `[data] done in ${((Date.now() - t0) / 1000).toFixed(1)}s | ${total} channels, ` +
      `${streamTotal} streams, ${countryList.length} countries, ${categoryList.length} categories ` +
      `(playlist-only: ${fromPlaylistOnly}, nsfw skipped: ${skippedNSFW}, no-stream skipped: ${skippedNoStream})`,
  )
  const feat = countryList.filter((c) => FEATURED.includes(c.code))
  console.log('[data] featured: ' + feat.map((c) => `${c.code}=${c.count}`).join(' '))
}

function byCountryHas(byCountry, id) {
  for (const list of byCountry.values()) {
    if (list.some((c) => c.id === id)) return true
  }
  return false
}

/** Sort streams: HLS first (browser + ExoPlayer), then by resolution desc. */
function rankStreams(list, record) {
  const seen = new Set()
  const out = []
  for (const s of list) {
    if (!s.url || seen.has(s.url)) continue
    seen.add(s.url)
    const label = s.label || s.quality || (isHls(s.url) ? 'HLS' : 'Auto')
    out.push({
      id: `${record.id}-${out.length}`,
      url: s.url,
      quality: s.quality || '',
      label,
      referer: s.referer || '',
      ua: s.ua || '',
      hls: isHls(s.url),
      score: qualityScore(label) * 10 + (isHls(s.url) ? 1000 : 0),
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out.map(({ score, ...rest }) => rest)
}

function groupToCategory(group) {
  if (!group || group === 'Undefined') return ''
  const first = group.split(';')[0].trim()
  return first.toLowerCase().replace(/\s+/g, '-')
}

main().catch((err) => { console.error(err); process.exit(1) })

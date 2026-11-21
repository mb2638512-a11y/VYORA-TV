/**
 * Vyora TV - Comprehensive Multi-Playlist Ingestion & Merger Engine
 * ------------------------------------------------------------------
 * Downloads and merges verified IPTV playlists:
 *   - Nexonic Verified (working in last 48h)
 *   - Nexonic All
 *   - Free-TV (curated legal free channels)
 *   - Legal Free IPTV & Live
 *   - FreeCastHub
 *   - IPTV-org 25 Category playlists
 *
 * Enriches existing channels with proven working streams and discovers new channels.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW = path.join(ROOT, 'data', 'raw')
const PLAYLISTS_DIR = path.join(RAW, 'playlists')
const SERVER_DATA = path.join(ROOT, 'server', 'data')
const WEB_DATA = path.join(ROOT, 'web', 'public', 'data')

fs.mkdirSync(PLAYLISTS_DIR, { recursive: true })

const PLAYLIST_SOURCES = [
  // Top-tier verified & health-probed sources
  { name: 'Dearbulut Best', file: 'dearbulut_best.m3u', url: 'https://dearbulut.github.io/iptv/playlists/best.m3u', priority: 1200 },
  { name: 'Dearbulut Online', file: 'dearbulut_online.m3u', url: 'https://dearbulut.github.io/iptv/playlists/online.m3u', priority: 1150 },
  { name: 'AdeelWajid Complete', file: 'adeelwajid_complete.m3u', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlist.m3u', priority: 1100 },
  { name: 'AdeelWajid Pakistan', file: 'adeelwajid_pk.m3u', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlists/countries/pk.m3u', priority: 1120, defaultCat: 'general' },
  { name: 'WizakorHD Top', file: 'wizakorhd_top.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-top.m3u', priority: 1080 },
  { name: 'WizakorHD Hindi', file: 'wizakorhd_hindi.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-hindi.m3u', priority: 1060 },
  { name: 'WizakorHD English India', file: 'wizakorhd_english_india.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-india.m3u', priority: 1050 },
  { name: 'WizakorHD English Intl', file: 'wizakorhd_english_intl.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-intl.m3u', priority: 1040 },
  { name: 'WizakorHD Anime', file: 'wizakorhd_anime.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-anime.m3u', priority: 1030, defaultCat: 'animation' },
  { name: 'WizakorHD Complete', file: 'wizakorhd_complete.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist.m3u', priority: 1020 },
  { name: 'Nexonic Verified', file: 'nexonic_verified.m3u', url: 'https://shahrukhalid.github.io/nexonic-iptv/playlists/verified.m3u', priority: 1000 },
  { name: 'Free-TV', file: 'free_tv.m3u', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', priority: 950 },
  { name: 'Legal Free IPTV Live', file: 'legal_free_iptv_live.m3u', url: 'https://biskyt.github.io/legalFreeIPTVplaylist/live.m3u', priority: 900 },
  { name: 'Legal Free IPTV', file: 'legal_free_iptv.m3u', url: 'https://biskyt.github.io/legalFreeIPTVplaylist/playlist.m3u', priority: 850 },
  { name: 'Nexonic All', file: 'nexonic_all.m3u', url: 'https://shahrukhalid.github.io/nexonic-iptv/playlists/all.m3u', priority: 800 },
  { name: 'FreeCastHub', file: 'freecasthub.m3u', url: 'https://raw.githubusercontent.com/freecasthub/public-iptv/main/playlist.m3u', priority: 750 },
  // Category playlists from iptv-org
  { name: 'IPTV-org News', file: 'iptv_org_news.m3u', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', priority: 700, defaultCat: 'news' },
  { name: 'IPTV-org Sports', file: 'iptv_org_sports.m3u', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', priority: 700, defaultCat: 'sports' },
  { name: 'IPTV-org Entertainment', file: 'iptv_org_entertainment.m3u', url: 'https://iptv-org.github.io/iptv/categories/entertainment.m3u', priority: 700, defaultCat: 'entertainment' },
  { name: 'IPTV-org Movies', file: 'iptv_org_movies.m3u', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', priority: 700, defaultCat: 'movies' },
  { name: 'IPTV-org Music', file: 'iptv_org_music.m3u', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', priority: 700, defaultCat: 'music' },
  { name: 'IPTV-org Kids', file: 'iptv_org_kids.m3u', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', priority: 700, defaultCat: 'kids' },
  { name: 'IPTV-org Religious', file: 'iptv_org_religious.m3u', url: 'https://iptv-org.github.io/iptv/categories/religious.m3u', priority: 700, defaultCat: 'religious' },
  { name: 'IPTV-org Documentary', file: 'iptv_org_documentary.m3u', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', priority: 700, defaultCat: 'documentary' },
  { name: 'IPTV-org Comedy', file: 'iptv_org_comedy.m3u', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', priority: 700, defaultCat: 'comedy' },
  { name: 'IPTV-org Series', file: 'iptv_org_series.m3u', url: 'https://iptv-org.github.io/iptv/categories/series.m3u', priority: 700, defaultCat: 'series' },
  { name: 'IPTV-org Education', file: 'iptv_org_education.m3u', url: 'https://iptv-org.github.io/iptv/categories/education.m3u', priority: 700, defaultCat: 'education' },
  { name: 'IPTV-org Culture', file: 'iptv_org_culture.m3u', url: 'https://iptv-org.github.io/iptv/categories/culture.m3u', priority: 700, defaultCat: 'culture' },
  { name: 'IPTV-org Lifestyle', file: 'iptv_org_lifestyle.m3u', url: 'https://iptv-org.github.io/iptv/categories/lifestyle.m3u', priority: 700, defaultCat: 'lifestyle' },
  { name: 'IPTV-org Travel', file: 'iptv_org_travel.m3u', url: 'https://iptv-org.github.io/iptv/categories/travel.m3u', priority: 700, defaultCat: 'travel' },
  { name: 'IPTV-org Family', file: 'iptv_org_family.m3u', url: 'https://iptv-org.github.io/iptv/categories/family.m3u', priority: 700, defaultCat: 'family' },
  { name: 'IPTV-org Cooking', file: 'iptv_org_cooking.m3u', url: 'https://iptv-org.github.io/iptv/categories/cooking.m3u', priority: 700, defaultCat: 'cooking' },
  { name: 'IPTV-org Outdoor', file: 'iptv_org_outdoor.m3u', url: 'https://iptv-org.github.io/iptv/categories/outdoor.m3u', priority: 700, defaultCat: 'outdoor' },
  { name: 'IPTV-org Science', file: 'iptv_org_science.m3u', url: 'https://iptv-org.github.io/iptv/categories/science.m3u', priority: 700, defaultCat: 'science' },
  { name: 'IPTV-org Weather', file: 'iptv_org_weather.m3u', url: 'https://iptv-org.github.io/iptv/categories/weather.m3u', priority: 700, defaultCat: 'weather' },
  { name: 'IPTV-org Animation', file: 'iptv_org_animation.m3u', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', priority: 700, defaultCat: 'animation' },
  { name: 'IPTV-org Auto', file: 'iptv_org_auto.m3u', url: 'https://iptv-org.github.io/iptv/categories/auto.m3u', priority: 700, defaultCat: 'auto' },
  { name: 'IPTV-org Business', file: 'iptv_org_business.m3u', url: 'https://iptv-org.github.io/iptv/categories/business.m3u', priority: 700, defaultCat: 'business' },
  { name: 'IPTV-org Classic', file: 'iptv_org_classic.m3u', url: 'https://iptv-org.github.io/iptv/categories/classic.m3u', priority: 700, defaultCat: 'classic' },
  { name: 'IPTV-org Public', file: 'iptv_org_public.m3u', url: 'https://iptv-org.github.io/iptv/categories/public.m3u', priority: 700, defaultCat: 'public' },
  { name: 'IPTV-org General', file: 'iptv_org_general.m3u', url: 'https://iptv-org.github.io/iptv/categories/general.m3u', priority: 700, defaultCat: 'general' },
]

function sanitizeId(raw) {
  return raw.replace(/@.*$/, '').trim()
}

function cleanChannelName(raw) {
  return raw
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s*Ⓢ|Ⓣ|Ⓨ|\(4K\)|\(1080p\)|\(720p\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeQuality(raw) {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  if (s.includes('2160') || s.includes('4K') || s.includes('UHD')) return '2160p (4K)'
  if (s.includes('1440') || s.includes('2K')) return '1440p (2K)'
  if (s.includes('1080') || s.includes('FHD')) return '1080p'
  if (s.includes('720') || s.includes('HD')) return '720p'
  if (s.includes('576')) return '576p'
  if (s.includes('480') || s.includes('SD')) return '480p'
  if (s.includes('360')) return '360p'
  return ''
}

function detectQuality(name, group) {
  const text = `${name} ${group || ''}`
  const m = text.match(/2160p|4k|uhd|1440p|2k|1080p|1080i|720p|576p|540p|480p|360p|240p|\bhd\b|\bsd\b/i)
  if (m) return normalizeQuality(m[0])
  return ''
}

function parseM3U(content, defaultCat = 'general', priority = 500) {
  const lines = content.split(/\r?\n/)
  const out = []
  let cur = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#EXTINF')) {
      const idMatch = (trimmed.match(/tvg-id="([^"]*)"/) || [])[1] || ''
      const nameMatch = (trimmed.match(/tvg-name="([^"]*)"/) || [])[1] || ''
      const logoMatch = (trimmed.match(/tvg-logo="([^"]*)"/) || [])[1] || ''
      const groupMatch = (trimmed.match(/group-title="([^"]*)"/) || [])[1] || ''
      const countryMatch = (trimmed.match(/tvg-country="([^"]*)"/) || [])[1] || ''
      const rawTitle = trimmed.split(',').slice(1).join(',').trim()

      const baseId = sanitizeId(idMatch)
      const name = cleanChannelName(nameMatch || rawTitle || baseId)
      const group = (groupMatch || defaultCat).toLowerCase().trim()
      const quality = detectQuality(rawTitle, group)

      cur = {
        baseId,
        name,
        logo: logoMatch,
        group,
        country: countryMatch.toUpperCase(),
        quality,
        priority,
        referer: '',
        ua: '',
      }
    } else if (trimmed.startsWith('#EXTVLCOPT:') || trimmed.startsWith('#EXTHTTP:')) {
      if (cur) {
        const refMatch = trimmed.match(/http-referrer=([^\s\r\n]+)/i) || trimmed.match(/"referrer":\s*"([^"]+)"/i)
        if (refMatch) cur.referer = refMatch[1]
        const uaMatch = trimmed.match(/http-user-agent=([^\r\n]+)/i) || trimmed.match(/"user-agent":\s*"([^"]+)"/i)
        if (uaMatch) cur.ua = uaMatch[1].trim()
      }
    } else if (!trimmed.startsWith('#') && cur) {
      if (/^https?:\/\//i.test(trimmed)) {
        cur.url = trimmed
        out.push(cur)
      }
      cur = null
    }
  }
  return out
}

async function downloadFile(src, destFile) {
  if (fs.existsSync(destFile) && fs.statSync(destFile).size > 100) {
    return fs.readFileSync(destFile, 'utf8')
  }
  const url = typeof src === 'string' ? src : src.url
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 35000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 VyoraTV/1.0',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    fs.writeFileSync(destFile, text, 'utf8')
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log('[ingest] Starting Multi-Playlist Ingestion & Merger Engine...')
  const t0 = Date.now()

  // 1. Load existing dataset
  console.log('[ingest] Loading existing dataset from server/data/channels...')
  const channelDir = path.join(SERVER_DATA, 'channels')
  const channelsById = new Map() // id -> channel
  const channelsByCountryAndName = new Map() // "PK:ARY News" -> channel
  const channelsByCountry = new Map() // code -> [channels]

  const channelFiles = fs.readdirSync(channelDir).filter((f) => f.endsWith('.json'))
  for (const f of channelFiles) {
    const code = f.replace('.json', '').toUpperCase()
    const list = JSON.parse(fs.readFileSync(path.join(channelDir, f), 'utf8'))
    channelsByCountry.set(code, list)
    for (const ch of list) {
      channelsById.set(ch.id.toLowerCase(), ch)
      const nameKey = `${ch.country.toUpperCase()}:${cleanChannelName(ch.name).toLowerCase()}`
      channelsByCountryAndName.set(nameKey, ch)
    }
  }
  console.log(`[ingest] Loaded ${channelsById.size} channels across ${channelsByCountry.size} countries.`)

  // 2. Fetch and parse all playlists
  const allParsed = []
  for (const src of PLAYLIST_SOURCES) {
    const filename = src.file || `${src.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.m3u`
    const dest = path.join(PLAYLISTS_DIR, filename)
    try {
      console.log(`[ingest] Fetching ${src.name}...`)
      const text = await downloadFile(src, dest)
      const parsed = parseM3U(text, src.defaultCat, src.priority)
      console.log(`[ingest] -> ${src.name}: parsed ${parsed.length} entries.`)
      allParsed.push({ src, entries: parsed })
    } catch (err) {
      console.warn(`[ingest] Failed to fetch ${src.name}: ${err.message}`)
    }
  }

  // 3. Merge parsed streams into channels
  let streamsEnriched = 0
  let newChannelsAdded = 0

  for (const { src, entries } of allParsed) {
    for (const entry of entries) {
      if (!entry.url) continue

      // Country extraction heuristic
      let country = entry.country
      if (!country && entry.baseId) {
        const parts = entry.baseId.split('.')
        if (parts.length > 1 && parts[parts.length - 1].length === 2) {
          country = parts[parts.length - 1].toUpperCase()
        }
      }
      if (!country) country = 'INT'

      // Match channel
      let matchedChannel = null
      if (entry.baseId) {
        matchedChannel = channelsById.get(entry.baseId.toLowerCase())
      }
      if (!matchedChannel) {
        const nameKey = `${country}:${entry.name.toLowerCase()}`
        matchedChannel = channelsByCountryAndName.get(nameKey)
      }

      const streamObj = {
        url: entry.url,
        quality: entry.quality || '',
        label: entry.quality || (entry.url.includes('.m3u8') ? 'HLS' : 'Auto'),
        priority: entry.priority,
      }
      if (entry.referer) streamObj.referer = entry.referer
      if (entry.ua) streamObj.ua = entry.ua

      if (matchedChannel) {
        // Channel already exists!
        const existingUrls = new Set(matchedChannel.streams.map((s) => s.url))
        if (!existingUrls.has(entry.url)) {
          // If stream is from a verified / high-priority source, put at the top!
          if (entry.priority >= 900) {
            matchedChannel.streams.unshift(streamObj)
          } else {
            matchedChannel.streams.push(streamObj)
          }
          streamsEnriched++
        }
        // Update logo if empty
        if (!matchedChannel.logo && entry.logo) {
          matchedChannel.logo = entry.logo
          matchedChannel.icon = entry.logo
        }
      } else {
        // Discovered a new channel!
        const cleanId = entry.baseId || `${entry.name.replace(/[^a-zA-Z0-9]+/g, '')}.${country}`
        if (channelsById.has(cleanId.toLowerCase())) continue

        const newRec = {
          id: cleanId,
          name: entry.name,
          alt: [],
          network: '',
          owner: '',
          categories: [entry.group || 'general'],
          country,
          website: '',
          logo: entry.logo || '',
          icon: entry.logo || '',
          launched: null,
          closed: null,
          lang: '',
          streams: [streamObj],
        }

        channelsById.set(cleanId.toLowerCase(), newRec)
        const nameKey = `${country}:${entry.name.toLowerCase()}`
        channelsByCountryAndName.set(nameKey, newRec)

        let countryList = channelsByCountry.get(country)
        if (!countryList) {
          countryList = []
          channelsByCountry.set(country, countryList)
        }
        countryList.push(newRec)
        newChannelsAdded++
      }
    }
  }

  console.log(`[ingest] Merge complete! ${streamsEnriched} new streams added to existing channels, ${newChannelsAdded} brand new channels added.`)

  // 4. Clean stream priorities and strip temporary properties
  let totalStreamsCount = 0
  let totalChannelsCount = 0

  for (const [code, list] of channelsByCountry) {
    for (const ch of list) {
      // Sort streams: priority first, then resolution label
      ch.streams.sort((a, b) => (b.priority || 500) - (a.priority || 500))
      // Strip internal priority field
      for (const s of ch.streams) {
        delete s.priority
      }
      totalStreamsCount += ch.streams.length
      totalChannelsCount++
    }
    // Sort channels alphabetically by name
    list.sort((a, b) => a.name.localeCompare(b.name))

    // Write updated channel file to server and web dist
    const serverFile = path.join(SERVER_DATA, 'channels', `${code}.json`)
    const webFile = path.join(WEB_DATA, 'channels', `${code}.json`)
    const content = JSON.stringify(list)
    fs.writeFileSync(serverFile, content, 'utf8')
    if (fs.existsSync(path.dirname(webFile))) {
      fs.writeFileSync(webFile, content, 'utf8')
    }
  }

  // 5. Update index.json
  const indexFile = path.join(SERVER_DATA, 'index.json')
  const indexData = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  indexData.generatedAt = new Date().toISOString()
  indexData.totals.channels = totalChannelsCount
  indexData.totals.streams = totalStreamsCount

  // Update country counts in indexData
  for (const c of indexData.countries) {
    const list = channelsByCountry.get(c.code)
    if (list) c.count = list.length
  }

  fs.writeFileSync(indexFile, JSON.stringify(indexData), 'utf8')
  const webIndex = path.join(WEB_DATA, 'index.json')
  if (fs.existsSync(path.dirname(webIndex))) {
    fs.writeFileSync(webIndex, JSON.stringify(indexData), 'utf8')
  }

  console.log(`[ingest] SUCCESS in ${((Date.now() - t0) / 1000).toFixed(1)}s!`)
  console.log(`[ingest] Total Channels: ${totalChannelsCount}, Total Streams: ${totalStreamsCount}`)
}

main().catch((err) => {
  console.error('[ingest] ERROR:', err)
  process.exit(1)
})

import type { Bootstrap, Category, Channel, Country, Movie, Series } from '../types'

/**
 * Data layer.
 *
 * Two modes:
 *  - "server"  : the Node API is reachable (/api/*). Full features, and the
 *                 stream proxy removes CORS + Referer problems.
 *  - "static"  : the app was opened as a plain file/static host. The same
 *                 dataset is read from ./data/*.json. Playback then depends on
 *                 the broadcaster allowing CORS.
 *
 * The UI works identically in both modes.
 */

/**
 * Base URL of the platform API.
 *
 * The app normally runs on the same origin as the engine (`/api/...`), but the
 * Android TV shell used to open the bundle straight from
 * `file:///android_asset/index.html`. Every relative `/api/...` URL then
 * resolved to `file:///api/...`, which never answers: no logos, no web proxy,
 * no downloads. When the page is served from `file://` we therefore talk to
 * the local engine on 127.0.0.1 with an absolute URL.
 */
export const API = (() => {
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
    return 'http://127.0.0.1:8787/api'
  }
  return '/api'
})()

/** Origin of the platform engine (used for YouTube embeds and share links). */
export function apiOrigin(): string {
  if (typeof window === 'undefined' || !window.location) return ''
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:8787'
  return window.location.origin || ''
}

let mode: 'server' | 'static' | 'unknown' = 'unknown'

export function currentMode() {
  return mode
}

function b64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildProxyUrl(url: string, referer?: string, ua?: string, cid?: string) {
  const params = new URLSearchParams()
  params.set('u', b64(url))
  if (referer) params.set('r', b64(referer))
  if (ua) params.set('a', b64(ua))
  if (cid) params.set('cid', cid)
  return `${API}/proxy?${params.toString()}`
}

/* ------------------------------------------------------------------ */
/* live channel status (online / offline - Real-Time SSE Stream)        */
/* ------------------------------------------------------------------ */

export type SourceHealthRecord = {
  status: 'online' | 'offline' | 'unknown'
  ts: number
  ms?: number
  successCount?: number
  failureCount?: number
  lastSuccessTs?: number
  lastFailureTs?: number
}

export type HealthRecord = {
  status: 'online' | 'offline' | 'unknown'
  ts: number
  ms?: number
  source?: string
  bestStream?: number
  sources?: Record<string, SourceHealthRecord>
}

const healthRegistry = new Map<string, HealthRecord>()
const healthListeners = new Set<() => void>()
let sseSource: EventSource | null = null
let sseReconnectTimer: any = null

function notifyHealthListeners() {
  for (const fn of healthListeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

export function onHealthChange(callback: () => void): () => void {
  healthListeners.add(callback)
  return () => {
    healthListeners.delete(callback)
  }
}

export function getHealthRecord(id: string): HealthRecord | undefined {
  return healthRegistry.get(id)
}

export function getAllHealthRecords(): Record<string, HealthRecord> {
  const out: Record<string, HealthRecord> = {}
  for (const [k, v] of healthRegistry) out[k] = v
  return out
}

export function initHealthStream() {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
  if (sseSource || mode === 'static') return

  try {
    sseSource = new EventSource(`${API}/status/stream`)

    sseSource.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const snapshot = JSON.parse(e.data) as Record<string, HealthRecord>
        for (const [id, rec] of Object.entries(snapshot)) {
          healthRegistry.set(id, rec)
        }
        notifyHealthListeners()
      } catch {
        /* ignore */
      }
    })

    sseSource.onmessage = (e: MessageEvent) => {
      try {
        const rec = JSON.parse(e.data) as HealthRecord & { id: string }
        if (rec && rec.id) {
          healthRegistry.set(rec.id, rec)
          notifyHealthListeners()
        }
      } catch {
        /* ignore */
      }
    }

    sseSource.onerror = () => {
      if (sseSource) {
        sseSource.close()
        sseSource = null
      }
      if (!sseReconnectTimer) {
        sseReconnectTimer = setTimeout(() => {
          sseReconnectTimer = null
          initHealthStream()
        }, 3000)
      }
    }
  } catch {
    /* fallback to polling */
  }
}

export async function reportStreamPlayback(
  channelId: string,
  ok: boolean,
  ms = 0,
  streamIndex = 0,
  allSourcesFailed = false,
  recordSource = true,
): Promise<void> {
  if (!channelId) return
  const now = Date.now()
  const current = healthRegistry.get(channelId)
  const sources = { ...(current?.sources || {}) }
  if (recordSource && streamIndex >= 0) {
    const key = String(streamIndex)
    const previous = sources[key] || { status: 'unknown' as const, ts: 0, successCount: 0, failureCount: 0 }
    sources[key] = {
      status: ok ? 'online' : 'offline',
      ts: now,
      ms,
      successCount: (previous.successCount || 0) + (ok ? 1 : 0),
      failureCount: (previous.failureCount || 0) + (ok ? 0 : 1),
      lastSuccessTs: ok ? now : previous.lastSuccessTs,
      lastFailureTs: ok ? previous.lastFailureTs : now,
    }
  }
  healthRegistry.set(channelId, {
    status: allSourcesFailed ? 'offline' : ok ? 'online' : current?.status || 'unknown',
    ts: now,
    ms: ok || allSourcesFailed ? ms : current?.ms,
    source: allSourcesFailed ? 'playback-exhausted' : 'playback',
    bestStream: ok ? streamIndex : current?.bestStream,
    sources,
  })
  notifyHealthListeners()

  if (mode === 'server') {
    try {
      const params = new URLSearchParams({
        id: channelId,
        ok: ok ? '1' : '0',
        ms: String(ms),
        stream: String(streamIndex),
      })
      if (allSourcesFailed) params.set('exhausted', '1')
      if (!recordSource) params.set('record', '0')
      await fetch(`${API}/status/report?${params.toString()}`, { cache: 'no-store' })
    } catch {
      /* best effort */
    }
  }
}

export async function notifyPlaybackActive(cid: string): Promise<void> {
  if (mode !== 'server' || !cid) return
  try {
    await fetch(`${API}/playback/active?cid=${encodeURIComponent(cid)}`, { cache: 'no-store' })
  } catch {
    /* best effort */
  }
}

export async function notifyPlaybackInactive(): Promise<void> {
  if (mode !== 'server') return
  try {
    await fetch(`${API}/playback/inactive`, { cache: 'no-store' })
  } catch {
    /* best effort */
  }
}

export async function requestLookahead(ids: string[]): Promise<void> {
  if (mode !== 'server' || !ids.length) return
  try {
    await fetch(`${API}/playback/lookahead?ids=${ids.map(encodeURIComponent).join(',')}`, {
      cache: 'no-store',
    })
  } catch {
    /* best effort */
  }
}

/**
 * Warm several channels in one round trip. The server pulls the manifest and
 * the first segments into RAM, so a later click starts instantly.
 */
export async function warmChannels(ids: string[], depth = 2): Promise<void> {
  if (mode !== 'server' || !ids.length) return
  try {
    const list = ids.slice(0, 60).map(encodeURIComponent).join(',')
    await fetch(`${API}/warm?ids=${list}&depth=${depth}`, { cache: 'no-store' })
  } catch {
    /* best effort */
  }
}

export async function resolveFastestStream(channelId: string): Promise<{
  ok: boolean
  streamIndex?: number
  stream?: any
  cached?: boolean
  ms?: number
  error?: string
} | null> {
  if (mode !== 'server') return null
  try {
    const res = await fetch(`${API}/resolve/${encodeURIComponent(channelId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as any
  } catch {
    return null
  }
}

export async function fetchStatuses(ids: string[]): Promise<Record<string, HealthRecord>> {
  if (!ids.length) return getAllHealthRecords()
  try {
    const data = await getJSON<{ status: Record<string, HealthRecord> }>(
      `${API}/status?ids=${ids.slice(0, 500).join(',')}`,
      8000,
    )
    if (data.status) {
      for (const [id, rec] of Object.entries(data.status)) {
        healthRegistry.set(id, rec)
      }
      notifyHealthListeners()
      return data.status
    }
    return {}
  } catch {
    return {}
  }
}

/** Tell the server which channels the user is looking at (probe priority). */
export async function trackStatuses(ids: string[]): Promise<void> {
  if (!ids.length) return
  try {
    await getJSON(`${API}/status/track?ids=${ids.slice(0, 500).join(',')}`, 6000)
  } catch {
    /* best effort */
  }
}

export type NetworkInfo = {
  kbps: number
  quality: string
  maxLevel?: number
  samples?: number
  measured?: boolean
}

/** Real measured throughput from the proxy (drives the auto quality). */
export async function fetchNetwork(): Promise<NetworkInfo> {
  try {
    return await getJSON<NetworkInfo>(`${API}/network`, 8000)
  } catch {
    return { kbps: 0, quality: 'auto' }
  }
}

/**
 * Logo URL that goes through our cached server proxy.
 *
 * The proxy is used in every mode: it tries the site's own /favicon.ico and
 * then falls back to the Google / DuckDuckGo icon services, so a tile is never
 * blank even when the site has no icon of its own.
 */
export function logoUrl(logo: string): string {
  if (!logo) return ''
  // Already proxied -> keep it, never proxy twice.
  if (logo.startsWith('/api/') || logo.includes('/api/logo?')) return logo
  return `${API}/logo?u=${b64(logo)}`
}

/** Query string for warming the manifest cache of a stream. */
export function prefetchParams(stream: { url: string; referer?: string; ua?: string }, cid?: string) {
  const params = new URLSearchParams()
  params.set('u', b64(stream.url))
  if (stream.referer) params.set('r', b64(stream.referer))
  if (stream.ua) params.set('a', b64(stream.ua))
  if (cid) params.set('cid', cid)
  return params.toString()
}

/* ------------------------------------------------------------------ */
/* prefetch queue                                                      */
/* ------------------------------------------------------------------ */

/**
 * The browser only allows 6 concurrent connections per origin. A flood of
 * prefetch requests would block the UI itself, so background warming runs
 * through a small queue (2 at a time) while focus/hover prefetches jump
 * the queue.
 */
const queue: (() => Promise<void>)[] = []
let running = 0
const MAX_PARALLEL = 2

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!
    running++
    job()
      .catch(() => undefined)
      .finally(() => {
        running--
        pump()
      })
  }
}

export function queuePrefetch(job: () => Promise<void>) {
  queue.push(job)
  pump()
}

/** Prefetch with priority (used when the user focuses a channel). */
export async function prefetchNow(job: () => Promise<void>) {
  try {
    await job()
  } catch {
    /* ignore */
  }
}

async function getJSON<T>(url: string, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function loadBootstrap(): Promise<Bootstrap> {
  try {
    const data = await getJSON<Bootstrap>(`${API}/bootstrap`)
    mode = 'server'
    return data
  } catch {
    const data = await getJSON<Bootstrap>('./data/index.json')
    mode = 'static'
    return data
  }
}

const staticCountryCache = new Map<string, Channel[]>()

async function loadStaticCountry(code: string): Promise<Channel[]> {
  const cached = staticCountryCache.get(code)
  if (cached) return cached
  const list = await getJSON<Channel[]>(`./data/channels/${code}.json`, 20000)
  staticCountryCache.set(code, list)
  return list
}

export async function loadChannels(
  country = 'all',
  category = 'all',
  search = '',
  onlineOnly = false,
): Promise<Channel[]> {
  if (mode === 'server') {
    const params = new URLSearchParams({ country, category, limit: '5000' })
    if (search) params.set('search', search)
    if (onlineOnly) params.set('online', '1')
    const data = await getJSON<{ channels: Channel[] }>(`${API}/channels?${params}`)
    return data.channels
  }

  let list =
    country === 'all'
      ? (await Promise.all(
          (await loadBootstrap()).countries.map((c) => loadStaticCountry(c.code)),
        )).flat()
      : await loadStaticCountry(country.toUpperCase())

  if (category && category !== 'all') {
    list = list.filter((c) => c.categories.includes(category))
  }
  if (search) {
    const q = search.trim().toLowerCase()
    const terms = q.split(/\s+/).filter(Boolean)
    list = list.filter((ch) => {
      const hay = [ch.name, ch.network, ch.owner, ch.country, ...(ch.alt || [])]
        .join(' ')
        .toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }
  return list
}

export async function loadCountry(code: string, onlineOnly = false): Promise<Channel[]> {
  return loadChannels(code, 'all', '', onlineOnly)
}

export async function loadCategory(id: string, onlineOnly = false): Promise<Channel[]> {
  return loadChannels('all', id, '', onlineOnly)
}

/** Top channels across every country (server precomputed). */
export async function loadTop(limit = 84, onlineOnly = false): Promise<Channel[]> {
  if (mode === 'server') {
    const data = await getJSON<{ channels: Channel[] }>(
      `${API}/top?limit=${limit}${onlineOnly ? '&online=1' : ''}`,
    )
    return data.channels
  }
  const all = await loadChannels('all', 'all', '', onlineOnly)
  return all.slice(0, limit)
}

/** Exact channels by id (favourites / recently watched). */
export async function loadByIds(ids: string[]): Promise<Channel[]> {
  if (!ids.length) return []
  if (mode === 'server') {
    const data = await getJSON<{ channels: Channel[] }>(
      `${API}/channels?ids=${ids.slice(0, 200).join(',')}`,
    )
    return data.channels
  }
  const all = await loadChannels('all', 'all', '')
  const wanted = new Set(ids)
  return all.filter((c) => wanted.has(c.id))
}

export async function searchChannels(q: string): Promise<Channel[]> {
  if (!q.trim()) return []
  if (mode === 'server') {
    const data = await getJSON<{ channels: Channel[] }>(`${API}/search?q=${encodeURIComponent(q)}&limit=120`)
    return data.channels
  }
  return loadChannels('all', 'all', q)
}

/* ------------------------------------------------------------------ */
/* global catalogue (every country in one list)                        */
/* ------------------------------------------------------------------ */

export type PagedChannels = {
  total: number
  items: Channel[]
  offset: number
  limit: number
}

/** One page of the global catalogue (all countries). */
export async function loadGlobalChannels(
  country = 'all',
  category = 'all',
  search = '',
  offset = 0,
  limit = 240,
  onlineOnly = false,
): Promise<PagedChannels> {
  if (mode === 'server') {
    const params = new URLSearchParams({
      country,
      category,
      offset: String(offset),
      limit: String(limit),
    })
    if (search) params.set('search', search)
    if (onlineOnly) params.set('online', '1')
    const data = await getJSON<{
      total: number
      channels: Channel[]
      offset: number
      limit: number
    }>(`${API}/channels?${params}`)
    return { total: data.total, items: data.channels, offset: data.offset, limit: data.limit }
  }

  const all = await loadChannels('all', category, search)
  return {
    total: all.length,
    items: all.slice(offset, offset + limit),
    offset,
    limit,
  }
}

export async function loadFavorites(ids: string[]): Promise<Channel[]> {
  if (!ids.length) return []
  const map = new Map<string, Channel>()
  const codes = new Set<string>()
  for (const id of ids) codes.add(id.split('.')[0])
  for (const code of codes) {
    try {
      for (const ch of await loadCountry(code)) {
        if (ids.includes(ch.id)) map.set(ch.id, ch)
      }
    } catch {
      /* ignore */
    }
  }
  return [...map.values()]
}

/* ------------------------------------------------------------------ */
/* VOD (Movies & Web Series)                                          */
/* ------------------------------------------------------------------ */

let cachedMovies: Movie[] | null = null
let cachedSeries: Series[] | null = null

export async function loadMovies(): Promise<Movie[]> {
  if (cachedMovies) return cachedMovies
  try {
    const list = await getJSON<Movie[]>(`${API}/vod/movies`)
    cachedMovies = list
    return list
  } catch {
    const list = await getJSON<Movie[]>('./data/vod/movies.json')
    cachedMovies = list
    return list
  }
}

export async function loadSeries(): Promise<Series[]> {
  if (cachedSeries) return cachedSeries
  try {
    const list = await getJSON<Series[]>(`${API}/vod/series`)
    cachedSeries = list
    return list
  } catch {
    const list = await getJSON<Series[]>('./data/vod/series.json')
    cachedSeries = list
    return list
  }
}

export async function loadVodIndex(): Promise<any> {
  try {
    return await getJSON<any>(`${API}/vod/index`)
  } catch {
    return await getJSON<any>('./data/vod/index.json')
  }
}

/* ------------------------------------------------------------------ */
/* stream health                                                       */
/* ------------------------------------------------------------------ */

const HEALTH_KEY = 'vyora.streamHealth'

type Health = Record<string, { ok: number; fail: number; ts: number }>

function readHealth(): Health {
  try {
    return JSON.parse(localStorage.getItem(HEALTH_KEY) || '{}')
  } catch {
    return {}
  }
}

/** Remember whether a stream worked, so the next visit starts on a good one. */
export function markStream(url: string, ok: boolean) {
  try {
    const h = readHealth()
    const rec = h[url] || { ok: 0, fail: 0, ts: 0 }
    if (ok) rec.ok++
    else rec.fail++
    rec.ts = Date.now()
    h[url] = rec
    localStorage.setItem(HEALTH_KEY, JSON.stringify(h))
  } catch {
    /* ignore */
  }
}

function qualityRank(label: string) {
  const n = parseInt(String(label || ''), 10)
  if (Number.isFinite(n)) return n
  if (String(label).includes('4K')) return 2160
  if (String(label).includes('2K')) return 1440
  return 10
}

/** Order streams: proven-good sources first, then by resolution. */
export function orderStreams(ch: Channel, maxQuality?: string): Channel {
  const h = readHealth()
  const rec = healthRegistry.get(ch.id)
  const bestIdx = typeof rec?.bestStream === 'number' ? rec.bestStream : -1
  const cap = maxQuality && maxQuality !== 'auto' ? qualityRank(maxQuality) : 0
  const list = (ch.streams || []).map((stream, index) => ({
    ...stream,
    sourceIndex: typeof stream.sourceIndex === 'number' ? stream.sourceIndex : index,
  }))
  list.sort((a, b) => {
    const origIdxA = typeof a.sourceIndex === 'number' ? a.sourceIndex : ch.streams.indexOf(a)
    const origIdxB = typeof b.sourceIndex === 'number' ? b.sourceIndex : ch.streams.indexOf(b)
    const bestBonusA = origIdxA === bestIdx ? 10000 : 0
    const bestBonusB = origIdxB === bestIdx ? 10000 : 0
    const ha = h[a.url]
    const hb = h[b.url]
    // network aware: a 4K source on a 2K line is demoted, never dropped
    const overCap = (s: { label: string }) =>
      cap > 0 && qualityRank(s.label) > cap ? -800 : 0
    const sa =
      qualityRank(a.label) +
      overCap(a) +
      bestBonusA +
      (ha && ha.ok > ha.fail ? 5000 : ha && ha.fail ? -5000 : 0)
    const sb =
      qualityRank(b.label) +
      overCap(b) +
      bestBonusB +
      (hb && hb.ok > hb.fail ? 5000 : hb && hb.fail ? -5000 : 0)
    return sb - sa
  })
  return { ...ch, streams: list }
}

/* ------------------------------------------------------------------ */
/* Xtream Codes & Custom M3U Playlist Management                      */
/* ------------------------------------------------------------------ */

export async function authXtream(server: string, username: string, password: string): Promise<{
  ok: boolean
  user_info?: any
  server_info?: any
  error?: string
}> {
  const params = new URLSearchParams({ server, username, password })
  return await getJSON<{ ok: boolean; user_info?: any; server_info?: any; error?: string }>(
    `${API}/xtream/auth?${params}`,
    15000,
  )
}

export async function fetchXtreamCategories(server: string, username: string, password: string): Promise<
  Array<{ category_id: string; category_name: string }>
> {
  const params = new URLSearchParams({ server, username, password })
  return await getJSON<Array<{ category_id: string; category_name: string }>>(
    `${API}/xtream/categories?${params}`,
    15000,
  )
}

export async function fetchXtreamChannels(
  server: string,
  username: string,
  password: string,
  categoryId = 'all',
): Promise<{ total: number; channels: Channel[] }> {
  const params = new URLSearchParams({ server, username, password, category_id: categoryId })
  return await getJSON<{ total: number; channels: Channel[] }>(
    `${API}/xtream/streams?${params}`,
    25000,
  )
}

export async function importM3UPlaylist(url: string): Promise<{
  ok: boolean
  total: number
  channels: Channel[]
  error?: string
}> {
  const params = new URLSearchParams({ url })
  return await getJSON<{ ok: boolean; total: number; channels: Channel[]; error?: string }>(
    `${API}/playlist/m3u?${params}`,
    30000,
  )
}

export async function fetchDownloads(): Promise<any[]> {
  try {
    const res = await fetch(`${API}/downloads`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return data.items || []
  } catch {
    return []
  }
}

export async function startDownload(url: string, name?: string, type?: string): Promise<{ ok: boolean; item?: any; error?: string }> {
  try {
    const res = await fetch(`${API}/downloads/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name, type }),
    })
    return await res.json()
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}

export async function deleteDownload(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/downloads/delete?id=${encodeURIComponent(id)}`, {
      method: 'POST',
    })
    const data = await res.json()
    return !!data.ok
  } catch {
    return false
  }
}

export type { Bootstrap, Category, Channel, Country, Movie, Series }

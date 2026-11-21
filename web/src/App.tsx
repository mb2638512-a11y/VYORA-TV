import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Bootstrap, BrowserEngineId, Channel, Country, CustomPlaylist, DownloadItem, InstalledApp, Movie, PlayerEngineId, Series, View } from './types'
import { TOP_STREAMING_PLAYERS } from './types'
import {
  currentMode,
  deleteDownload,
  fetchDownloads,
  fetchNetwork,
  fetchXtreamChannels,
  getHealthRecord,
  importM3UPlaylist,
  loadBootstrap,
  loadByIds,
  loadCategory,
  loadChannels,
  loadCountry,
  loadGlobalChannels,
  loadMovies,
  loadSeries,
  loadTop,
  loadVodIndex,
  logoUrl,
  orderStreams,
  prefetchNow,
  prefetchParams,
  queuePrefetch,
  startDownload,
  trackStatuses,
  warmChannels,
} from './lib/api'
import { installNavigation } from './lib/nav'
import { categoryName, translate } from './lib/i18n'
import { downloadStreamM3u, isNative, launchExternalStream, nativeInstallApk, speak } from './lib/bridge'
import { useChannelHealth, statusOf } from './hooks/useChannelHealth'
import { TopBar } from './components/TopBar'
import { Icon } from './components/Icon'
import { ChannelLogo } from './components/ChannelLogo'
import { ChannelCard, CountryCard, ThemeCard, MovieCard, SeriesCard } from './components/Cards'
import { PlayerOverlay } from './components/PlayerOverlay'
import { SearchOverlay } from './components/SearchOverlay'
import { SettingsOverlay, type Settings } from './components/SettingsOverlay'
import { PlaylistsModal } from './components/PlaylistsModal'
import ChromiumBrowser, { BROWSER_ENGINES, BROWSER_ENGINES_LIST, BrandLogo, faviconFor } from './components/ChromiumBrowser'

/**
 * Icon of an installed web app.
 *
 * The icon always travels through the /logo proxy (site favicon -> Google ->
 * DuckDuckGo fallback chain), so every installed app shows its real brand
 * mark everywhere in the platform instead of a blank tile.
 */
function AppBadgeLogo({ app, size = 28 }: { app: InstalledApp; size?: number }) {
  const [failed, setFailed] = useState(false)
  const iconSrc = app.icon ? logoUrl(app.icon) : faviconFor(app.url)
  const radius = Math.max(4, Math.round(size / 4))

  if (iconSrc && !failed) {
    return (
      <img
        src={iconSrc}
        alt=""
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'contain',
          backgroundColor: 'rgba(255,255,255,0.06)',
          padding: 2,
        }}
        onError={() => setFailed(true)}
        loading="lazy"
      />
    )
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: app.color || '#38bdf8',
        fontSize: Math.round(size * 0.5),
        fontWeight: 800,
        color: '#ffffff',
        lineHeight: 1,
      }}
    >
      {app.title ? app.title.trim().charAt(0).toUpperCase() : 'W'}
    </span>
  )
}

const APP_VERSION = '1.0.0'
const PAGE_SIZE = 240
const FAV_KEY = 'vyora.favourites'
const SETTINGS_KEY = 'vyora.settings'
const RECENT_KEY = 'vyora.recent'
const QUEUE_KEY = 'vyora.queue'
const PLAYLISTS_KEY = 'vyora.playlists'
const ACTIVE_PLAYLIST_KEY = 'vyora.active_playlist_id'

const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  a11y: {
    largeText: false,
    highContrast: false,
    audioDescription: false,
    announceFocus: true,
  },
  autoPlayBest: true,
  autoSkipOffline: false,
  verifiedOnly: false,
  defaultPlayer: 'internal',
  channelsPlayer: 'internal',
  moviesPlayer: 'internal',
  seriesPlayer: 'internal',
  downloadsPlayer: 'internal',
  channelPanelLayout: 'cards',
  vodPanelLayout: 'poster',
  startupScreen: 'home',
  bufferDepth: 'balanced',
  tunnelMode: 'auto',
  pruneDeadVariants: true,
  videoScaling: 'fit',
  audioMode: 'standard',
  parentalLock: false,
  parentalPin: '0000',
  hiddenCategories: [],
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const STANDARD_CATEGORIES = [
  'all',
  'kids',
  'sports',
  'news',
  'entertainment',
  'music',
  'religious',
  'documentary',
  'comedy',
]

function matchesCategory(categories: string[] = [], filter: string): boolean {
  if (!filter || filter === 'all') return true
  const f = filter.toLowerCase()
  return categories.some((c) => {
    const norm = (c || '').trim().toLowerCase()
    if (norm === f) return true
    if (f === 'kids' && (norm.includes('animat') || norm.includes('cartoon') || norm.includes('child') || norm.includes('kids') || norm.includes('toon'))) return true
    if (f === 'movies' && (norm.includes('movie') || norm.includes('film') || norm.includes('cinema'))) return true
    if (f === 'sports' && (norm.includes('sport') || norm.includes('cricket') || norm.includes('football') || norm.includes('racing') || norm.includes('tennis'))) return true
    if (f === 'news' && (norm.includes('news') || norm.includes('khabar') || norm.includes('samachar') || norm.includes('headline'))) return true
    if (f === 'music' && (norm.includes('music') || norm.includes('song') || norm.includes('gaana') || norm.includes('geet'))) return true
    if (f === 'entertainment' && (norm.includes('entertain') || norm.includes('general') || norm.includes('variety') || norm.includes('drama'))) return true
    if (f === 'religious' && (norm.includes('religio') || norm.includes('islam') || norm.includes('hindu') || norm.includes('christian') || norm.includes('quran') || norm.includes('peace') || norm.includes('madani'))) return true
    if (f === 'series' && (norm.includes('series') || norm.includes('show') || norm.includes('drama'))) return true
    if (f === 'documentary' && (norm.includes('doc') || norm.includes('history') || norm.includes('nature') || norm.includes('science') || norm.includes('geo'))) return true
    if (f === 'comedy' && (norm.includes('comed') || norm.includes('humor') || norm.includes('funny'))) return true
    return norm.includes(f)
  })
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = readJSON<Partial<Settings>>(SETTINGS_KEY, {})
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      a11y: { ...DEFAULT_SETTINGS.a11y, ...(saved.a11y || {}) },
    }
  })
  const [view, setView] = useState<View>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.startupScreen === 'global') return { name: 'global' }
        if (parsed.startupScreen === 'moviebox' || parsed.startupScreen === 'movies' || parsed.startupScreen === 'series') return { name: 'moviebox' }
        if (parsed.startupScreen === 'favorites') return { name: 'favorites' }
        if (parsed.startupScreen === 'browser') return { name: 'browser' }
      }
    } catch {}
    return { name: 'home' }
  })
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [favourites, setFavourites] = useState<string[]>(() => readJSON<string[]>(FAV_KEY, []))
  const [recent, setRecent] = useState<string[]>(() => readJSON<string[]>(RECENT_KEY, []))
  const [playing, setPlaying] = useState<Channel | null>(null)
  const [clock, setClock] = useState('')
  const [overlay, setOverlay] = useState<'none' | 'search' | 'settings' | 'number' | 'playlists'>('none')
  const [playlists, setPlaylists] = useState<CustomPlaylist[]>(() =>
    readJSON<CustomPlaylist[]>(PLAYLISTS_KEY, []),
  )
  const [activePlaylistId, setActivePlaylistId] = useState<string>(() =>
    readJSON<string>(ACTIVE_PLAYLIST_KEY, 'default'),
  )
  const [customChannels, setCustomChannels] = useState<Channel[]>([])
  const [customLoading, setCustomLoading] = useState(false)
  const [homeCategoryFilter, setHomeCategoryFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [countryFilter, setCountryFilter] = useState('all')
  const [groupByCountry, setGroupByCountry] = useState(false)
  const [globalItems, setGlobalItems] = useState<Channel[]>([])
  const [globalTotal, setGlobalTotal] = useState(0)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [numberEntry, setNumberEntry] = useState('')
  const [liveRegion, setLiveRegion] = useState('')
  const [recentList, setRecentList] = useState<Channel[]>([])
  const [queue, setQueue] = useState<string[]>(() => readJSON<string[]>(QUEUE_KEY, []))
  const [shownCount, setShownCount] = useState(240)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [movies, setMovies] = useState<Movie[]>([])
  const [series, setSeries] = useState<Series[]>([])
  const [movieGenre, setMovieGenre] = useState('all')
  const [seriesGenre, setSeriesGenre] = useState('all')
  const [selectedSeries, setSelectedSeries] = useState<Series | null>(null)
  const [vodLoading, setVodLoading] = useState(false)
  const [movieboxSearch, setMovieboxSearch] = useState('')
  const [movieboxGenre, setMovieboxGenre] = useState('all')
  const [network, setNetwork] = useState<{
    kbps: number
    quality: string
    maxLevel?: number
  }>({
    kbps: 0,
    quality: 'auto',
  })
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>(() => {
    try {
      const raw = localStorage.getItem('vyora_installed_apps_v1')
      if (raw) {
        const parsed: InstalledApp[] = JSON.parse(raw)
        return parsed.map((a) => ({
          ...a,
          icon: a.icon || faviconFor(a.url),
        }))
      }
    } catch {}
    return [
      { id: 'app-yt', title: 'YouTube Web TV', url: 'https://www.youtube.com', icon: faviconFor('https://www.youtube.com'), category: 'Video', color: '#FF0000', installedAt: Date.now() },
      { id: 'app-fast', title: 'Fast.com Speed Test', url: 'https://fast.com', icon: faviconFor('https://fast.com'), category: 'Tools', color: '#00D166', installedAt: Date.now() },
      { id: 'app-wiki', title: 'Wikipedia Encyclopedia', url: 'https://en.wikipedia.org', icon: faviconFor('https://en.wikipedia.org'), category: 'Reference', color: '#636466', installedAt: Date.now() },
      { id: 'app-weather', title: 'World Weather Radar', url: 'https://weather.com', icon: faviconFor('https://weather.com'), category: 'News', color: '#2B70C9', installedAt: Date.now() },
      { id: 'app-twitch', title: 'Twitch Live TV', url: 'https://www.twitch.tv', icon: faviconFor('https://www.twitch.tv'), category: 'Gaming', color: '#9146FF', installedAt: Date.now() },
      { id: 'app-reddit', title: 'Reddit Community', url: 'https://www.reddit.com', icon: faviconFor('https://www.reddit.com'), category: 'Social', color: '#FF4500', installedAt: Date.now() },
    ]
  })
  const [downloads, setDownloads] = useState<DownloadItem[]>([])

  const THEME_KEY = 'vyora.theme'
  type ThemeMode = 'dark' | 'light'

  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY)
      if (saved === 'light' || saved === 'dark') return saved
    } catch {}
    return 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((curr) => (curr === 'dark' ? 'light' : 'dark'))
  }, [])

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [spotlightIndex, setSpotlightIndex] = useState(0)

  // Eagerly preload movies so home cinema rail has content immediately
  useEffect(() => {
    let alive = true
    if (!movies.length) {
      loadMovies()
        .then((list) => {
          if (alive && list) setMovies(list)
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [movies.length])

  useEffect(() => {
    fetchDownloads().then((items) => {
      if (items) setDownloads(items)
    })
    const timer = setInterval(() => {
      fetchDownloads().then((items) => {
        if (items) setDownloads(items)
      })
    }, 3500)
    return () => clearInterval(timer)
  }, [])

  const handleInstallApp = (app: InstalledApp) => {
    const withIcon: InstalledApp = {
      ...app,
      icon: app.icon || faviconFor(app.url),
    }
    setInstalledApps((prev) => {
      const updated = [...prev.filter((a) => a.url !== withIcon.url), withIcon]
      try {
        localStorage.setItem('vyora_installed_apps_v1', JSON.stringify(updated))
      } catch {}
      return updated
    })
  }

  const handleUninstallApp = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setInstalledApps((prev) => {
      const updated = prev.filter((a) => a.id !== id)
      try {
        localStorage.setItem('vyora_installed_apps_v1', JSON.stringify(updated))
      } catch {}
      return updated
    })
  }

  const handlePlayDownloadedMovie = useCallback((url: string, title: string) => {
    const assignedPlayer = settings.downloadsPlayer || settings.defaultPlayer || 'internal'
    if (assignedPlayer !== 'internal') {
      launchExternalStream(assignedPlayer, url, title)
    }
    const virtualCh: Channel = {
      id: `download-${Date.now()}`,
      name: title,
      alt: [],
      network: 'Local Download',
      owner: 'Vyora TV',
      categories: ['movies'],
      country: 'US',
      website: '',
      logo: '',
      icon: '',
      launched: null,
      closed: null,
      lang: 'en',
      streams: [
        {
          id: 's-dl',
          // Relative URL: the page origin IS the platform engine (the embedded
          // server on Android TV, the Go engine in the browser), so this
          // resolves to the local file on whichever port is running.
          url,
          quality: '1080p',
          label: 'Downloaded (Local Video)',
        },
      ],
    }
    setPlaying(virtualCh)
  }, [settings.downloadsPlayer, settings.defaultPlayer])

  const handleDeleteDownload = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    await deleteDownload(id)
    const updated = await fetchDownloads()
    if (updated) setDownloads(updated)
  }

  const handleStartDownload = async (url: string) => {
    if (!url.trim()) return
    await startDownload(url.trim())
    const updated = await fetchDownloads()
    if (updated) setDownloads(updated)
  }

  const mainRef = useRef<HTMLDivElement | null>(null)
  const loaderRef = useRef<HTMLDivElement | null>(null)

  const t = useCallback((key: string) => translate(settings.lang, key), [settings.lang])

  const activePlaylist = useMemo(() => {
    if (activePlaylistId === 'default') return null
    return playlists.find((p) => p.id === activePlaylistId) || null
  }, [activePlaylistId, playlists])

  /* ---------------- data bootstrap ---------------- */
  useEffect(() => {
    let alive = true
    loadBootstrap()
      .then((b) => {
        if (!alive) return
        setBoot(b)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e?.message || e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- clock ---------------- */
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  /* ---------------- persist ---------------- */
  useEffect(() => {
    localStorage.setItem(FAV_KEY, JSON.stringify(favourites))
  }, [favourites])
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])
  useEffect(() => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  }, [recent])
  useEffect(() => {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists))
  }, [playlists])
  useEffect(() => {
    localStorage.setItem(ACTIVE_PLAYLIST_KEY, JSON.stringify(activePlaylistId))
  }, [activePlaylistId])

  /* ---------------- custom playlist loader ---------------- */
  useEffect(() => {
    let alive = true
    if (!activePlaylist) {
      setCustomChannels([])
      return
    }
    setCustomLoading(true)
    const fetchCustom = async () => {
      try {
        if (activePlaylist.type === 'xtream' && activePlaylist.account) {
          const res = await fetchXtreamChannels(
            activePlaylist.account.server,
            activePlaylist.account.username,
            activePlaylist.account.password,
          )
          if (alive) setCustomChannels(res.channels || [])
        } else if (activePlaylist.type === 'm3u' && activePlaylist.url) {
          const res = await importM3UPlaylist(activePlaylist.url)
          if (alive) setCustomChannels(res.channels || [])
        }
      } catch (e) {
        console.error('Failed to load custom playlist channels:', e)
        if (alive) setCustomChannels([])
      } finally {
        if (alive) setCustomLoading(false)
      }
    }
    void fetchCustom()
    return () => {
      alive = false
    }
  }, [activePlaylist])

  /* load the recently watched channels (light, by id) */
  useEffect(() => {
    let alive = true
    if (!recent.length) {
      setRecentList([])
      return
    }
    loadByIds(recent.slice(0, 20))
      .then((list) => {
        if (alive) setRecentList(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [recent])

  /* ---------------- load channels for the active view ---------------- */
  useEffect(() => {
    let alive = true
    if (activePlaylist) {
      setChannels(customChannels)
      setLoading(customLoading)
      return
    }
    setLoading(true)
    const task =
      view.name === 'country'
        ? loadCountry(view.code, settings.verifiedOnly)
        : view.name === 'category'
          ? loadCategory(view.id, settings.verifiedOnly)
          : view.name === 'favorites'
            ? loadByIds(favourites)
            : view.name === 'home'
              ? (homeCategoryFilter === 'all'
                  ? loadTop(84, settings.verifiedOnly)
                  : homeCategoryFilter === 'apps' || homeCategoryFilter === 'downloads'
                    ? Promise.resolve([])
                    : loadCategory(homeCategoryFilter, settings.verifiedOnly))
              : Promise.resolve([])
    task
      .then((list) => {
        if (!alive) return
        setChannels(list)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setChannels([])
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [view, homeCategoryFilter, settings.verifiedOnly, activePlaylist, customChannels, customLoading])

  /* ---------------- reset filters on view change ---------------- */
  useEffect(() => {
    setCategoryFilter('all')
    setMovieGenre('all')
    setSeriesGenre('all')
    setShownCount(240)
  }, [view])

  /* ---------------- load MovieBox movies ---------------- */
  useEffect(() => {
    let alive = true
    if ((view.name === 'moviebox' || view.name === 'movies') && !movies.length) {
      setVodLoading(true)
      loadMovies()
        .then((list) => {
          if (alive && list) setMovies(list)
        })
        .finally(() => {
          if (alive) setVodLoading(false)
        })
    }
    return () => {
      alive = false
    }
  }, [view, movies.length])

  /* ---------------- global catalogue (paged) ---------------- */
  const loadGlobal = useCallback(
    async (reset: boolean, country = countryFilter, category = categoryFilter) => {
      if (activePlaylist) {
        let filtered = customChannels
        if (category && category !== 'all') {
          filtered = filtered.filter((c) => matchesCategory(c.categories, category))
        }
        setGlobalTotal(filtered.length)
        setGlobalItems(filtered)
        setGlobalLoading(false)
        return
      }
      setGlobalLoading(true)
      const offset = reset ? 0 : globalItems.length
      try {
        const page = await loadGlobalChannels(
          country,
          category,
          '',
          offset,
          PAGE_SIZE,
          settings.verifiedOnly,
        )
        setGlobalTotal(page.total)
        setGlobalItems((prev) => (reset ? page.items : [...prev, ...page.items]))
      } catch {
        if (reset) setGlobalItems([])
      } finally {
        setGlobalLoading(false)
      }
    },
    [
      countryFilter,
      categoryFilter,
      globalItems.length,
      settings.verifiedOnly,
      activePlaylist,
      customChannels,
    ],
  )

  useEffect(() => {
    if (view.name !== 'global') return
    setGlobalItems([])
    void loadGlobal(true, countryFilter, categoryFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, countryFilter, categoryFilter])

  /* infinite scroll for the global grid */
  useEffect(() => {
    if (view.name !== 'global') return
    const node = loaderRef.current
    if (!node || globalLoading || globalItems.length >= globalTotal) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadGlobal(false)
      },
      { root: null, rootMargin: '400px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [view, globalLoading, globalTotal, globalItems.length, loadGlobal])

  /* reset the page size when the view changes */
  useEffect(() => {
    setShownCount(240)
  }, [view, categoryFilter])
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('large-text', settings.a11y.largeText)
    root.classList.toggle('high-contrast', settings.a11y.highContrast)
    root.lang = settings.lang
  }, [settings])

  /* ---------------- country lookup ---------------- */
  const countryByCode = useMemo(() => {
    const m = new Map<string, Country>()
    for (const c of boot?.countries ?? []) m.set(c.code, c)
    return m
  }, [boot])

  /* ---------------- favourites / recent helpers ---------------- */
  const toggleFavourite = useCallback((ch: Channel) => {
    setFavourites((list) =>
      list.includes(ch.id) ? list.filter((x) => x !== ch.id) : [...list, ch.id],
    )
  }, [])

  const play = useCallback(
    (ch: Channel) => {
      const assignedPlayer = settings.channelsPlayer || settings.defaultPlayer || 'internal'
      const ordered = orderStreams(ch, network.quality)
      setRecent((list) => [ch.id, ...list.filter((x) => x !== ch.id)].slice(0, 30))

      if (settings.a11y.audioDescription) {
        const country = countryByCode.get(ch.country)
        speak(
          `${ch.name}. ${country ? country.name : ch.country}. ${ch.categories
            .map((c) => categoryName(settings.lang, c))
            .join(', ')}.`,
        )
      }

      if (isNative && assignedPlayer !== 'internal') {
        const streamUrl = ordered.streams?.[0]?.url || `http://${window.location.host}/api/play?cid=${ch.id}`
        launchExternalStream(assignedPlayer, streamUrl, ch.name)
      }

      setPlaying(ordered)
    },
    [settings.channelsPlayer, settings.defaultPlayer, settings.a11y.audioDescription, settings.lang, countryByCode, network.quality],
  )

  const closePlayer = useCallback(() => {
    setPlaying(null)
    setDrawerOpen(false)
    mainRef.current?.focus()
  }, [])

  /** Warm the manifest cache for a channel (fast start). */
  const prefetchChannel = useCallback(
    async (channelOrId: Channel | string) => {
      try {
        const ch =
          typeof channelOrId === 'string'
            ? channels.find((c) => c.id === channelOrId)
            : channelOrId
        if (!ch?.streams?.length) return
        const bestIdx = getHealthRecord(ch.id)?.bestStream ?? 0
        const stream = ch.streams[bestIdx] || ch.streams[0]
        if (!stream) return
        await fetch(`/api/prefetch?${prefetchParams(stream, ch.id)}`)
        // Warm the runner-up source too, so the race always has a hot backup.
        const backup = ch.streams.find((s, i) => i !== bestIdx && s.url !== stream.url)
        if (backup) {
          void fetch(`/api/prefetch?${prefetchParams(backup, ch.id)}`).catch(() => undefined)
        }
      } catch {
        /* prefetch is best effort */
      }
    },
    [channels],
  )

  /** Priority prefetch: the user is pointing at this channel right now. */
  const prefetchChannelNow = useCallback(
    (channelOrId: Channel | string) => {
      void prefetchNow(async () => {
        await prefetchChannel(channelOrId)
      })
    },
    [prefetchChannel],
  )

  /* warm the visible channels of the current view so a click is instant */
  useEffect(() => {
    if (!channels.length) return
    let cancelled = false
    // Background lane: only the first rows, one source each. The server
    // throttles the rest so the live stream keeps its bandwidth.
    const ids = channels.slice(0, 24).map((c) => c.id)
    void warmChannels(ids, 1)
    // The first few get the full treatment (manifest + first segments).
    for (const ch of channels.slice(0, 10)) {
      if (cancelled) return
      queuePrefetch(async () => {
        await prefetchChannel(ch.id)
      })
    }
    return () => {
      cancelled = true
    }
  }, [channels, prefetchChannel])

  /* warm the next channels so channel up/down is instant */
  useEffect(() => {
    if (!playing || !channels.length) return
    const i = channels.findIndex((c) => c.id === playing.id)
    if (i === -1) return
    const neighbors = [
      channels[(i + 1) % channels.length],
      channels[(i + 2) % channels.length],
      channels[(i - 1 + channels.length) % channels.length],
    ].filter(Boolean)
    void Promise.all(neighbors.map((ch) => prefetchChannel(ch.id)))
  }, [playing, channels, prefetchChannel])

  /* ---------------- remote navigation ---------------- */
  useEffect(() => {
    const uninstall = installNavigation({
      enabled: !playing,
      onBack: () => {
        if (playing) {
          closePlayer()
          return
        }
        if (overlay !== 'none') {
          setOverlay('none')
          setNumberEntry('')
          return
        }
        if (view.name !== 'home') setView({ name: 'home' })
      },
      onFocus: (el) => {
        if (!settings.a11y.announceFocus) return
        const label = el.getAttribute('aria-label') || el.textContent?.trim() || ''
        if (label) setLiveRegion(label)
        const id = el.getAttribute('data-channel-id')
        if (id) prefetchChannelNow(id)
      },
      onChannelUp: () => {
        if (!playing) return
        stepChannel(1)
      },
      onChannelDown: () => {
        if (!playing) return
        stepChannel(-1)
      },
    })
    return uninstall
  }, [playing, overlay, view, channels, settings.a11y.announceFocus, prefetchChannel])

  /* ---------------- player keys (remote only, no on-screen buttons) ------ */
  const [streamDelta, setStreamDelta] = useState(0)
  const [channelStep, setChannelStep] = useState(0)

  useEffect(() => {
    if (!playing) return
    const onKey = (e: KeyboardEvent) => {
      // while the channel drawer is open it owns the arrow keys
      if (drawerOpen && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return
      }
      if (e.key === 'ArrowRight') {
        setStreamDelta((d) => d + 1)
        e.preventDefault()
      } else if (e.key === 'ArrowLeft') {
        setStreamDelta((d) => d - 1)
        e.preventDefault()
      } else if (e.key === 'ArrowUp') {
        setChannelStep((d) => d + 1)
        e.preventDefault()
      } else if (e.key === 'ArrowDown') {
        setChannelStep((d) => d - 1)
        e.preventDefault()
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [playing, drawerOpen])

  useEffect(() => {
    if (!playing || streamDelta === 0) return
    window.dispatchEvent(new CustomEvent('vyora:cycle-stream', { detail: streamDelta }))
    setStreamDelta(0)
  }, [streamDelta, playing])

  useEffect(() => {
    if (!playing || channelStep === 0) return
    stepChannel(channelStep)
    setChannelStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelStep, playing])

  /* step through the channel list (CH up / down, arrows in the player) */
  const stepChannel = useCallback(
    (delta: number) => {
      const list = currentChannelList()
      if (list.length < 2) return
      const i = list.findIndex((c) => c.id === playing?.id)
      const next = i === -1 ? 0 : (i + delta + list.length) % list.length
      play(list[next])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playing, channels, globalItems, view],
  )

  /** The list the "next / previous channel" keys walk through. */
  function currentChannelList(): Channel[] {
    if (view.name === 'country') return channels
    if (view.name === 'category') return channels
    if (view.name === 'global') return globalItems
    if (view.name === 'favorites') return channels.filter((c) => favourites.includes(c.id))
    return channels
  }

  /* ---------------- number entry (channel number) ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing) return
      if (/^[0-9]$/.test(e.key)) {
        setNumberEntry((n) => (n + e.key).slice(-4))
        setOverlay('number')
        e.preventDefault()
        return
      }
      if (overlay === 'number') {
        if (e.key === 'Enter') {
          openChannelNumber()
          e.preventDefault()
        } else if (e.key === 'Backspace') {
          setNumberEntry((n) => n.slice(0, -1))
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, overlay, numberEntry])

  const openChannelNumber = useCallback(() => {
    const num = parseInt(numberEntry, 10)
    setNumberEntry('')
    setOverlay('none')
    if (!Number.isFinite(num)) return
    const list = currentChannelList()
    const target = list[num - 1]
    if (target) play(target)
    else setLiveRegion(`Channel ${num} not found`)
  }, [numberEntry])

  /* ---------------- native (Android TV) back handling ---------------- */
  useEffect(() => {
    const w = window as any
    w.__vyoraBack = () => {
      if (playing) {
        setPlaying(null)
        return 'true'
      }
      if (overlay !== 'none') {
        setOverlay('none')
        setNumberEntry('')
        return 'true'
      }
      if (view.name !== 'home') {
        setView({ name: 'home' })
        return 'true'
      }
      return 'exit'
    }
    return () => {
      delete w.__vyoraBack
    }
  }, [playing, overlay, view])

  /* ---------------- keyboard shortcuts (browser desktop use) ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing) return
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        setOverlay('search')
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing])

  /* ---------------- waiting queue (offline channels) ---------------- */
  useEffect(() => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  }, [queue])

  const addToQueue = useCallback((ch: Channel) => {
    setQueue((q) => (q.includes(ch.id) ? q : [...q, ch.id]))
  }, [])

  /* re-check the queued (offline) channels every minute */
  useEffect(() => {
    if (!queue.length) return
    const id = setInterval(() => {
      void trackStatuses(queue)
    }, 60000)
    return () => clearInterval(id)
  }, [queue])

  /* ---------------- network quality (auto 4K / 2K / 1080) ---------------- */
  useEffect(() => {
    let alive = true
    const poll = async () => {
      const info = await fetchNetwork()
      if (alive) setNetwork(info)
    }
    void poll()
    const id = setInterval(poll, 15000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  /* ---------------- visible channels for the current view ---------------- */
  const rawVisibleChannels = useMemo(() => {
    if (view.name === 'home' || view.name === 'global' || view.name === 'movies' || view.name === 'series') return []
    if (categoryFilter === 'all') return channels
    return channels.filter((c) => matchesCategory(c.categories, categoryFilter))
  }, [channels, view, categoryFilter])

  const countryCategoryCounts = useMemo(() => {
    if (view.name !== 'country' && view.name !== 'category') return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const cat of STANDARD_CATEGORIES) {
      if (cat === 'all') {
        counts.set('all', channels.length)
      } else {
        const count = channels.filter((ch) => matchesCategory(ch.categories, cat)).length
        if (count > 0) {
          counts.set(cat, count)
        }
      }
    }
    // Also include any raw channel categories that have channels
    for (const ch of channels) {
      if (Array.isArray(ch.categories)) {
        for (const c of ch.categories) {
          const norm = (c || '').trim().toLowerCase()
          if (norm && !counts.has(norm)) {
            const count = channels.filter((item) => matchesCategory(item.categories, norm)).length
            if (count > 0) {
              counts.set(norm, count)
            }
          }
        }
      }
    }
    return counts
  }, [view, channels])

  const countryCategories = useMemo(() => {
    if (view.name !== 'country' && view.name !== 'category') return []
    const available = STANDARD_CATEGORIES.filter((cat) => (countryCategoryCounts.get(cat) || 0) > 0)
    for (const k of countryCategoryCounts.keys()) {
      if (!available.includes(k) && (countryCategoryCounts.get(k) || 0) > 0) {
        available.push(k)
      }
    }
    return available
  }, [view, countryCategoryCounts])

  /* ---------------- VOD memoized genres & visible lists ---------------- */
  const movieGenres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of movies) {
      if (m.genre) {
        counts.set(m.genre, (counts.get(m.genre) || 0) + 1)
      }
    }
    const sorted = Array.from(counts.keys()).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
    return { counts, list: ['all', ...sorted] }
  }, [movies])

  const visibleMovies = useMemo(() => {
    if (movieGenre === 'all') return movies
    const gLower = movieGenre.toLowerCase()
    return movies.filter((m) => m.genre && m.genre.toLowerCase() === gLower)
  }, [movies, movieGenre])

  const movieboxFiltered = useMemo(() => {
    let list = movies
    if (movieboxGenre !== 'all') {
      const g = movieboxGenre.toLowerCase()
      list = list.filter((m) => (m.genre || '').toLowerCase().includes(g))
    }
    if (movieboxSearch.trim()) {
      const q = movieboxSearch.toLowerCase().trim()
      list = list.filter(
        (m) =>
          (m.title || '').toLowerCase().includes(q) ||
          (m.genre || '').toLowerCase().includes(q) ||
          (m.description || '').toLowerCase().includes(q),
      )
    }
    return list
  }, [movies, movieboxGenre, movieboxSearch])

  const spotlightMovie = useMemo(() => {
    return movies.find((m) => m.backdrop) || movies[0] || null
  }, [movies])

  const seriesGenres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of series) {
      if (s.genre) {
        counts.set(s.genre, (counts.get(s.genre) || 0) + 1)
      }
    }
    const sorted = Array.from(counts.keys()).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
    return { counts, list: ['all', ...sorted] }
  }, [series])

  const visibleSeries = useMemo(() => {
    if (seriesGenre === 'all') return series
    const gLower = seriesGenre.toLowerCase()
    return series.filter((s) => s.genre && s.genre.toLowerCase() === gLower)
  }, [series, seriesGenre])

  const playMovie = useCallback((m: Movie) => {
    const assignedPlayer = settings.moviesPlayer || settings.defaultPlayer || 'internal'
    if (assignedPlayer !== 'internal') {
      launchExternalStream(assignedPlayer, m.url, m.title)
    }
    const movieChannel: Channel = {
      id: `movie-${m.id}`,
      name: m.title,
      alt: [],
      network: m.genre || 'Cinema',
      owner: m.source || 'MovieBox',
      categories: ['movies', (m.genre || 'cinema').toLowerCase()],
      country: 'US',
      website: '',
      logo: m.logo,
      icon: m.logo,
      launched: typeof m.year === 'number' ? m.year : null,
      closed: null,
      lang: 'en',
      streams: [
        {
          id: `stream-m-${m.id}`,
          url: m.url,
          quality: m.quality || '4K UHD',
          label: 'MovieBox Stream',
        },
      ],
    }
    setPlaying(movieChannel)
  }, [settings.moviesPlayer, settings.defaultPlayer])

  const playEpisode = useCallback((s: Series, ep: any) => {
    const assignedPlayer = settings.seriesPlayer || settings.defaultPlayer || 'internal'
    const fullTitle = `${s.title} - S${ep.season}E${ep.episode}: ${ep.title}`
    if (assignedPlayer !== 'internal') {
      launchExternalStream(assignedPlayer, ep.url, fullTitle)
    }
    const episodeChannel: Channel = {
      id: `series-${ep.id}`,
      name: fullTitle,
      alt: [],
      network: s.genre,
      owner: s.title,
      categories: ['series', s.genre.toLowerCase()],
      country: 'VOD',
      website: '',
      logo: ep.logo || s.logo,
      icon: ep.logo || s.logo,
      launched: null,
      closed: null,
      lang: 'en',
      streams: [
        {
          id: `stream-ep-${ep.id}`,
          url: ep.url,
          quality: 'HD',
          label: 'Episode',
        },
      ],
    }
    setPlaying(episodeChannel)
    setSelectedSeries(null)
  }, [settings.seriesPlayer, settings.defaultPlayer])

  const favouriteChannels = useMemo(
    () => channels.filter((c) => favourites.includes(c.id)),
    [channels, favourites],
  )

  /** Channels that are currently on screen -> their live status. */
  const visibleIds = useMemo(() => {
    const list =
      view.name === 'global'
        ? globalItems
        : view.name === 'country' || view.name === 'category'
          ? rawVisibleChannels
          : view.name === 'favorites'
            ? favouriteChannels
            : channels
    return list.slice(0, 400).map((c) => c.id)
  }, [view, globalItems, rawVisibleChannels, favouriteChannels, channels])

  const statuses = useChannelHealth(visibleIds)

  const visibleChannels = useMemo(() => {
    if (!rawVisibleChannels.length) return []
    return [...rawVisibleChannels].sort((a, b) => {
      const sa = statuses[a.id]?.status
      const sb = statuses[b.id]?.status
      const rankA = sa === 'online' ? 2 : sa === 'unknown' ? 1 : 0
      const rankB = sb === 'online' ? 2 : sb === 'unknown' ? 1 : 0
      return rankB - rankA
    })
  }, [rawVisibleChannels, statuses])

  /** Top channels across EVERY country (prioritizing confirmed online). */
  const featuredChannels = useMemo(() => {
    const sorted = [...channels].sort((a, b) => {
      const sa = statuses[a.id]?.status
      const sb = statuses[b.id]?.status
      const rankA = sa === 'online' ? 20000 : sa === 'unknown' ? 0 : -20000
      const rankB = sb === 'online' ? 20000 : sb === 'unknown' ? 0 : -20000

      const qa = qualityScore(a.streams?.[0]?.label)
      const qb = qualityScore(b.streams?.[0]?.label)
      return rankB + qb * 10 + (b.streams?.length || 0) - (rankA + qa * 10 + (a.streams?.length || 0))
    })
    if (view.name === 'home') return sorted
    // one entry per country first, then fill up with the rest
    const seen = new Set<string>()
    const out: Channel[] = []
    for (const ch of sorted) {
      if (!seen.has(ch.country)) {
        seen.add(ch.country)
        out.push(ch)
      }
      if (out.length >= 60) break
    }
    for (const ch of sorted) {
      if (out.length >= 84) break
      if (!out.includes(ch)) out.push(ch)
    }
    return out
  }, [channels, view, statuses])

  const recentChannels = useMemo(() => recentList, [recentList])

  const spotlightChannels = useMemo(() => {
    return featuredChannels.slice(0, 5)
  }, [featuredChannels])

  const currentSpotlight = spotlightChannels[spotlightIndex] || featuredChannels[0] || null

  const sportsChannels = useMemo(() => {
    return channels.filter((c) => matchesCategory(c.categories, 'sports')).slice(0, 16)
  }, [channels])

  /* ---------------- render ---------------- */
  if (loading && !boot) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">V</div>
        <div className="spinner" aria-hidden="true" />
        <p>Vyora TV is loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="boot-screen">
        <h1>Vyora TV</h1>
        <p className="error-text">{error}</p>
        <p className="muted">Run `npm run data` and `npm run build`, then `npm start`.</p>
      </div>
    )
  }

  const activeCountry =
    view.name === 'country' ? countryByCode.get(view.code) : undefined

  const filterSummary = [
    view.name === 'country' ? activeCountry?.name : undefined,
    view.name === 'category' ? categoryName(settings.lang, (view as any).id) : undefined,
    view.name === 'global'
      ? countryFilter === 'all'
        ? 'All countries'
        : countryByCode.get(countryFilter)?.name
      : undefined,
    categoryFilter !== 'all' ? categoryName(settings.lang, categoryFilter) : undefined,
  ]
    .filter(Boolean)
    .join(' - ')

  return (
    <div className="app">
      <TopBar
        clock={clock}
        onBrandClick={() => setView({ name: 'home' })}
        onMenuToggle={() => setMobileNavOpen((o) => !o)}
        menuOpen={mobileNavOpen}
        left={
          <nav className={`topnav ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
            <button
              className={`topnav-btn ${view.name === 'home' ? 'active' : ''}`}
              data-focusable
              onClick={() => {
                setView({ name: 'home' })
                setMobileNavOpen(false)
              }}
            >
              <Icon name="home" size={16} /> {t('home')}
            </button>
            <button
              className={`topnav-btn ${view.name === 'global' ? 'active' : ''}`}
              data-focusable
              onClick={() => {
                setView({ name: 'global' })
                setMobileNavOpen(false)
              }}
            >
              <Icon name="globe" size={16} /> {t('global')}
            </button>
            <button
              className={`topnav-btn ${view.name === 'favorites' ? 'active' : ''}`}
              data-focusable
              onClick={() => {
                setView({ name: 'favorites' })
                setMobileNavOpen(false)
              }}
            >
              <Icon name="star" size={16} /> {t('favorites')}
            </button>
            <button
              className={`topnav-btn ${view.name === 'browser' ? 'active' : ''}`}
              data-focusable
              onClick={() => {
                setView({ name: 'browser' })
                setMobileNavOpen(false)
              }}
            >
              <Icon name="compass" size={16} /> {t('browser')}
            </button>
            <button
              className={`topnav-btn ${view.name === 'apps' ? 'active' : ''}`}
              data-focusable
              onClick={() => {
                setView({ name: 'apps' })
                setMobileNavOpen(false)
              }}
            >
              <Icon name="apps" size={16} /> {t('apps')}
            </button>
            <button
              className={`topnav-btn ${view.name === 'downloads' ? 'active' : ''}`}
              data-focusable
              onClick={() => {
                setView({ name: 'downloads' })
                setMobileNavOpen(false)
              }}
            >
              <Icon name="download" size={16} /> {t('downloads')}
              {downloads.length > 0 ? (
                <span className="topnav-badge">{downloads.length}</span>
              ) : null}
            </button>
          </nav>
        }
        right={
          <>
            <button
              className="theme-toggle-btn"
              data-focusable
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Studio Light Theme' : 'Switch to Cinema Dark Theme'}
              aria-label="Toggle Theme"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
              <span>{theme === 'dark' ? 'Light' : 'Cinema'}</span>
            </button>
            {queue.length ? (
              <span className="queue-badge" title={t('queueHint')}>
                <Icon name="queue" size={15} /> {queue.length}
              </span>
            ) : null}
            <button
              className="btn btn-ghost"
              data-focusable
              onClick={() => setOverlay('playlists')}
              title={activePlaylist ? `Active: ${activePlaylist.name}` : 'Playlists & Xtream Codes'}
            >
              <Icon name="list" size={17} />
              {activePlaylist ? (
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-2)', marginLeft: '4px' }}>
                  {activePlaylist.name.slice(0, 12)}
                </span>
              ) : (
                <span> {t('playlists')}</span>
              )}
            </button>
            <button
              className="btn btn-ghost"
              data-focusable
              onClick={() => setOverlay('search')}
              title="Search Channels (Cmd/Ctrl+K)"
            >
              <Icon name="search" size={17} /> {t('search')}
            </button>
            <button
              className="btn btn-ghost"
              data-focusable
              onClick={() => setOverlay('number')}
              title="Dial Channel Number"
            >
              <Icon name="hash" size={17} /> {t('channelNumber')}
            </button>
            <button
              className="btn btn-ghost"
              data-focusable
              onClick={() => setOverlay('settings')}
              title="System Settings"
            >
              <Icon name="settings" size={19} />
            </button>
          </>
        }
      />

      <main className="main" ref={mainRef} tabIndex={-1}>
        {view.name === 'home' ? (
          <>
            <section className="cinema-hero" aria-label="Featured Cinema Spotlight">
              <div className="cinema-hero-main">
                <div className="cinema-hero-content">
                  <div className="cinema-hero-badges">
                    <span className="hero-live-pill">
                      <span className="pulse-dot" /> LIVE BROADCAST
                    </span>
                    <span className="hero-quality-pill">
                      {currentSpotlight?.streams?.[0]?.label || '1080p ULTRA HD'}
                    </span>
                    {currentSpotlight ? (
                      <span className="hero-meta-pill">
                        {countryByCode.get(currentSpotlight.country)?.flag}{' '}
                        {countryByCode.get(currentSpotlight.country)?.name || currentSpotlight.country}
                      </span>
                    ) : null}
                    {currentSpotlight?.categories?.[0] ? (
                      <span className="hero-meta-pill">
                        {currentSpotlight.categories[0]}
                      </span>
                    ) : null}
                  </div>

                  <h1 className="cinema-hero-title">
                    {currentSpotlight?.name || t('appName')}
                  </h1>

                  <p className="cinema-hero-desc">
                    {currentSpotlight
                      ? `${currentSpotlight.network || currentSpotlight.owner || 'Premium live streaming'} • Instant zero-buffer dual-lane turbo playback with dynamic failover.`
                      : t('tagline')}
                  </p>

                  <div className="cinema-hero-actions">
                    <button
                      className="btn btn-primary hero-btn-play"
                      data-focusable
                      onClick={() => currentSpotlight && play(currentSpotlight)}
                      title="Play Live Stream Now"
                    >
                      <Icon name="play" size={20} /> Watch Live Now
                    </button>
                    {currentSpotlight ? (
                      <button
                        className={`btn btn-ghost hero-btn-fav ${favourites.includes(currentSpotlight.id) ? 'active' : ''}`}
                        data-focusable
                        onClick={() => toggleFavourite(currentSpotlight)}
                        title={favourites.includes(currentSpotlight.id) ? 'Remove Favourite' : 'Add to Favourites'}
                      >
                        <Icon name={favourites.includes(currentSpotlight.id) ? 'star-filled' : 'star'} size={18} />
                        {favourites.includes(currentSpotlight.id) ? 'Favourited' : 'Add to Favourites'}
                      </button>
                    ) : null}
                    {spotlightChannels.length > 1 ? (
                      <button
                        className="btn btn-ghost hero-btn-shuffle"
                        data-focusable
                        onClick={() => setSpotlightIndex((prev) => (prev + 1) % spotlightChannels.length)}
                        title="Shuffle Spotlight Channel"
                      >
                        <Icon name="refresh" size={17} /> Next Spotlight
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="cinema-hero-spotlight">
                  <div className="hero-logo-card">
                    {currentSpotlight ? (
                      <ChannelLogo channel={currentSpotlight} size="lg" />
                    ) : (
                      <div className="brand-mark-inner" style={{ fontSize: 48, fontWeight: 900 }}>V</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="cinema-hero-footer">
                {spotlightChannels.length > 1 ? (
                  <div className="hero-spotlight-rail">
                    {spotlightChannels.map((ch, idx) => (
                      <button
                        key={ch.id}
                        className={`spotlight-thumb-chip ${idx === spotlightIndex ? 'active' : ''}`}
                        data-focusable
                        onClick={() => setSpotlightIndex(idx)}
                      >
                        <span className="spotlight-thumb-logo">
                          <ChannelLogo channel={ch} size="sm" />
                        </span>
                        <span>{ch.name}</span>
                        {idx === spotlightIndex ? <span className="pulse-dot" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="cinema-hero-stats">
                  <div className="hero-stat-item">
                    <strong>{boot?.totals.channels?.toLocaleString() ?? '14,297'}</strong>
                    <span>Channels</span>
                  </div>
                  <div className="hero-stat-item">
                    <strong>{boot?.totals.countries?.toLocaleString() ?? '180'}</strong>
                    <span>Countries</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="row home-engines-row">
              <div className="home-engines-header">
                <span className="home-engines-title"><Icon name="search" size={20} /> 5 Search Engines</span>
                <span className="muted">Launch Chromium Browser with your chosen engine</span>
              </div>
              <div className="home-engines-strip">
                {BROWSER_ENGINES_LIST.map((eng) => (
                  <button
                    key={eng.id}
                    className="home-engine-chip"
                    data-focusable
                    style={{ '--engine-color': eng.color } as any}
                    onClick={() => setView({ name: 'browser', initialEngine: eng.id, initialUrl: eng.homeUrl })}
                  >
                    <BrandLogo iconUrl={logoUrl(eng.favicon)} color={eng.color} label={eng.name} size={26} rounded={13} />
                    <span className="engine-chip-name">{eng.name}</span>
                    <span className="engine-chip-tag">{eng.tagline}</span>
                  </button>
                ))}
              </div>
            </section>

            {sportsChannels.length > 0 ? (
              <section className="row cinema-sports-rail">
                <div className="home-filter-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h2 className="row-title" style={{ margin: 0 }}>
                    <Icon name="signal" size={22} /> 🏆 Live Sports & Stadium Feeds
                    <span className="muted" style={{ fontSize: '14px', fontWeight: 600 }}>({sportsChannels.length} Live Feeds)</span>
                  </h2>
                  <button
                    className="btn btn-ghost"
                    data-focusable
                    onClick={() => setHomeCategoryFilter('sports')}
                  >
                    All Sports Channels →
                  </button>
                </div>
                <div className="row-track">
                  {sportsChannels.map((ch) => (
                    <ChannelCard
                      key={ch.id}
                      channel={ch}
                      country={countryByCode.get(ch.country)}
                      onPlay={play}
                      onFavourite={toggleFavourite}
                      onPrefetch={prefetchChannelNow}
                      status={statusOf(statuses, ch.id)}
                      favourite={favourites.includes(ch.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="row">
              <h2 className="row-title"><Icon name="globe" size={22} /> {t('countries')}</h2>
              <div className="row-track">
                <button
                  className="card country-card global-card"
                  data-focusable
                  onClick={() => setView({ name: 'global' })}
                  aria-label={`${t('global')}, ${boot?.totals.channels ?? 0} channels`}
                >
                  <span className="global-mark" aria-hidden="true">
                    <Icon name="globe" size={40} />
                  </span>
                  <div className="country-name">{t('global')}</div>
                  <div className="country-count">{boot?.totals.channels ?? 0}</div>
                </button>
                {(boot?.countries ?? []).map((c) => (
                  <CountryCard
                    key={c.code}
                    country={c}
                    onOpen={(code) => {
                      setCategoryFilter('all')
                      setView({ name: 'country', code })
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="row">
              <h2 className="row-title"><Icon name="film" size={22} /> {t('byCategory')}</h2>
              <div className="row-track">
                <button
                  className="card theme-card theme-card-apps"
                  data-focusable
                  onClick={() => setView({ name: 'apps' })}
                  aria-label={`${t('apps')}, Chromium Browser & Web Tools`}
                >
                  <div className="theme-name"><Icon name="compass" size={17} /> {t('apps')}</div>
                  <div className="theme-count">{installedApps.length} Apps</div>
                </button>
                <button
                  className="card theme-card theme-card-downloads"
                  data-focusable
                  onClick={() => setView({ name: 'downloads' })}
                  aria-label={`${t('downloads')}, Movies, Media & APKs`}
                >
                  <div className="theme-name"><Icon name="download" size={17} /> {t('downloads')}</div>
                  <div className="theme-count">{downloads.length} files</div>
                </button>
                {(boot?.categories ?? []).filter((c) => c.id !== 'movies' && c.id !== 'series').map((c) => (
                  <ThemeCard
                    key={c.id}
                    id={c.id}
                    name={categoryName(settings.lang, c.id)}
                    count={c.count}
                    onOpen={(id) => {
                      setCategoryFilter('all')
                      setView({ name: 'category', id })
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="row apps-featured-row">
              <div className="home-filter-head">
                <h2 className="row-title">
                  <Icon name="apps" size={22} /> {t('apps')}
                  <span className="muted">({t('appsDesc')})</span>
                </h2>
              </div>
              <div className="apps-featured-banner">
                <div
                  className="featured-browser-card"
                  data-focusable
                  onClick={() => setView({ name: 'browser' })}
                >
                  <div className="featured-browser-icon">
                    <Icon name="compass" size={38} />
                  </div>
                  <div className="featured-browser-text">
                    <div className="browser-badge-pill">Built-in Chromium Engine</div>
                    <h3>{t('chromiumBrowser')}</h3>
                    <p>{t('chromiumDesc')}</p>
                    <div className="browser-features-list">
                      <span>✓ DuckDuckGo Search</span>
                      <span>✓ Anti-CORS Proxy</span>
                      <span>✓ 10-ft TV Zoom</span>
                      <span>✓ Speed Dial Portals</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    data-focusable
                    onClick={(e) => {
                      e.stopPropagation()
                      setView({ name: 'browser' })
                    }}
                  >
                    <Icon name="play" size={16} /> {t('openBrowser')}
                  </button>
                </div>
              </div>
            </section>

            <section className="row home-filter-section">
              <div className="home-filter-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <h2 className="row-title">
                  <Icon name="tv" size={22} /> {homeCategoryFilter === 'all' ? t('featured') : homeCategoryFilter === 'downloads' ? t('downloads') : categoryName(settings.lang, homeCategoryFilter)}
                  <span className="muted">
                    ({homeCategoryFilter === 'apps' ? installedApps.length + 1 : homeCategoryFilter === 'downloads' ? downloads.length : featuredChannels.length})
                  </span>
                </h2>
                {homeCategoryFilter !== 'apps' && homeCategoryFilter !== 'downloads' ? (
                  <button
                    className={`chip ${settings.verifiedOnly ? 'active' : ''}`}
                    data-focusable
                    onClick={() =>
                      setSettings({
                        ...settings,
                        verifiedOnly: !settings.verifiedOnly,
                      })
                    }
                    title="Filter channels to only show tested live streams"
                    style={{ cursor: 'pointer' }}
                  >
                    <Icon name="check" size={13} /> {settings.verifiedOnly ? 'Verified Live Only: ON' : 'Verified Live Only: OFF'}
                  </button>
                ) : null}
              </div>
              <div className="chips chips-scroll home-category-chips" role="tablist">
                <button
                  className={`chip home-filter-chip ${homeCategoryFilter === 'all' ? 'active' : ''}`}
                  data-focusable
                  onClick={() => setHomeCategoryFilter('all')}
                  role="tab"
                  aria-selected={homeCategoryFilter === 'all'}
                >
                  <Icon name="star-filled" size={13} /> {t('all')}
                </button>
                <button
                  className={`chip home-filter-chip ${homeCategoryFilter === 'apps' ? 'active' : ''}`}
                  data-focusable
                  onClick={() => setHomeCategoryFilter('apps')}
                  role="tab"
                  aria-selected={homeCategoryFilter === 'apps'}
                >
                  <Icon name="apps" size={13} /> {t('apps')} ({installedApps.length})
                </button>
                <button
                  className={`chip home-filter-chip ${homeCategoryFilter === 'downloads' ? 'active' : ''}`}
                  data-focusable
                  onClick={() => setHomeCategoryFilter('downloads')}
                  role="tab"
                  aria-selected={homeCategoryFilter === 'downloads'}
                >
                  <Icon name="download" size={13} /> {t('downloads')} {downloads.length > 0 ? `(${downloads.length})` : ''}
                </button>
                {['kids', 'sports', 'news', 'entertainment', 'music', 'religious', 'documentary', 'animation', 'comedy', 'education', 'lifestyle', 'science', 'weather'].map((cat) => (
                  <button
                    key={cat}
                    className={`chip home-filter-chip ${homeCategoryFilter === cat ? 'active' : ''}`}
                    data-focusable
                    onClick={() => setHomeCategoryFilter(cat)}
                    role="tab"
                    aria-selected={homeCategoryFilter === cat}
                  >
                    {categoryName(settings.lang, cat)}
                  </button>
                ))}
              </div>
              {homeCategoryFilter === 'apps' ? (
                <div className="apps-grid">
                  <div
                    className="app-card featured-app-card"
                    data-focusable
                    onClick={() => setView({ name: 'browser' })}
                  >
                    <div className="app-card-badge">
                      <Icon name="compass" size={32} />
                    </div>
                    <div className="app-card-body">
                      <div className="app-badge-tag">Featured App</div>
                      <h3 className="app-card-title">{t('chromiumBrowser')}</h3>
                      <p className="app-card-desc">{t('chromiumDesc')}</p>
                      <div className="app-card-pills">
                        <span className="pill">5 Search Engines</span>
                        <span className="pill">Dual-Lane Proxy</span>
                        <span className="pill">TV Zoom</span>
                        <span className="pill">Web App Installer</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary app-card-launch"
                      data-focusable
                      onClick={(e) => {
                        e.stopPropagation()
                        setView({ name: 'browser' })
                      }}
                    >
                      <Icon name="play" size={16} /> {t('openBrowser')}
                    </button>
                  </div>

                  {installedApps.map((app) => (
                    <div
                      key={app.id}
                      className="app-card installed-app-card"
                      data-focusable
                      onClick={() => setView({ name: 'browser', initialUrl: app.url })}
                    >
                      <button
                        className="app-del-btn"
                        title="Uninstall Web App"
                        onClick={(e) => handleUninstallApp(app.id, e)}
                      >
                        ✕
                      </button>
                      <div
                        className="app-card-badge"
                        style={{ background: `linear-gradient(135deg, ${app.color || '#38bdf8'}, #0f172a)` }}
                      >
                        <AppBadgeLogo app={app} size={28} />
                      </div>
                      <div className="app-card-body">
                        <div className="app-badge-tag">{app.category || 'Web App'}</div>
                        <h3 className="app-card-title">{app.title}</h3>
                        <p className="app-card-desc" style={{ fontSize: 11, opacity: 0.7 }}>
                          {app.url}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost app-card-launch"
                        data-focusable
                        onClick={(e) => {
                          e.stopPropagation()
                          setView({ name: 'browser', initialUrl: app.url })
                        }}
                      >
                        Launch
                      </button>
                    </div>
                  ))}

                  <div
                    className="app-card app-card-add"
                    data-focusable
                    onClick={() => setView({ name: 'browser' })}
                  >
                    <div className="app-card-badge" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <Icon name="compass" size={28} />
                    </div>
                    <div className="app-card-body">
                      <h3 className="app-card-title">+ Install Web Apps</h3>
                      <p className="app-card-desc">
                        Browse any website or service in Chromium and click "Install as App" to pin it here.
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost app-card-launch"
                      data-focusable
                      onClick={(e) => {
                        e.stopPropagation()
                        setView({ name: 'browser' })
                      }}
                    >
                      Open Browser
                    </button>
                  </div>
                </div>
              ) : homeCategoryFilter === 'downloads' ? (
                <div className="downloads-grid-home">
                  {downloads.length === 0 ? (
                    <div className="empty">
                      <Icon name="download" size={32} />
                      <p style={{ marginTop: 8, fontWeight: 600 }}>No downloaded movies or apps yet.</p>
                      <p className="muted" style={{ maxWidth: 500, margin: '6px auto 14px auto' }}>
                        Browse movies, video files (.mp4/.mkv), or TV apps (.apk) inside Chromium Browser to download and watch them directly on your TV.
                      </p>
                      <button
                        className="btn btn-primary"
                        data-focusable
                        onClick={() => setView({ name: 'browser' })}
                      >
                        <Icon name="compass" size={16} /> Open Chromium Browser
                      </button>
                    </div>
                  ) : (
                    <div className="apps-grid">
                      {downloads.map((d) => {
                        const isVideo = /\.(mp4|mkv|webm|avi|mov|ts)$/i.test(d.fileName)
                        const isApk = /\.apk$/i.test(d.fileName)
                        return (
                          <div key={d.id} className="app-card download-card" data-focusable>
                            <button
                              className="app-del-btn"
                              title="Delete downloaded file"
                              onClick={(e) => handleDeleteDownload(d.id, e)}
                            >
                              ✕
                            </button>
                            <div
                              className="app-card-badge"
                              style={{
                                background: isVideo
                                  ? 'linear-gradient(135deg, #10b981, #047857)'
                                  : isApk
                                    ? 'linear-gradient(135deg, #0ea5e9, #0369a1)'
                                    : 'linear-gradient(135deg, #64748b, #334155)',
                              }}
                            >
                              <Icon name={isVideo ? 'play' : isApk ? 'apps' : 'download'} size={26} />
                            </div>
                            <div className="app-card-body">
                              <div className="app-badge-tag">
                                {isVideo ? 'Movie / Video' : isApk ? 'Android TV App' : 'Downloaded File'} •{' '}
                                {d.status === 'completed'
                                  ? 'Ready'
                                  : d.status === 'downloading'
                                    ? `${d.progress}%`
                                    : d.status}
                              </div>
                              <h3 className="app-card-title" title={d.fileName}>{d.fileName}</h3>
                              <p className="app-card-desc" style={{ fontSize: 11, opacity: 0.7 }}>
                                {d.sizeBytes ? `${(d.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : 'In progress'}
                                {d.speed ? ` • ${d.speed}` : ''}
                              </p>
                              {d.status === 'downloading' ? (
                                <div className="dl-progress-bar">
                                  <div
                                    className="dl-progress-fill"
                                    style={{ width: `${d.progress}%` }}
                                  />
                                </div>
                              ) : null}
                            </div>
                            <div className="download-actions" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                              {isVideo && d.status === 'completed' ? (
                                <button
                                  className="btn btn-primary btn-sm"
                                  data-focusable
                                  onClick={() => handlePlayDownloadedMovie(d.url, d.fileName)}
                                >
                                  <Icon name="play" size={14} /> Play Movie
                                </button>
                              ) : null}
                              {isApk && d.status === 'completed' ? (
                                <button
                                  className="btn btn-primary btn-sm"
                                  data-focusable
                                  onClick={() => nativeInstallApk(d.url)}
                                >
                                  <Icon name="check" size={14} /> Install on TV
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : featuredChannels.length ? (
                settings.channelPanelLayout === 'cable' ? (
                  <div className="cable-epg-list">
                    {featuredChannels.map((ch, idx) => {
                      const isOnline = statusOf(statuses, ch.id) === 'online'
                      return (
                        <div
                          key={ch.id}
                          className="cable-epg-row"
                          data-focusable
                          onClick={() => play(ch)}
                        >
                          <span className="cable-number">{(idx + 1).toString().padStart(3, '0')}</span>
                          <div className="cable-logo-box">
                            <ChannelLogo channel={ch} size="sm" className="cable-logo-img" />
                          </div>
                          <div className="cable-info">
                            <h4 className="cable-name">{ch.name}</h4>
                            <span className="cable-meta">
                              {countryByCode.get(ch.country)?.name || ch.country}
                              {ch.categories?.length ? ` • ${ch.categories.slice(0, 2).join(', ')}` : ''}
                            </span>
                          </div>
                          <span className={`cable-badge ${isOnline ? 'online' : ''}`}>
                            {isOnline ? 'ONLINE' : 'LIVE'}
                          </span>
                          <div className="cable-action">
                            <Icon name="play" size={18} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="grid grid-channels">
                    {featuredChannels.map((ch) => (
                      <ChannelCard
                        key={ch.id}
                        channel={ch}
                        country={countryByCode.get(ch.country)}
                        onPlay={play}
                        onFavourite={toggleFavourite}
                        onPrefetch={prefetchChannelNow}
                        status={statusOf(statuses, ch.id)}
                        favourite={favourites.includes(ch.id)}
                      />
                    ))}
                  </div>
                )
              ) : (
                <div className="empty"><Icon name="alert" size={20} /> No channels found for {categoryName(settings.lang, homeCategoryFilter)}</div>
              )}
            </section>

            {downloads.length > 0 && homeCategoryFilter === 'all' ? (
              <section className="row home-downloads-shelf">
                <div className="home-filter-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 className="row-title">
                    <Icon name="download" size={22} /> Downloaded Movies & TV Apps
                    <span className="muted">({downloads.length})</span>
                  </h2>
                  <button
                    className="btn btn-ghost"
                    data-focusable
                    onClick={() => setView({ name: 'downloads' })}
                  >
                    View All Downloads →
                  </button>
                </div>
                <div className="row-track">
                  {downloads.map((d) => {
                    const isVideo = /\.(mp4|mkv|webm|avi|mov|ts)$/i.test(d.fileName)
                    const isApk = /\.apk$/i.test(d.fileName)
                    return (
                      <div
                        key={d.id}
                        className="card download-shelf-card"
                        data-focusable
                        onClick={() => {
                          if (isVideo && d.status === 'completed') handlePlayDownloadedMovie(d.url, d.fileName)
                          else if (isApk && d.status === 'completed') nativeInstallApk(d.url)
                          else setView({ name: 'downloads' })
                        }}
                      >
                        <div
                          className="shelf-icon-wrap"
                          style={{
                            background: isVideo ? '#10b981' : isApk ? '#0ea5e9' : '#64748b',
                          }}
                        >
                          <Icon name={isVideo ? 'film' : isApk ? 'apps' : 'download'} size={28} />
                        </div>
                        <div className="shelf-info">
                          <div className="shelf-title">{d.fileName}</div>
                          <div className="shelf-meta">
                            {d.status === 'completed' ? '✓ Ready' : `${d.progress}%`} •{' '}
                            {d.sizeBytes ? `${(d.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : ''}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {recentChannels.length ? (
              <section className="row">
                <h2 className="row-title"><Icon name="clock" size={22} /> {t('recent')}</h2>
                <div className="grid grid-channels">
                  {recentChannels.map((ch) => (
                    <ChannelCard
                      key={ch.id}
                      channel={ch}
                      country={countryByCode.get(ch.country)}
                      onPlay={play}
                      onPrefetch={prefetchChannelNow}
                      status={statusOf(statuses, ch.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {view.name === 'favorites' ? (
          <section className="row">
            <h2 className="row-title">
              <Icon name="star" size={22} /> {t('favorites')} {favouriteChannels.length ? `(${favouriteChannels.length})` : ''}
            </h2>
            {favouriteChannels.length === 0 ? (
              <div className="empty"><Icon name="star" size={18} /> {t('favorites')} - {t('noResults')}</div>
            ) : (
              <div className="grid grid-channels">
                {favouriteChannels.map((ch) => (
                  <ChannelCard
                    key={ch.id}
                    channel={ch}
                    country={countryByCode.get(ch.country)}
                    onPlay={play}
                    onFavourite={toggleFavourite}
                    onPrefetch={prefetchChannelNow}
                      status={statusOf(statuses, ch.id)}
                    favourite={favourites.includes(ch.id)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {view.name === 'global' ? (
          <>
          <section className="row">
            <h2 className="row-title">
              <Icon name="globe" size={22} /> {t('global')} <span className="muted">({globalTotal})</span>
            </h2>

            <div className="chips chips-scroll">
              <button
                className={`chip ${countryFilter === 'all' ? 'active' : ''}`}
                data-focusable
                onClick={() => setCountryFilter('all')}
              >
                {t('allCountries')}
              </button>
              {(boot?.countries ?? []).map((c) => (
                <button
                  key={c.code}
                  className={`chip ${countryFilter === c.code ? 'active' : ''}`}
                  data-focusable
                  onClick={() => setCountryFilter(c.code)}
                >
                  {c.flag} {c.name} <span className="chip-count">{c.count}</span>
                </button>
              ))}
            </div>

            <div className="chips">
              <button
                className={`chip ${categoryFilter === 'all' ? 'active' : ''}`}
                data-focusable
                onClick={() => setCategoryFilter('all')}
              >
                {t('all')}
              </button>
              {(boot?.categories ?? []).filter((c) => c.id !== 'movies' && c.id !== 'series').map((c) => (
                <button
                  key={c.id}
                  className={`chip ${categoryFilter === c.id ? 'active' : ''}`}
                  data-focusable
                  onClick={() => setCategoryFilter(c.id)}
                >
                  {categoryName(settings.lang, c.id)} <span className="chip-count">{c.count}</span>
                </button>
              ))}
            </div>

            <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                className={`btn btn-ghost ${groupByCountry ? 'active' : ''}`}
                data-focusable
                onClick={() => setGroupByCountry((g) => !g)}
              >
                {groupByCountry ? t('groupByCountry') : t('flatList')}
              </button>
              <button
                className={`btn btn-ghost ${settings.verifiedOnly ? 'active' : ''}`}
                data-focusable
                onClick={() =>
                  setSettings({
                    ...settings,
                    verifiedOnly: !settings.verifiedOnly,
                  })
                }
              >
                <Icon name="check" size={14} />{' '}
                {settings.verifiedOnly ? 'Verified Only (ON)' : 'Verified Only (OFF)'}
              </button>
              <span className="muted">
                {globalItems.length} / {globalTotal} {t('channels')}
              </span>
            </div>

            {groupByCountry ? (
              <div>
                {(boot?.countries ?? [])
                  .filter(
                    (c) =>
                      (countryFilter === 'all' || c.code === countryFilter) &&
                      globalItems.some((ch) => ch.country === c.code),
                  )
                  .map((c) => {
                    const list = globalItems.filter((ch) => ch.country === c.code)
                    if (!list.length) return null
                    return (
                      <div className="country-group" key={c.code}>
                        <h3 className="country-group-title">
                          {c.flagImg ? (
                            <img src={c.flagImg} alt="" className="group-flag" />
                          ) : (
                            <span>{c.flag}</span>
                          )}{' '}
                          {c.name}{' '}
                          <span className="muted">({list.length})</span>
                        </h3>
                        <div className="grid grid-channels">
                          {list.map((ch) => (
                            <ChannelCard
                              key={ch.id}
                              channel={ch}
                              country={c}
                              onPlay={play}
                              onFavourite={toggleFavourite}
                              onPrefetch={prefetchChannelNow}
                      status={statusOf(statuses, ch.id)}
                              favourite={favourites.includes(ch.id)}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
              </div>
            ) : settings.channelPanelLayout === 'cable' ? (
              <div className="cable-epg-list">
                {globalItems.map((ch, idx) => {
                  const isOnline = statusOf(statuses, ch.id) === 'online'
                  return (
                    <div
                      key={ch.id}
                      className="cable-epg-row"
                      data-focusable
                      onClick={() => play(ch)}
                    >
                      <span className="cable-number">{(idx + 1).toString().padStart(3, '0')}</span>
                      <div className="cable-logo-box">
                        <ChannelLogo channel={ch} size="sm" className="cable-logo-img" />
                      </div>
                      <div className="cable-info">
                        <h4 className="cable-name">{ch.name}</h4>
                        <span className="cable-meta">
                          {countryByCode.get(ch.country)?.name || ch.country}
                          {ch.categories?.length ? ` • ${ch.categories.slice(0, 2).join(', ')}` : ''}
                        </span>
                      </div>
                      <span className={`cable-badge ${isOnline ? 'online' : ''}`}>
                        {isOnline ? 'ONLINE' : 'LIVE'}
                      </span>
                      <div className="cable-action">
                        <Icon name="play" size={18} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-channels">
                {globalItems.map((ch) => (
                  <ChannelCard
                    key={ch.id}
                    channel={ch}
                    country={countryByCode.get(ch.country)}
                    onPlay={play}
                    onFavourite={toggleFavourite}
                    onPrefetch={prefetchChannelNow}
                      status={statusOf(statuses, ch.id)}
                    favourite={favourites.includes(ch.id)}
                  />
                ))}
              </div>
            )}

            <div ref={loaderRef} className="loader-anchor">
              {globalLoading ? (
                <div className="empty">
                  <div className="spinner" aria-hidden="true" /> ...
                </div>
              ) : globalItems.length >= globalTotal ? (
                <div className="empty muted">{t('endOfList')}</div>
              ) : (
                <button
                  className="btn btn-primary load-more"
                  data-focusable
                  onClick={() => void loadGlobal(false)}
                >
                  {t('loadMore')} ({globalItems.length}/{globalTotal})
                </button>
              )}
              </div>
            </section>

            <section className="row filter-bar-row">
              <h2 className="row-title"><Icon name="filter" size={22} /> Quick Filters</h2>
              <div className="row-track">
                {['all', 'kids', 'sports', 'news', 'entertainment', 'music', 'religious', 'documentary', 'comedy', 'animation'].map((cat) => (
                  <button
                    key={cat}
                    className={`btn ${categoryFilter === cat ? 'btn-primary' : 'btn-ghost'}`}
                    data-focusable
                    onClick={() => {
                      setCategoryFilter(cat)
                      if (cat !== 'all') {
                        setView({ name: 'category', id: cat })
                      } else {
                        setView({ name: 'home' })
                      }
                    }}
                  >
                    {categoryName(settings.lang, cat).toUpperCase()}
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {view.name === 'country' || view.name === 'category' ? (
          <section className="row">
            <h2 className="row-title">
              {view.name === 'country'
                ? `${activeCountry?.flag ?? ''} ${activeCountry?.name ?? view.code}`
                : `${categoryName(settings.lang, (view as any).id)}`}{' '}
              <span className="muted">({visibleChannels.length})</span>
            </h2>

            {countryCategories.length > 1 ? (
              <div className="chips">
                {countryCategories.map((c) => {
                  const count = c === 'all' ? channels.length : countryCategoryCounts.get(c) || 0
                  return (
                    <button
                      key={c}
                      className={`chip ${categoryFilter === c ? 'active' : ''}`}
                      data-focusable
                      onClick={() => setCategoryFilter(c)}
                    >
                      {c === 'all' ? t('all') : categoryName(settings.lang, c)}{' '}
                      <span className="chip-count" style={{ opacity: 0.75, fontSize: '0.85em', marginLeft: 4 }}>
                        ({count})
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}

            {loading ? (
              <div className="empty">
                <div className="spinner" aria-hidden="true" /> ...
              </div>
            ) : visibleChannels.length === 0 ? (
              <div className="empty">{t('noResults')}</div>
            ) : settings.channelPanelLayout === 'cable' ? (
              <div className="cable-epg-list">
                {visibleChannels.slice(0, shownCount).map((ch, idx) => {
                  const isOnline = statusOf(statuses, ch.id) === 'online'
                  return (
                    <div
                      key={ch.id}
                      className="cable-epg-row"
                      data-focusable
                      onClick={() => play(ch)}
                    >
                      <span className="cable-number">{(idx + 1).toString().padStart(3, '0')}</span>
                      <div className="cable-logo-box">
                        <ChannelLogo channel={ch} size="sm" className="cable-logo-img" />
                      </div>
                      <div className="cable-info">
                        <h4 className="cable-name">{ch.name}</h4>
                        <span className="cable-meta">
                          {countryByCode.get(ch.country)?.name || ch.country}
                          {ch.categories?.length ? ` • ${ch.categories.slice(0, 2).join(', ')}` : ''}
                        </span>
                      </div>
                      <span className={`cable-badge ${isOnline ? 'online' : ''}`}>
                        {isOnline ? 'ONLINE' : 'LIVE'}
                      </span>
                      <div className="cable-action">
                        <Icon name="play" size={18} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-channels">
                {visibleChannels.slice(0, shownCount).map((ch) => (
                  <ChannelCard
                    key={ch.id}
                    channel={ch}
                    country={countryByCode.get(ch.country)}
                    onPlay={play}
                    onFavourite={toggleFavourite}
                    onPrefetch={prefetchChannelNow}
                    status={statusOf(statuses, ch.id)}
                    favourite={favourites.includes(ch.id)}
                  />
                ))}
              </div>
            )}
            {visibleChannels.length > shownCount ? (
              <div className="loader-anchor">
                <button
                  className="btn btn-primary load-more"
                  data-focusable
                  onClick={() => setShownCount((n) => n + 240)}
                >
                  {t('loadMore')} ({shownCount}/{visibleChannels.length})
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {view.name === 'browser' ? (
          <ChromiumBrowser
            initialUrl={(view as any).initialUrl}
            initialEngine={(view as any).initialEngine}
            onClose={() => setView({ name: 'home' })}
            onInstallApp={handleInstallApp}
            onPlayMovie={handlePlayDownloadedMovie}
            onNavigateToDownloads={() => setView({ name: 'downloads' })}
          />
        ) : null}

        {view.name === 'apps' ? (
          <section className="row apps-section">
            <div className="home-filter-head" style={{ marginBottom: '20px' }}>
              <h2 className="row-title">
                <Icon name="apps" size={24} /> {t('apps')}
                <span className="muted">({installedApps.length} Web Apps Installed)</span>
              </h2>
            </div>

            <div className="apps-grid">
              <div
                className="app-card featured-app-card"
                data-focusable
                onClick={() => setView({ name: 'browser' })}
              >
                <div className="app-card-badge">
                  <Icon name="compass" size={36} />
                </div>
                <div className="app-card-body">
                  <div className="app-badge-tag">Featured App</div>
                  <h3 className="app-card-title">{t('chromiumBrowser')}</h3>
                  <p className="app-card-desc">{t('chromiumDesc')}</p>
                  <div className="app-card-pills">
                    <span className="pill">5 Search Engines</span>
                    <span className="pill">Dual-Lane Proxy</span>
                    <span className="pill">TV Zoom</span>
                    <span className="pill">Web App Installer</span>
                  </div>
                </div>
                <button
                  className="btn btn-primary app-card-launch"
                  data-focusable
                  onClick={(e) => {
                    e.stopPropagation()
                    setView({ name: 'browser' })
                  }}
                >
                  <Icon name="play" size={16} /> {t('openBrowser')}
                </button>
              </div>

              {installedApps.map((app) => (
                <div
                  key={app.id}
                  className="app-card installed-app-card"
                  data-focusable
                  onClick={() => setView({ name: 'browser', initialUrl: app.url })}
                >
                  <button
                    className="app-del-btn"
                    title="Uninstall Web App"
                    onClick={(e) => handleUninstallApp(app.id, e)}
                  >
                    ✕
                  </button>
                  <div
                    className="app-card-badge"
                    style={{ background: `linear-gradient(135deg, ${app.color || '#38bdf8'}, #0f172a)` }}
                  >
                    <AppBadgeLogo app={app} size={32} />
                  </div>
                  <div className="app-card-body">
                    <div className="app-badge-tag">{app.category || 'Web App'}</div>
                    <h3 className="app-card-title">{app.title}</h3>
                    <p className="app-card-desc" style={{ fontSize: 12, opacity: 0.7 }}>
                      {app.url}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost app-card-launch"
                    data-focusable
                    onClick={(e) => {
                      e.stopPropagation()
                      setView({ name: 'browser', initialUrl: app.url })
                    }}
                  >
                    Launch
                  </button>
                </div>
              ))}

              <div
                className="app-card app-card-add"
                data-focusable
                onClick={() => setView({ name: 'browser' })}
              >
                <div className="app-card-badge" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <Icon name="compass" size={28} />
                </div>
                <div className="app-card-body">
                  <h3 className="app-card-title">+ Install Web Apps</h3>
                  <p className="app-card-desc">
                    Open Chromium Browser, browse to any streaming portal or web service, and click "Install as App" to pin it directly here.
                  </p>
                </div>
                <button
                  className="btn btn-ghost app-card-launch"
                  data-focusable
                  onClick={(e) => {
                    e.stopPropagation()
                    setView({ name: 'browser' })
                  }}
                >
                  Open Browser
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {view.name === 'downloads' ? (
          <section className="row downloads-view">
            <div className="downloads-view-hero">
              <div className="downloads-hero-text">
                <h2><Icon name="download" size={26} /> {t('downloads')} & Media Hub</h2>
                <p className="muted">Movies, video streams, and Android TV APK applications downloaded via Chromium Browser</p>
              </div>
              <button
                className="btn btn-primary"
                data-focusable
                onClick={() => setView({ name: 'browser' })}
              >
                <Icon name="compass" size={16} /> Open Chromium Browser
              </button>
            </div>

            <div className="downloads-url-bar" style={{ marginBottom: 20 }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const input = (e.currentTarget.elements.namedItem('dlUrl') as HTMLInputElement)
                  if (input && input.value) {
                    void handleStartDownload(input.value)
                    input.value = ''
                  }
                }}
                style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 700 }}
              >
                <input
                  name="dlUrl"
                  placeholder="Paste direct movie stream URL (.mp4/.mkv) or TV APK link here..."
                  className="input-text"
                  style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
                <button type="submit" className="btn btn-primary" data-focusable>
                  <Icon name="download" size={16} /> Download
                </button>
              </form>
            </div>

            {downloads.length === 0 ? (
              <div className="empty" style={{ marginTop: 40 }}>
                <Icon name="download" size={36} />
                <h3>No Downloads Yet</h3>
                <p className="muted" style={{ maxWidth: 520, margin: '8px auto 16px auto' }}>
                  Browse to movie streaming sites, direct media links, or Android TV APK portals inside Chromium Browser.
                  Downloads will automatically appear here with 1-click movie playback and TV app installer!
                </p>
                <button
                  className="btn btn-primary"
                  data-focusable
                  onClick={() => setView({ name: 'browser' })}
                >
                  <Icon name="compass" size={16} /> Open Chromium Browser
                </button>
              </div>
            ) : (
              <div className="downloads-grid" style={{ marginTop: 20 }}>
                {downloads.map((d) => {
                  const isVideo = /\.(mp4|mkv|webm|avi|mov|ts)$/i.test(d.fileName)
                  const isApk = /\.apk$/i.test(d.fileName)
                  return (
                    <div key={d.id} className="download-item-card" data-focusable>
                      <div
                        className="dl-item-icon"
                        style={{
                          background: isVideo ? '#10b981' : isApk ? '#0ea5e9' : '#64748b',
                        }}
                      >
                        <Icon name={isVideo ? 'play' : isApk ? 'apps' : 'download'} size={24} />
                      </div>
                      <div className="dl-item-info">
                        <div className="dl-item-title" title={d.fileName}>{d.fileName}</div>
                        <div className="dl-item-meta">
                          <span>{d.sizeBytes ? `${(d.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : 'Calculating size...'}</span>
                          {d.speed ? <span>• {d.speed}</span> : null}
                          <span style={{ color: d.status === 'completed' ? '#10b981' : d.status === 'downloading' ? '#38bdf8' : '#ef4444' }}>
                            • {d.status === 'completed' ? '✓ Ready' : d.status === 'downloading' ? `${d.progress}% Downloading` : d.status}
                          </span>
                        </div>
                        {d.status === 'downloading' ? (
                          <div className="dl-progress-bar">
                            <div className="dl-progress-fill" style={{ width: `${d.progress}%` }} />
                          </div>
                        ) : null}
                      </div>
                      <div className="dl-item-actions">
                        {isVideo && d.status === 'completed' ? (
                          <button
                            className="btn btn-action-play"
                            data-focusable
                            onClick={() => handlePlayDownloadedMovie(d.url, d.fileName)}
                          >
                            <Icon name="play" size={14} /> Play Movie
                          </button>
                        ) : null}
                        {isApk && d.status === 'completed' ? (
                          <button
                            className="btn btn-action-install"
                            data-focusable
                            onClick={() => nativeInstallApk(d.url)}
                          >
                            <Icon name="check" size={14} /> Install APK
                          </button>
                        ) : null}
                        <button
                          className="btn btn-action-del"
                          data-focusable
                          title="Delete file"
                          onClick={(e) => handleDeleteDownload(d.id, e)}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}
      </main>

      <div className="sr-only" aria-live="polite" role="status">
        {liveRegion}
      </div>

      {overlay === 'search' ? (
        <SearchOverlay
          t={t}
          lang={settings.lang}
          onClose={() => setOverlay('none')}
          onPlay={(ch) => {
            setOverlay('none')
            play(ch)
          }}
        />
      ) : null}

      {overlay === 'number' ? (
        <div className="overlay number-overlay">
          <div className="overlay-head">
            <h2><Icon name="hash" size={17} /> {t('channelNumber')}</h2>
            <div className="number-display" aria-live="polite">
              {numberEntry || '-'}
            </div>
            <button className="btn btn-ghost" data-focusable onClick={() => {
              setNumberEntry('')
              setOverlay('none')
            }}>
              <Icon name="close" size={16} /> {t('close')}
            </button>
          </div>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
              <button
                key={d}
                className="kb-key"
                data-focusable
                onClick={() => setNumberEntry((n) => (n + d).slice(-4))}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="number-actions">
            <button className="btn btn-primary" data-focusable autoFocus onClick={openChannelNumber}>
              <Icon name="play" size={16} /> {t('open')}
            </button>
            <button
              className="btn btn-ghost"
              data-focusable
              onClick={() => setNumberEntry((n) => n.slice(0, -1))}
            >
              <Icon name="chevron-left" size={18} />
            </button>
          </div>
          <p className="muted settings-hint">{t('numberHint')}</p>
        </div>
      ) : null}

      {overlay === 'settings' ? (
        <SettingsOverlay
          t={t}
          settings={settings}
          setSettings={setSettings}
          mode={isNative ? 'Android TV app' : currentMode()}
          version={APP_VERSION}
          totals={boot?.totals}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setOverlay('none')}
          onOpenPlaylists={() => setOverlay('playlists')}
        />
      ) : null}

      {overlay === 'playlists' ? (
        <PlaylistsModal
          activePlaylistId={activePlaylistId}
          playlists={playlists}
          onSelectPlaylist={(pl) => {
            setActivePlaylistId(pl ? pl.id : 'default')
            setOverlay('none')
          }}
          onSavePlaylist={(newPl) => {
            setPlaylists((prev) => [...prev.filter((p) => p.id !== newPl.id), newPl])
          }}
          onDeletePlaylist={(id) => {
            setPlaylists((prev) => prev.filter((p) => p.id !== id))
            if (activePlaylistId === id) {
              setActivePlaylistId('default')
            }
          }}
          onClose={() => setOverlay('none')}
          t={t}
        />
      ) : null}

      {selectedSeries ? (
        <div className="episodes-modal-backdrop" onClick={() => setSelectedSeries(null)}>
          <div className="episodes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="episodes-modal-header">
              <div className="episodes-modal-title">
                <Icon name="grid" size={22} /> {selectedSeries.title} ({selectedSeries.episodes.length} Episodes)
              </div>
              <button
                className="episodes-modal-close"
                data-focusable
                onClick={() => setSelectedSeries(null)}
                aria-label="Close"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="episodes-list">
              {selectedSeries.episodes.map((ep) => (
                <button
                  key={ep.id}
                  className="episode-item"
                  data-focusable
                  onClick={() => playEpisode(selectedSeries, ep)}
                >
                  <div className="episode-item-info">
                    <span className="episode-badge">S{ep.season} E{ep.episode}</span>
                    <span className="episode-title">{ep.title}</span>
                  </div>
                  <Icon name="play" size={18} />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {playing ? (
        <PlayerOverlay
          channel={playing}
          country={countryByCode.get(playing.country)}
          channels={currentChannelList()}
          t={t}
          audioDescription={settings.a11y.audioDescription}
          filterSummary={filterSummary}
          statuses={statuses}
          networkQuality={network.quality}
          networkMaxLevel={network.maxLevel ?? 0}
          networkKbps={network.kbps ?? 0}
          drawer={drawerOpen}
          onDrawer={setDrawerOpen}
          onExit={closePlayer}
          onSwitch={(ch) => play(ch)}
          onCycleStream={() => undefined}
          onQueue={addToQueue}
          autoSkipOffline={settings.autoSkipOffline ?? false}
          assignedPlayerId={settings.channelsPlayer || settings.defaultPlayer || 'internal'}
          assignedPlayerName={
            TOP_STREAMING_PLAYERS.find(
              (p) => p.id === (settings.channelsPlayer || settings.defaultPlayer || 'internal'),
            )?.name
          }
          assignedPlayerBadge={
            TOP_STREAMING_PLAYERS.find(
              (p) => p.id === (settings.channelsPlayer || settings.defaultPlayer || 'internal'),
            )?.badge
          }
          onSelectPlayer={(playerId) => {
            const updated: Settings = {
              ...settings,
              channelsPlayer: playerId,
              defaultPlayer: playerId,
              moviesPlayer: playerId,
              seriesPlayer: playerId,
              downloadsPlayer: playerId,
            }
            setSettings(updated)
            try {
              localStorage.setItem('vyora.settings', JSON.stringify(updated))
            } catch {}
          }}
        />
      ) : null}
    </div>
  )
}

function qualityScore(label?: string) {
  const n = parseInt(String(label || ''), 10)
  if (Number.isFinite(n)) return n
  if (String(label).includes('4K')) return 2160
  if (String(label).includes('2K')) return 1440
  return 0
}

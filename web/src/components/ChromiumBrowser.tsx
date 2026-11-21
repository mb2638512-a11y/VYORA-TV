import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Icon } from './Icon'
import { nativeInstallApk } from '../lib/bridge'
import { fetchDownloads, startDownload, deleteDownload, logoUrl, apiOrigin, API } from '../lib/api'
import type { BrowserEngineId, DownloadItem, InstalledApp } from '../types'

export type ChromiumBrowserProps = {
  initialUrl?: string
  initialEngine?: BrowserEngineId
  onClose: () => void
  onInstallApp?: (app: InstalledApp) => void
  onPlayMovie?: (url: string, title: string) => void
  onNavigateToDownloads?: () => void
}

export type EngineConfig = {
  id: BrowserEngineId
  name: string
  short: string
  tagline: string
  searchUrl: (q: string) => string
  homeUrl: string
  color: string
  /** Real brand icon, served through the cached /logo proxy. */
  favicon: string
}

// Search results are never scraped or silently substituted. Google is
// rendered directly with its official iframe flag; other providers use the
// Go web proxy for result documents so frame-busting headers can be removed
// and result clicks can be routed back through the browser.
export const BROWSER_ENGINES: Record<BrowserEngineId, EngineConfig> = {
  google: {
    id: 'google',
    name: 'Google',
    short: 'Google',
    tagline: 'Google Search',
    searchUrl: (q) => `https://www.google.com/search?igu=1&q=${encodeURIComponent(q)}`,
    homeUrl: 'https://www.google.com/webhp?igu=1',
    color: '#4285F4',
    favicon: 'https://www.google.com/favicon.ico',
  },
  bing: {
    id: 'bing',
    name: 'Microsoft Bing',
    short: 'Bing',
    tagline: 'Microsoft Search',
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    homeUrl: 'https://www.bing.com/',
    color: '#008373',
    favicon: 'https://www.bing.com/sa/simg/favicon-2x.ico',
  },
  duckduckgo: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    short: 'DuckDuckGo',
    tagline: 'Private Search',
    searchUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    homeUrl: 'https://duckduckgo.com/',
    color: '#DE5833',
    favicon: 'https://duckduckgo.com/favicon.ico',
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo Search',
    short: 'Yahoo',
    tagline: 'Search the Web',
    searchUrl: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
    homeUrl: 'https://search.yahoo.com/',
    color: '#6001D2',
    favicon: 'https://s.yimg.com/rz/l/favicon.ico',
  },
  brave: {
    id: 'brave',
    name: 'Brave Search',
    short: 'Brave',
    tagline: 'Independent Search',
    searchUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    homeUrl: 'https://search.brave.com/',
    color: '#FB542B',
    favicon: 'https://search.brave.com/favicon.ico',
  },
}

export const BROWSER_ENGINES_LIST: EngineConfig[] = Object.values(BROWSER_ENGINES)

export type HistoryItem = {
  id: string
  url: string
  title: string
  visitedAt: number
  engine: BrowserEngineId
}

export type Tab = {
  id: string
  title: string
  url: string
  displayUrl: string
  frameUrl?: string
  engine: BrowserEngineId
  proxyMode: boolean
  zoom: number // 1 = 100%
  history: string[]
  historyIndex: number
  isLoading: boolean
  navKey: number
}

type Bookmark = {
  id: string
  title: string
  url: string
  color: string
}

export type PortalItem = {
  id: string
  title: string
  url: string
  category: 'streaming' | 'sports' | 'news' | 'tools' | 'gaming'
  color: string
  badge?: string
}

export const SPEED_DIAL_PORTALS: PortalItem[] = [
  // 🎬 Streaming & Movies
  { id: 'p-yt', title: 'YouTube Trending & Videos', url: 'https://www.youtube.com/feed/trending', category: 'streaming', color: '#FF0000', badge: 'HD Video' },
  { id: 'p-invidious', title: 'YouTube Free (Invidious)', url: 'https://yewtu.be', category: 'streaming', color: '#E50914', badge: 'No Ads' },
  { id: 'p-twitch', title: 'Twitch TV', url: 'https://www.twitch.tv', category: 'streaming', color: '#9146FF', badge: 'Live' },
  { id: 'p-archive', title: 'Internet Archive Movies', url: 'https://archive.org/details/movies', category: 'streaming', color: '#333333', badge: 'Free Movies' },
  { id: 'p-dm', title: 'Dailymotion', url: 'https://www.dailymotion.com', category: 'streaming', color: '#0066DC', badge: 'Clips' },
  { id: 'p-vimeo', title: 'Vimeo Watch', url: 'https://vimeo.com/watch', category: 'streaming', color: '#1AB7EA' },

  // ⚽ Live Sports & Scores
  { id: 'p-cric', title: 'Cricbuzz Live Cricket', url: 'https://m.cricbuzz.com', category: 'sports', color: '#009270', badge: 'Live Cricket' },
  { id: 'p-espn', title: 'ESPN Global', url: 'https://www.espn.com', category: 'sports', color: '#CC0000', badge: 'Scores' },
  { id: 'p-flash', title: 'Flashscore', url: 'https://www.flashscore.com', category: 'sports', color: '#001E28' },
  { id: 'p-bbcsport', title: 'BBC Sport', url: 'https://www.bbc.com/sport', category: 'sports', color: '#FFD230' },

  // 📰 Global & Regional News
  { id: 'p-bbc', title: 'BBC World News', url: 'https://www.bbc.com/news', category: 'news', color: '#BB1919', badge: 'World' },
  { id: 'p-alj', title: 'Al Jazeera Live', url: 'https://www.aljazeera.com', category: 'news', color: '#E86C00', badge: 'Live TV' },
  { id: 'p-reuters', title: 'Reuters Breaking', url: 'https://www.reuters.com', category: 'news', color: '#FF8000' },
  { id: 'p-cnn', title: 'CNN International', url: 'https://edition.cnn.com', category: 'news', color: '#CC0000' },

  // 🛠️ TV Tools & Web Utilities
  { id: 'p-fast', title: 'Fast.com Bandwidth Test', url: 'https://fast.com', category: 'tools', color: '#00D166', badge: 'Speed' },
  { id: 'p-wiki', title: 'Wikipedia TV', url: 'https://en.m.wikipedia.org', category: 'tools', color: '#636466', badge: 'Wiki' },
  { id: 'p-weather', title: 'AccuWeather Radar', url: 'https://weather.com', category: 'tools', color: '#2B70C9', badge: 'Radar' },
  { id: 'p-translate', title: 'Google Translate', url: 'https://translate.google.com', category: 'tools', color: '#4285F4' },

  // 🎮 Cloud & Web Gaming
  { id: 'p-poki', title: 'Poki TV Games', url: 'https://poki.com', category: 'gaming', color: '#00D664', badge: 'Free Games' },
  { id: 'p-crazy', title: 'CrazyGames Online', url: 'https://www.crazygames.com', category: 'gaming', color: '#6C5CE7' },
]

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { id: 'google', title: 'Google', url: 'https://www.google.com/webhp?igu=1', color: '#4285F4' },
  { id: 'youtube', title: 'YouTube TV', url: 'https://www.youtube.com/feed/trending', color: '#FF0000' },
  { id: 'wikipedia', title: 'Wikipedia', url: 'https://en.m.wikipedia.org', color: '#636466' },
  { id: 'fast', title: 'Fast.com Speed Test', url: 'https://fast.com', color: '#00D166' },
  { id: 'cricbuzz', title: 'Cricbuzz Cricket', url: 'https://m.cricbuzz.com', color: '#009270' },
  { id: 'bbc', title: 'BBC News', url: 'https://www.bbc.com/news', color: '#BB1919' },
  { id: 'weather', title: 'Weather Radar', url: 'https://weather.com', color: '#2B70C9' },
  { id: 'github', title: 'GitHub', url: 'https://github.com', color: '#24292e' },
  { id: 'twitch', title: 'Twitch TV', url: 'https://www.twitch.tv', color: '#9146FF' },
]

/** Signature of the non-standard window.find() API used for find-in-page. */
type FindFn = (
  string: string,
  caseSensitive?: boolean,
  backwards?: boolean,
  wrapAround?: boolean,
  wholeWord?: boolean,
  searchInFrames?: boolean,
  showDialog?: boolean,
) => boolean

const HISTORY_STORAGE_KEY = 'vyora_browser_history_v1'
const BOOKMARKS_STORAGE_KEY = 'vyora_browser_bookmarks_v1'
const SESSION_STORAGE_KEY = 'vyora_browser_session_v1'
const SETTINGS_STORAGE_KEY = 'vyora_browser_settings_v1'
export const INSTALLED_APPS_KEY = 'vyora_installed_apps_v1'

export type BrowserSettings = {
  /** Search engine used for new tabs. */
  defaultEngine: BrowserEngineId
  /** Custom homepage (empty = Speed Dial). */
  homepage: string
  /** Block images and media (tracking protection). */
  blockImages: boolean
  /** Private browsing: do not write history/bookmarks. */
  privateMode: boolean
  /** Ask before loading a page that sends a download. */
  askBeforeDownload: boolean
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  defaultEngine: 'google',
  homepage: '',
  blockImages: false,
  privateMode: false,
  askBeforeDownload: true,
}

function getInitialBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    // ignore
  }
  return DEFAULT_BOOKMARKS
}

function getInitialSettings(): BrowserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) return { ...DEFAULT_BROWSER_SETTINGS, ...JSON.parse(raw) }
  } catch (e) {
    // ignore
  }
  return DEFAULT_BROWSER_SETTINGS
}

/**
 * Converts any YouTube video link into its embeddable form.
 *
 * The regular watch page answers "X-Frame-Options: SAMEORIGIN" and the plain
 * www.youtube.com/embed player refuses to initialise in a foreign frame
 * ("Error 152 - 4"), so the privacy host is used: it plays the same video
 * normally. Returns '' when the URL is not a single video (a channel, a search
 * or the home page) - those are served as the real page.
 */
export function toYouTubeEmbedUrl(rawUrl: string): string {
  if (!rawUrl) return ''
  const m = rawUrl.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
  )
  if (!m || !m[1]) return ''
  return `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0&playsinline=1`
}

/**
 * Unpacks a search-engine redirect wrapper into the real destination.
 *
 * Google result links are /url?q=<target>, Bing uses /ck/a?...&u=a1<base64>,
 * DuckDuckGo uses /l/?uddg=<target> and Yahoo uses /RU=<target>. Without this
 * the browser would navigate to the redirect endpoint and the user would land
 * on a search page instead of the site.
 */
export function unpackRedirectUrl(input: string): string {
  if (!input) return input
  let trimmed = input.trim()
  try {
    let fixed = trimmed.replace(/&amp;/g, '&')
    if (fixed.startsWith('//')) fixed = 'https:' + fixed

    // 1. DuckDuckGo: duckduckgo.com/l/?uddg=<dest>
    if (fixed.includes('/l/?') && fixed.includes('uddg=')) {
      const u = new URL(fixed, 'https://duckduckgo.com')
      const dest = u.searchParams.get('uddg')
      if (dest) return unpackRedirectUrl(dest)
    }
    // 2. Google: /url?q=<dest> or /url?url=<dest>
    if (fixed.includes('/url?') && (fixed.includes('q=') || fixed.includes('url='))) {
      const u = new URL(fixed.startsWith('http') ? fixed : `https://${fixed.replace(/^\/+/, '')}`)
      const dest = u.searchParams.get('q') || u.searchParams.get('url')
      if (dest) return unpackRedirectUrl(dest)
    }
    // 3. Bing: bing.com/ck/a?...&u=a1<base64>
    if (fixed.includes('/ck/a') && fixed.includes('u=')) {
      const u = new URL(fixed, 'https://www.bing.com')
      const uParam = u.searchParams.get('u')
      if (uParam && uParam.startsWith('a1')) {
        let b64 = uParam.slice(2).replace(/-/g, '+').replace(/_/g, '/')
        while (b64.length % 4 !== 0) b64 += '='
        try {
          const decoded = atob(b64)
          if (decoded) {
            if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
              return unpackRedirectUrl(decoded)
            }
            if (decoded.startsWith('/')) {
              return unpackRedirectUrl('https://www.bing.com' + decoded)
            }
          }
        } catch {}
      }
    }
    // 4. Yahoo: /RU=<encoded>/...
    if (fixed.includes('/RU=')) {
      const m = fixed.match(/\/RU=([^/]+)/)
      if (m && m[1]) {
        const decoded = decodeURIComponent(m[1])
        if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
          return unpackRedirectUrl(decoded)
        }
      }
    }
  } catch {}
  return trimmed
}

export function normalizeUrlOrQuery(input: string, engineId: BrowserEngineId): string {
  let trimmed = unpackRedirectUrl(input.trim())
  if (!trimmed) return ''

  if (trimmed.startsWith('//')) {
    trimmed = 'https:' + trimmed
  }

  // 1. A YouTube video link is opened in its embeddable form (the only form
  //    YouTube allows inside the frame). Plain queries are NEVER hijacked: a
  //    search for "youtube" must run through Google like Chrome.
  //    The nocookie host is required: www.youtube.com/embed answers
  //    "This video is unavailable / Error code: 152 - 4" inside a foreign frame,
  //    while www.youtube-nocookie.com/embed plays the same video normally.
  const ytEmbed = toYouTubeEmbedUrl(trimmed)
  if (ytEmbed) {
    const origin = apiOrigin()
    return origin ? `${ytEmbed}&origin=${encodeURIComponent(origin)}` : ytEmbed
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  // Check if domain
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  // Search query using the selected engine
  const engine = BROWSER_ENGINES[engineId] || BROWSER_ENGINES.google
  return engine.searchUrl(trimmed)
}

export function getDomainTitle(url: string): string {
  try {
    const raw = url.startsWith('http') ? url : `https://${url}`
    const u = new URL(raw)
    return u.hostname.replace(/^www\./i, '')
  } catch (e) {
    return url.slice(0, 24)
  }
}

/**
 * Readable name for an installed web app: the real page title when the page
 * already reported one, otherwise the domain turned into a name
 * ("www.youtube.com" -> "YouTube"). Never an empty string.
 */
export function prettySiteName(url: string, title?: string): string {
  const domain = getDomainTitle(url)
  const clean = (title || '').trim().replace(/\s+/g, ' ')
  if (clean && clean.toLowerCase() !== domain.toLowerCase() && clean.length > 1) {
    return clean.length > 42 ? `${clean.slice(0, 42).trim()}…` : clean
  }
  const base = domain.split('.')[0]
  if (!base) return domain
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** Build the favicon URL of a page, routed through the cached /logo proxy. */
export function faviconFor(pageUrl: string): string {
  if (!pageUrl) return ''
  try {
    const raw = pageUrl.startsWith('http') ? pageUrl : `https://${pageUrl}`
    const u = new URL(raw)
    if (!u.hostname) return ''
    return logoUrl(`https://${u.hostname}/favicon.ico`)
  } catch (e) {
    return ''
  }
}

/**
 * Shows the real site/engine logo and degrades to a brand-coloured monogram
 * when the icon cannot be loaded, so a tile is never left blank.
 */
export function BrandLogo({
  iconUrl,
  color,
  label,
  size = 28,
  rounded = 8,
}: {
  iconUrl: string
  color: string
  label: string
  size?: number
  rounded?: number
}) {
  const [failed, setFailed] = useState(false)
  const mono = (label || '?').trim().charAt(0).toUpperCase() || '?'

  if (!iconUrl || failed) {
    return (
      <span
        className="brand-mono"
        style={{ backgroundColor: color, width: size, height: size, borderRadius: rounded, fontSize: Math.round(size * 0.48) }}
        aria-hidden="true"
      >
        {mono}
      </span>
    )
  }

  return (
    <img
      className="brand-logo"
      src={iconUrl}
      alt={label}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: rounded }}
      onError={() => setFailed(true)}
      loading="lazy"
      draggable={false}
    />
  )
}

export default function ChromiumBrowser({
  initialUrl,
  initialEngine = 'google',
  onClose,
  onInstallApp,
  onPlayMovie,
  onNavigateToDownloads,
}: ChromiumBrowserProps) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const startUrl = initialUrl?.trim() || ''
    return [
      {
        id: 'tab-1',
        title: startUrl ? getDomainTitle(startUrl) : 'New Tab',
        url: startUrl,
        displayUrl: startUrl,
        frameUrl: startUrl,
        engine: initialEngine,
        proxyMode: false,
        zoom: 1.0,
        history: startUrl ? [startUrl] : [],
        historyIndex: startUrl ? 0 : -1,
        isLoading: false,
        navKey: 0,
      },
    ]
  })

  const [activeTabId, setActiveTabId] = useState<string>('tab-1')
  const [inputUrl, setInputUrl] = useState<string>(initialUrl?.trim() || '')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [engineMenuOpen, setEngineMenuOpen] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(true)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(getInitialBookmarks)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [settings, setSettings] = useState<BrowserSettings>(getInitialSettings)

  // Dialogs
  const [isAddBookmarkOpen, setIsAddBookmarkOpen] = useState(false)
  const [newBookmarkTitle, setNewBookmarkTitle] = useState('')
  const [newBookmarkUrl, setNewBookmarkUrl] = useState('')

  const [isAddAppOpen, setIsAddAppOpen] = useState(false)
  const [newAppTitle, setNewAppTitle] = useState('')
  const [newAppUrl, setNewAppUrl] = useState('')

  const [isDownloadsOpen, setIsDownloadsOpen] = useState(false)
  const [downloadItems, setDownloadItems] = useState<DownloadItem[]>([])
  const [manualDownloadUrl, setManualDownloadUrl] = useState('')
  const [manualDownloadName, setManualDownloadName] = useState('')
  const [downloadType, setDownloadType] = useState<'apk' | 'movie' | 'file'>('file')

  const [speedDialSearch, setSpeedDialSearch] = useState('')

  // Find in page
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findMatches, setFindMatches] = useState(0)

  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestIndex, setSuggestIndex] = useState(-1)

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // History
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return []
  })

  // Feature Toggles (Dark Web, AdShield, Desktop Mode)
  const [darkModeWeb, setDarkModeWeb] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vyora_browser_dark_web') === 'true'
    } catch {}
    return false
  })

  const [adShield, setAdShield] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vyora_browser_ad_shield') !== 'false'
    } catch {}
    return true
  })

  const [desktopMode, setDesktopMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vyora_browser_desktop_mode') === 'true'
    } catch {}
    return false
  })

  const [portalCategory, setPortalCategory] = useState<'all' | 'streaming' | 'sports' | 'news' | 'tools' | 'gaming'>('all')

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const findTimer = useRef<number | null>(null)
  const suggestTimer = useRef<number | null>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]
  const currentEngine = BROWSER_ENGINES[activeTab?.engine || 'google'] || BROWSER_ENGINES.google

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  const saveSettings = useCallback((next: BrowserSettings) => {
    setSettings(next)
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }, [])

  const recordHistory = useCallback(
    (url: string, title: string, engine: BrowserEngineId) => {
      if (!url || url === 'about:blank') return
      if (settings.privateMode) return
      setHistoryItems((prev) => {
        const item: HistoryItem = {
          id: `hist-${Date.now()}`,
          url,
          title: title || getDomainTitle(url),
          visitedAt: Date.now(),
          engine,
        }
        const updated = [item, ...prev.filter((h) => h.url !== url)].slice(0, 80)
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated))
        } catch {}
        return updated
      })
    },
    [settings.privateMode],
  )

  const clearAllHistory = () => {
    setHistoryItems([])
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY)
    } catch {}
    showToast('✓ Browsing history cleared!')
  }

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setHistoryItems((prev) => {
      const updated = prev.filter((h) => h.id !== id)
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated))
      } catch {}
      return updated
    })
  }

  const toggleDarkModeWeb = () => {
    setDarkModeWeb((prev) => {
      const next = !prev
      try {
        localStorage.setItem('vyora_browser_dark_web', String(next))
      } catch {}
      showToast(next ? '🌙 Dark Web Mode ON (Eye-Protection)' : '☀️ Normal Light Mode ON')
      return next
    })
  }

  const toggleAdShield = () => {
    setAdShield((prev) => {
      const next = !prev
      try {
        localStorage.setItem('vyora_browser_ad_shield', String(next))
      } catch {}
      showToast(next ? '🛡️ Ad & Popup Shield ACTIVE' : '⚠️ Ad Shield Paused')
      return next
    })
  }

  const toggleDesktopMode = () => {
    setDesktopMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem('vyora_browser_desktop_mode', String(next))
      } catch {}
      showToast(next ? '🖥️ Desktop 1080p View ON' : '📱 Responsive Auto View ON')
      return next
    })
  }

  const duplicateTab = (tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const target = tabs.find((t) => t.id === tabId)
    if (!target) return
    const newId = `tab-${Date.now()}`
    const dup: Tab = {
      ...target,
      id: newId,
      title: `${target.title} (2)`,
    }
    setTabs((prev) => [...prev, dup])
    setActiveTabId(newId)
    showToast('✓ Tab duplicated!')
  }

  const closeOtherTabs = (tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setTabs((prev) => prev.filter((t) => t.id === tabId))
    setActiveTabId(tabId)
    showToast('✓ Other tabs closed')
  }

  const copyCurrentUrl = () => {
    if (!activeTab?.url) return
    try {
      navigator.clipboard.writeText(activeTab.url)
      showToast('✓ Web link copied to clipboard!')
    } catch {
      showToast(`URL: ${activeTab.url}`)
    }
  }

  const isVideoSite = activeTab?.url
    ? /(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|\.(mp4|mkv|webm|m3u8|ts)(\?|$))/i.test(
        activeTab.url,
      )
    : false

  const streamInVyoraPlayer = () => {
    if (!activeTab?.url) return
    if (onPlayMovie) {
      onPlayMovie(activeTab.url, activeTab.title || 'Web Video Stream')
      showToast('🎬 Streaming in Vyora TV Hardware Player...')
    } else {
      showToast('Player handler not connected')
    }
  }

  // Synchronize omnibox input when tab changes
  useEffect(() => {
    if (activeTab) {
      setInputUrl(activeTab.displayUrl || '')
    }
  }, [activeTabId, activeTab?.displayUrl])

  // Poll downloads if modal open
  useEffect(() => {
    if (!isDownloadsOpen) return
    const update = () => {
      fetchDownloads().then((items) => {
        if (items) setDownloadItems(items)
      })
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [isDownloadsOpen])

  // Auto-finish loading after 30s timeout. The old 10s timeout made the UI
  // claim "loaded" while the page was still streaming; 30s matches the
  // server-side budget and still prevents a permanent spinner.
  useEffect(() => {
    if (!activeTab?.isLoading) return
    const timer = setTimeout(() => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, isLoading: false } : t)),
      )
    }, 30000)
    return () => clearTimeout(timer)
  }, [activeTab?.isLoading, activeTab?.id])

  // Session restoration: remember the open tabs so a reload comes back.
  useEffect(() => {
    if (settings.privateMode) return
    try {
      const payload = tabs.map((t) => ({
        url: t.url,
        title: t.title,
        engine: t.engine,
        history: t.history,
        historyIndex: t.historyIndex,
      }))
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload))
    } catch {}
  }, [tabs, settings.privateMode])

  const saveBookmarks = (items: Bookmark[]) => {
    setBookmarks(items)
    try {
      localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(items))
    } catch (e) {
      // ignore
    }
  }

  // Navigate the active tab
  const navigateActiveTab = useCallback(
    (target: string, keepHistory: boolean = false) => {
      if (!activeTab) return
      const normalized = normalizeUrlOrQuery(target, activeTab.engine)
      if (!normalized) return

      // Proxy only the selected provider's result page. Destination websites
      // still load directly, so normal browsing is not needlessly proxied.
      const engine = BROWSER_ENGINES[activeTab.engine]
      let proxySearch = false
      if (engine && activeTab.engine !== 'google') {
        try {
          const targetHost = new URL(normalized).hostname
          const searchHost = new URL(engine.searchUrl('vyora-smoke-test')).hostname
          proxySearch = targetHost === searchHost
        } catch {
          proxySearch = false
        }
      }

      const domainTitle = getDomainTitle(normalized)
      recordHistory(normalized, domainTitle, activeTab.engine)

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab

          let newHistory = tab.history
          let newIndex = tab.historyIndex

          if (!keepHistory) {
            newHistory = tab.history.slice(0, tab.historyIndex + 1).concat(normalized)
            newIndex = newHistory.length - 1
          }

          return {
            ...tab,
            url: normalized,
            displayUrl: normalized,
            frameUrl: normalized,
            proxyMode: proxySearch,
            title: domainTitle,
            history: newHistory,
            historyIndex: newIndex,
            isLoading: true,
            navKey: (tab.navKey || 0) + 1,
          }
        }),
      )
    },
    [activeTab, activeTabId, recordHistory],
  )

  // Listen for iframe postMessage events (downloads, navigation, and page state sync)
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === 'VYORA_DOWNLOAD' && e.data?.url) {
        startDownload(e.data.url, e.data.name).then((res) => {
          if (res.ok) {
            showToast(`Download started: ${e.data.name || 'File'}`)
            setIsDownloadsOpen(true)
          }
        })
      } else if (e.data?.type === 'VYORA_NAVIGATE' && e.data?.url) {
        // In-frame click / navigation: iframe has already navigated via window.location.href.
        // We sync the parent tab's url, displayUrl, title, and history WITHOUT bumping navKey,
        // so React does not recreate or reload the iframe that is currently loading the page!
        const raw = unpackRedirectUrl(e.data.url)
        const unpacked = normalizeUrlOrQuery(raw, activeTab?.engine || 'google')
        const domainTitle = getDomainTitle(unpacked)
        recordHistory(unpacked, domainTitle, activeTab?.engine || 'google')
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== activeTabId) return t
            const newHistory =
              t.history[t.historyIndex] === unpacked
                ? t.history
                : t.history.slice(0, t.historyIndex + 1).concat(unpacked)
            return {
              ...t,
              url: unpacked,
              displayUrl: raw,
              title: domainTitle,
              history: newHistory,
              historyIndex: newHistory.length - 1,
              isLoading: false,
            }
          }),
        )
      } else if (e.data?.type === 'VYORA_PAGE_SYNC' && e.data?.url) {
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== activeTabId) return t
            const unpacked = unpackRedirectUrl(e.data.url || t.displayUrl)
            return {
              ...t,
              title: e.data.title || t.title,
              displayUrl: unpacked,
              isLoading: false,
            }
          }),
        )
      }
    }
    window.addEventListener('message', handleMsg)
    return () => window.removeEventListener('message', handleMsg)
  }, [activeTabId, recordHistory, activeTab?.engine])

  // Bookmarking helper for Omnibox star button
  const isCurrentBookmarked = bookmarks.some(
    (b) => b.url === activeTab?.url || b.url === activeTab?.displayUrl,
  )

  const toggleCurrentBookmark = () => {
    if (!activeTab || !activeTab.url) return
    const curUrl = activeTab.displayUrl || activeTab.url
    const curTitle = activeTab.title || getDomainTitle(curUrl)
    if (isCurrentBookmarked) {
      saveBookmarks(bookmarks.filter((b) => b.url !== curUrl && b.url !== activeTab.url))
      showToast('Removed from TV Bookmarks')
    } else {
      const newBm: Bookmark = {
        id: `bm-${Date.now()}`,
        title: curTitle,
        url: curUrl,
        color: currentEngine.color || '#38bdf8',
      }
      saveBookmarks([newBm, ...bookmarks])
      showToast('⭐ Saved to TV Bookmarks!')
    }
  }

  const handleOmniboxSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputUrl.trim()) return
    navigateActiveTab(inputUrl.trim())
    setSuggestions([])
    setSuggestIndex(-1)
  }

  const handleSpeedDialSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!speedDialSearch.trim()) return
    navigateActiveTab(speedDialSearch.trim())
    setSpeedDialSearch('')
  }

  // Google autocomplete is provider-specific. Never show Google suggestions
  // while another search engine is selected.
  useEffect(() => {
    const q = inputUrl.trim()
    if (suggestTimer.current) window.clearTimeout(suggestTimer.current)
    if (activeTab?.engine !== 'google' || q.length < 2 || /^https?:\/\//i.test(q)) {
      setSuggestions([])
      setSuggestIndex(-1)
      return
    }
    suggestTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API}/suggest?q=${encodeURIComponent(q)}`)
        if (!res.ok) throw new Error(`Suggestions failed: ${res.status}`)
        const data = await res.json()
        const list: string[] = Array.isArray(data?.suggestions) ? data.suggestions : []
        setSuggestions(list.slice(0, 8))
        setSuggestIndex(-1)
      } catch {
        setSuggestions([])
      }
    }, 220)
    return () => {
      if (suggestTimer.current) window.clearTimeout(suggestTimer.current)
    }
  }, [inputUrl, activeTab?.engine])

  const setTabEngine = (engineId: BrowserEngineId) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, engine: engineId } : t)),
    )
    showToast(`Switched to ${BROWSER_ENGINES[engineId]?.name || engineId}`)
  }

  const addTab = (customEngine?: BrowserEngineId) => {
    const newId = `tab-${Date.now()}`
    const engine = customEngine || settings.defaultEngine || activeTab?.engine || 'google'
    const homeUrl = BROWSER_ENGINES[engine]?.homeUrl || ''
    const newTab: Tab = {
      id: newId,
      title: 'New Tab',
      url: '',
      displayUrl: '',
      frameUrl: '',
      engine,
      proxyMode: false,
      zoom: 1.0,
      history: [],
      historyIndex: -1,
      isLoading: false,
      navKey: 0,
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newId)
    setInputUrl('')
    // A fresh tab opens the configured homepage (Speed Dial when empty).
    if (settings.homepage) {
      navigateToInNewTab(newId, settings.homepage)
    }
  }

  const navigateToInNewTab = (tabId: string, url: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? {
              ...t,
              url,
              displayUrl: url,
              frameUrl: url,
              title: getDomainTitle(url),
              history: [url],
              historyIndex: 0,
              isLoading: true,
              navKey: (t.navKey || 0) + 1,
            }
          : t,
      ),
    )
  }

  const closeTab = (idToClose: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (tabs.length === 1) {
      setTabs([
        {
          id: `tab-${Date.now()}`,
          title: 'New Tab',
          url: '',
          displayUrl: '',
          frameUrl: '',
          engine: settings.defaultEngine || 'google',
          proxyMode: false,
          zoom: 1.0,
          history: [],
          historyIndex: -1,
          isLoading: false,
          navKey: 0,
        },
      ])
      setInputUrl('')
      return
    }

    const filtered = tabs.filter((t) => t.id !== idToClose)
    setTabs(filtered)
    if (activeTabId === idToClose) {
      const nextTab = filtered[filtered.length - 1]
      setActiveTabId(nextTab.id)
      setInputUrl(nextTab.displayUrl || '')
    }
  }

  const goBack = () => {
    if (!activeTab || activeTab.historyIndex <= 0) return
    const prevIndex = activeTab.historyIndex - 1
    const prevUrl = activeTab.history[prevIndex]
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              url: prevUrl,
              displayUrl: prevUrl,
              frameUrl: prevUrl,
              proxyMode: false,
              historyIndex: prevIndex,
              isLoading: true,
              navKey: (t.navKey || 0) + 1,
            }
          : t,
      ),
    )
  }

  const goForward = () => {
    if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return
    const nextIndex = activeTab.historyIndex + 1
    const nextUrl = activeTab.history[nextIndex]
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              url: nextUrl,
              displayUrl: nextUrl,
              frameUrl: nextUrl,
              proxyMode: false,
              historyIndex: nextIndex,
              isLoading: true,
              navKey: (t.navKey || 0) + 1,
            }
          : t,
      ),
    )
  }

  const reloadTab = () => {
    if (!activeTab || !activeTab.url) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, frameUrl: t.url, proxyMode: false, isLoading: true, navKey: (t.navKey || 0) + 1 }
          : t,
      ),
    )
  }

  /** Stop loading: abandon the current navigation. */
  const stopLoading = () => {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, isLoading: false, navKey: (t.navKey || 0) + 1 }
          : t,
      ),
    )
    showToast('⏹ Loading stopped')
  }

  const goHome = () => {
    if (!activeTab) return
    const home = settings.homepage || ''
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? home
            ? {
                ...t,
                url: home,
                displayUrl: home,
                frameUrl: home,
                title: getDomainTitle(home),
                isLoading: true,
                navKey: (t.navKey || 0) + 1,
              }
            : {
                ...t,
                url: '',
                displayUrl: '',
                frameUrl: '',
                title: 'New Tab',
                isLoading: false,
              }
          : t,
      ),
    )
    setInputUrl('')
  }

  const changeZoom = (delta: number) => {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t
        const newZoom = Math.min(2.0, Math.max(0.5, Math.round((t.zoom + delta) * 10) / 10))
        return { ...t, zoom: newZoom }
      }),
    )
  }

  const resetZoom = () => {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, zoom: 1.0 } : t)),
    )
  }

  const scrollRemote = (direction: 'up' | 'down') => {
    if (!iframeRef.current) return
    try {
      const scrollAmount = direction === 'up' ? -350 : 350
      iframeRef.current.contentWindow?.scrollBy({ top: scrollAmount, behavior: 'smooth' })
    } catch (e) {
      // Cross-origin fallback
    }
  }

  // -------------------------------------------------------------------------
  // FIND IN PAGE
  // -------------------------------------------------------------------------
  const runFind = useCallback((query: string) => {
    setFindQuery(query)
    if (findTimer.current) window.clearTimeout(findTimer.current)
    if (!query) {
      setFindMatches(0)
      return
    }
    findTimer.current = window.setTimeout(() => {
      try {
        const win = iframeRef.current?.contentWindow as (Window & { find?: FindFn }) | null
        if (!win) {
          setFindMatches(0)
          return
        }
        if (typeof win.find !== 'function') {
          setFindMatches(0)
          showToast('Find in page is not available on this page')
          return
        }
        const ok = win.find(query, false, false, true, false, true, false)
        setFindMatches(ok ? 1 : 0)
      } catch (e) {
        setFindMatches(0)
      }
    }, 220)
  }, [])

  const findNext = (forward: boolean) => {
    try {
      const win = iframeRef.current?.contentWindow as (Window & { find?: FindFn }) | null
      if (!win || typeof win.find !== 'function') return
      win.find(findQuery, forward, false, true, false, true, false)
      setFindMatches((m) => (m > 0 ? m : 0))
    } catch (e) {
      // ignore
    }
  }

  // INSTALL WEB APP TO PLATFORM (WITH REAL LOGO)
  const installCurrentAsWebApp = (overrideUrl?: string, overrideTitle?: string) => {
    const rawTarget = overrideUrl || activeTab?.url
    if (!rawTarget) {
      setIsAddAppOpen(true)
      return
    }
    const cleanUrl = unpackRedirectUrl(rawTarget)
    const domain = getDomainTitle(cleanUrl)
    const pageTitle = cleanUrl === activeTab?.url ? activeTab.title : ''
    const title = overrideTitle?.trim() || prettySiteName(cleanUrl, pageTitle) || domain
    const icon = faviconFor(cleanUrl)
    const newApp: InstalledApp = {
      id: `app-${Date.now()}`,
      title: title || domain,
      url: cleanUrl,
      icon,
      category: 'Web Apps',
      color: currentEngine.color || '#38bdf8',
      installedAt: Date.now(),
    }

    try {
      const raw = localStorage.getItem(INSTALLED_APPS_KEY)
      const existing: InstalledApp[] = raw ? JSON.parse(raw) : []
      const updated = [...existing.filter((a) => a.url !== newApp.url), newApp]
      localStorage.setItem(INSTALLED_APPS_KEY, JSON.stringify(updated))
    } catch (e) {
      // ignore
    }

    if (onInstallApp) {
      onInstallApp(newApp)
    }

    showToast(`✓ "${newApp.title}" installed with logo to Apps & Tools!`)
  }

  const handleCustomAddApp = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAppUrl.trim()) return
    const normalized = normalizeUrlOrQuery(newAppUrl.trim(), activeTab?.engine || 'google')
    installCurrentAsWebApp(normalized, newAppTitle.trim() || undefined)
    setNewAppTitle('')
    setNewAppUrl('')
    setIsAddAppOpen(false)
  }

  const handleBookmarkClick = (bm: Bookmark) => {
    navigateActiveTab(bm.url)
  }

  const handleAddCurrentAsBookmark = () => {
    if (!activeTab || !activeTab.url) return
    const newBm: Bookmark = {
      id: `bm-${Date.now()}`,
      title: activeTab.title || getDomainTitle(activeTab.url),
      url: activeTab.url,
      color: currentEngine.color,
    }
    saveBookmarks([...bookmarks, newBm])
    showToast('✓ Saved to Bookmarks!')
  }

  const handleCustomAddBookmark = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBookmarkUrl.trim()) return
    const normalized = normalizeUrlOrQuery(newBookmarkUrl.trim(), activeTab?.engine || 'google')
    const newBm: Bookmark = {
      id: `bm-${Date.now()}`,
      title: newBookmarkTitle.trim(),
      url: normalized,
      color: '#10b981',
    }
    saveBookmarks([...bookmarks, newBm])
    setNewBookmarkTitle('')
    setNewBookmarkUrl('')
    setIsAddBookmarkOpen(false)
    showToast('✓ Bookmark added!')
  }

  const removeBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    saveBookmarks(bookmarks.filter((b) => b.id !== id))
  }

  const handleStartManualDownload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualDownloadUrl.trim()) return
    const res = await startDownload(manualDownloadUrl.trim(), manualDownloadName.trim(), downloadType)
    if (res.ok) {
      showToast('✓ Download queued!')
      setManualDownloadUrl('')
      setManualDownloadName('')
      const updated = await fetchDownloads()
      setDownloadItems(updated)
    } else {
      showToast(`Download failed: ${res.error}`)
    }
  }

  const handleDeleteDl = async (id: string) => {
    await deleteDownload(id)
    const updated = await fetchDownloads()
    setDownloadItems(updated)
  }

  /**
   * The iframe loads the REAL URL, not a server-side proxy of it.
   *
   * This is the single most important line in the browser. A server-side
   * proxy fetches the page with a plain HTTP client, which for Google yields a
   * JavaScript-only shell with no results, and for many modern sites yields
   * markup whose scripts then fail because the page runs on a foreign origin.
   * Loading the URL directly lets the browser's own engine run the page's
   * JavaScript, which is what makes Google results, YouTube playback and
   * modern SPAs work.
   *
   * Two exceptions keep their own handling:
   *   - YouTube videos use the nocookie embed host (the only embeddable form).
   *   - The Go proxy is still available for sites that refuse to be framed;
   *     the browser falls back to it automatically when a frame fails to load.
   */
  const getIframeSrc = (tab: Tab): string => {
    const target = tab.frameUrl !== undefined ? tab.frameUrl : tab.url
    if (!target) return 'about:blank'
    // YouTube videos must NOT go through the rewriting proxy: the embed player
    // POSTs to youtubei/v1/player and the proxied request fails with
    // ERR_ALPN_NEGOTIATION_FAILED, which surfaces as "Error 152-4 / video
    // unavailable". Loading the embed directly keeps youtube-nocookie.com
    // same-origin inside the iframe, so playback works end to end.
    const ytEmbed = toYouTubeEmbedUrl(target)
    if (ytEmbed) return ytEmbed
    // A site that refused to be framed is retried through the unblocker.
    if (tab.proxyMode) return getProxySrc(tab)
    return target
  }

  /**
   * Fallback for sites that send X-Frame-Options / CSP frame-ancestors and
   * therefore refuse to render in a frame. The Go proxy strips those headers,
   * so the page loads (and its JavaScript runs through the proxy bridge).
   */
  const getProxySrc = (tab: Tab): string => {
    const target = tab.frameUrl !== undefined ? tab.frameUrl : tab.url
    if (!target) return 'about:blank'
    return `${API}/webproxy?u=${encodeURIComponent(target)}`
  }

  /**
   * Detect a frame that the browser refused to render.
   *
   * When a site sends X-Frame-Options: DENY / SAMEORIGIN (or a CSP with
   * frame-ancestors) Chrome renders nothing and fires the load event. The
   * frame's document is unreachable from the parent (cross-origin) but its
   * URL stays at about:blank, and its contentWindow has no frames — that is
   * the signal that the direct load was refused.
   */
  const detectBlockedFrame = useCallback((tabId: string): boolean => {
    try {
      const win = iframeRef.current?.contentWindow
      if (!win) return false
      // A rendered page always has a real location; a refused frame keeps
      // about:blank. Same-origin frames can be inspected directly.
      let href = ''
      try {
        href = win.location.href
      } catch {
        // Cross-origin: the frame IS a real document, so it loaded.
        return false
      }
      if (href && href !== 'about:blank') return false
      return true
    } catch {
      return false
    }
  }, [])

  const handleIframeLoad = () => {
    if (!activeTab) return
    const tabId = activeTab.id
    const url = activeTab.url
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isLoading: false } : t)),
    )

    // If the frame stayed blank, the site refused to be framed. Retry once
    // through the Go proxy, which strips X-Frame-Options / CSP.
    if (!url) return
    window.setTimeout(() => {
      if (!detectBlockedFrame(tabId)) return
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId && !t.proxyMode && t.url
            ? { ...t, proxyMode: true, frameUrl: t.url, navKey: (t.navKey || 0) + 1 }
            : t,
        ),
      )
      showToast('🔓 This site blocks embedding — loaded through the unblocker')
    }, 450)
  }

  const canGoBack = activeTab ? activeTab.historyIndex > 0 : false
  const canGoForward = activeTab
    ? activeTab.historyIndex < activeTab.history.length - 1
    : false

  return (
    <div
      ref={containerRef}
      className={`chromium-browser ${isFullscreen ? 'chromium-fullscreen' : ''}`}
      role="region"
      aria-label="Chromium Web Browser"
    >
      {/* TOAST MESSAGE */}
      {toastMessage ? (
        <div className="chromium-toast" role="alert">
          {toastMessage}
        </div>
      ) : null}

      {/* 1. TOP TABS STRIP */}
      <div className="chromium-tabstrip">
        <div className="chromium-tabs-scroll">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            const tabEngine = BROWSER_ENGINES[tab.engine] || BROWSER_ENGINES.google
            return (
              <div
                key={tab.id}
                className={`chromium-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveTabId(tab.id)
                  setInputUrl(tab.displayUrl || '')
                }}
                data-focusable
                role="tab"
                aria-selected={isActive}
                title={`${tab.url || 'New Tab'} (${tabEngine.name})`}
              >
                <div
                  className="chromium-tab-engine-badge"
                  style={{ backgroundColor: tabEngine.color }}
                  title={tabEngine.name}
                >
                  {tabEngine.short.charAt(0)}
                </div>
                <div className="chromium-tab-favicon">
                  {tab.isLoading ? (
                    <div className="chromium-spinner-tiny" />
                  ) : tab.url ? (
                    <BrandLogo
                      iconUrl={faviconFor(tab.url)}
                      color={tabEngine.color}
                      label={tab.title || tabEngine.short}
                      size={14}
                      rounded={4}
                    />
                  ) : (
                    <Icon name="compass" size={13} />
                  )}
                </div>
                <span className="chromium-tab-title">{tab.title || 'New Tab'}</span>
                <button
                  type="button"
                  className="chromium-tab-dup"
                  onClick={(e) => duplicateTab(tab.id, e)}
                  title="Duplicate Tab"
                  aria-label="Duplicate Tab"
                >
                  <Icon name="copy" size={11} />
                </button>
                <button
                  type="button"
                  className="chromium-tab-close"
                  onClick={(e) => closeTab(tab.id, e)}
                  title="Close Tab"
                  aria-label="Close Tab"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className="chromium-newtab-btn"
          onClick={() => addTab()}
          data-focusable
          title="New Tab (+)"
          aria-label="New Tab"
        >
          <Icon name="plus" size={14} />
        </button>

        <div className="chromium-tabstrip-controls">
          {/* DOWNLOADS MANAGER TRIGGER */}
          <button
            type="button"
            className="chromium-ctrl-btn"
            onClick={() => setIsDownloadsOpen(true)}
            title="Downloads Manager (Movies & TV APKs)"
            data-focusable
          >
            <Icon name="download" size={15} />
            {downloadItems.some((d) => d.status === 'downloading') ? (
              <span className="chromium-dl-pulse" />
            ) : null}
          </button>

          <button
            type="button"
            className="chromium-ctrl-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            data-focusable
          >
            <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={15} />
          </button>
          <button
            type="button"
            className="chromium-ctrl-btn chromium-close-btn"
            onClick={onClose}
            title="Close Browser"
            data-focusable
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>

      {/* 2. NAVIGATION TOOLBAR & OMNIBOX */}
      <div className="chromium-toolbar">
        <div className="chromium-nav-buttons">
          <button
            type="button"
            className="chromium-tool-btn"
            disabled={!canGoBack}
            onClick={goBack}
            title="Back"
            data-focusable
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <button
            type="button"
            className="chromium-tool-btn"
            disabled={!canGoForward}
            onClick={goForward}
            title="Forward"
            data-focusable
          >
            <Icon name="arrow-right" size={16} />
          </button>
          <button
            type="button"
            className="chromium-tool-btn"
            onClick={reloadTab}
            title="Reload"
            data-focusable
          >
            <Icon name="refresh" size={16} />
          </button>
          {activeTab?.isLoading ? (
            <button
              type="button"
              className="chromium-tool-btn chromium-stop-btn"
              onClick={stopLoading}
              title="Stop Loading"
              data-focusable
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className="chromium-tool-btn"
            onClick={goHome}
            title="Home"
            data-focusable
          >
            <Icon name="home" size={16} />
          </button>
          <button
            type="button"
            className="chromium-tool-btn"
            onClick={() => {
              setIsFindOpen((v) => !v)
              setFindMatches(0)
            }}
            title="Find in Page (Ctrl+F)"
            data-focusable
          >
            <Icon name="search" size={16} />
          </button>
        </div>

        {/* SEARCH ENGINE SWITCHER — Chrome-style dropdown with brand logos */}
        <div className="chromium-engine-select">
          <button
            type="button"
            className={`chromium-engine-trigger ${engineMenuOpen ? 'open' : ''}`}
            onClick={() => setEngineMenuOpen((v) => !v)}
            title={`Search engine: ${currentEngine.name} — click to switch`}
            aria-haspopup="listbox"
            aria-expanded={engineMenuOpen}
            data-focusable
          >
            <BrandLogo
              iconUrl={logoUrl(currentEngine.favicon)}
              color={currentEngine.color}
              label={currentEngine.short}
              size={18}
              rounded={5}
            />
            <span className="chromium-engine-trigger-name">{currentEngine.short}</span>
            <Icon name={engineMenuOpen ? 'chevron-up' : 'chevron-down'} size={13} />
          </button>

          {engineMenuOpen ? (
            <>
              <div className="chromium-engine-backdrop" onClick={() => setEngineMenuOpen(false)} />
              <div className="chromium-engine-menu" role="listbox" aria-label="Choose search engine">
                <div className="chromium-engine-menu-head">Choose search engine</div>
                {BROWSER_ENGINES_LIST.map((conf) => {
                  const isSelected = activeTab?.engine === conf.id
                  return (
                    <button
                      key={conf.id}
                      type="button"
                      className={`chromium-engine-option ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setTabEngine(conf.id)
                        setEngineMenuOpen(false)
                      }}
                      role="option"
                      aria-selected={isSelected}
                      data-focusable
                    >
                      <BrandLogo
                        iconUrl={logoUrl(conf.favicon)}
                        color={conf.color}
                        label={conf.short}
                        size={22}
                        rounded={6}
                      />
                      <span className="chromium-engine-option-text">
                        <strong style={{ color: isSelected ? conf.color : undefined }}>{conf.short}</strong>
                        <small>{conf.tagline}</small>
                      </span>
                      {isSelected ? <Icon name="check" size={15} /> : null}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>

        {/* OMNIBOX FORM */}
        <form className="chromium-omnibox-form" onSubmit={handleOmniboxSubmit}>
          <div className="chromium-omnibox">
            <span
              className="chromium-omnibox-engine-tag"
              style={{ '--engine-color': currentEngine.color } as React.CSSProperties}
              title={`Active Engine: ${currentEngine.name}`}
            >
              {currentEngine.short}
            </span>
            <span className="chromium-omnibox-ssl" title="Secure connection">
              <Icon name="lock" size={14} />
            </span>
            <input
              type="text"
              className="chromium-omnibox-input"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value)
                setSuggestIndex(-1)
              }}
              onKeyDown={(e) => {
                if (!suggestions.length) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSuggestIndex((i) => Math.min(i + 1, suggestions.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSuggestIndex((i) => Math.max(i - 1, -1))
                } else if (e.key === 'Enter' && suggestIndex >= 0) {
                  e.preventDefault()
                  const picked = suggestions[suggestIndex]
                  setInputUrl(picked)
                  navigateActiveTab(picked)
                  setSuggestions([])
                  setSuggestIndex(-1)
                }
              }}
              placeholder={`Search with ${currentEngine.name} or type web address (e.g. youtube.com)...`}
              data-focusable
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
            />
            {inputUrl ? (
              <button
                type="button"
                className="chromium-omnibox-clear"
                onClick={() => {
                  setInputUrl('')
                  setSuggestions([])
                }}
                title="Clear"
              >
                <Icon name="close" size={12} />
              </button>
            ) : null}
            {/* OMNIBOX STAR (CHROME BOOKMARK SHORTCUT) */}
            <button
              type="button"
              className={`chromium-omnibox-star ${isCurrentBookmarked ? 'bookmarked' : ''}`}
              onClick={toggleCurrentBookmark}
              title={isCurrentBookmarked ? 'Starred (Click to remove)' : 'Bookmark this page (Chrome Star)'}
              data-focusable
            >
              ★
            </button>
            <button
              type="submit"
              className="chromium-omnibox-go"
              title="Go / Search"
              data-focusable
            >
              <Icon name="arrow-right" size={14} />
            </button>
          </div>

          {/* AUTOCOMPLETE SUGGESTIONS */}
          {suggestions.length > 0 ? (
            <div className="chromium-suggestions" role="listbox" aria-label="Search suggestions">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`chromium-suggestion ${i === suggestIndex ? 'active' : ''}`}
                  onClick={() => {
                    setInputUrl(s)
                    navigateActiveTab(s)
                    setSuggestions([])
                    setSuggestIndex(-1)
                  }}
                  role="option"
                  aria-selected={i === suggestIndex}
                  data-focusable
                >
                  <Icon name="search" size={13} />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          ) : null}
        </form>

        {/* ACTIONS */}
        <div className="chromium-actions">
          {isVideoSite ? (
            <button
              type="button"
              className="chromium-badge-btn stream-video-btn"
              onClick={streamInVyoraPlayer}
              title="Stream this video with hardware acceleration in Vyora TV Player"
              data-focusable
            >
              <Icon name="play" size={13} />
              <span className="chromium-btn-label">Stream on TV</span>
            </button>
          ) : null}

          <button
            type="button"
            className="chromium-badge-btn install-app-btn"
            onClick={() => installCurrentAsWebApp()}
            title={activeTab?.url ? "Install this website into Platform's Apps & Tools" : "Install custom website / web app into Platform"}
            data-focusable
          >
            <Icon name="plus" size={13} />
            <span className="chromium-btn-label">Install App</span>
          </button>

          <button
            type="button"
            className={`chromium-tool-btn ${darkModeWeb ? 'active' : ''}`}
            onClick={toggleDarkModeWeb}
            title={darkModeWeb ? 'Dark Web Mode ON (Eye-Protection)' : 'Turn on Dark Web Mode'}
            data-focusable
          >
            <Icon name={darkModeWeb ? 'moon' : 'sun'} size={15} />
          </button>

          <button
            type="button"
            className={`chromium-tool-btn ${adShield ? 'active' : ''}`}
            onClick={toggleAdShield}
            title={adShield ? '🛡️ Ad & Pop-up Shield: ON' : '⚠️ Ad Shield: OFF'}
            data-focusable
          >
            <Icon name="shield" size={15} />
          </button>

          <button
            type="button"
            className={`chromium-tool-btn ${desktopMode ? 'active' : ''}`}
            onClick={toggleDesktopMode}
            title={desktopMode ? '🖥️ Desktop 1080p View: ON' : '📱 Responsive View: ON'}
            data-focusable
          >
            <Icon name={desktopMode ? 'grid' : 'layers'} size={15} />
          </button>

          <button
            type="button"
            className={`chromium-tool-btn ${settings.privateMode ? 'active' : ''}`}
            onClick={() => {
              const next = !settings.privateMode
              saveSettings({ ...settings, privateMode: next })
              showToast(next ? '🕶️ Private browsing ON — nothing is recorded' : '🔓 Private browsing OFF')
            }}
            title={settings.privateMode ? 'Private browsing ON' : 'Start private browsing'}
            data-focusable
          >
            <Icon name="shield" size={15} />
          </button>

          <button
            type="button"
            className="chromium-tool-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Browser Settings"
            data-focusable
          >
            <Icon name="settings" size={15} />
          </button>

          <button
            type="button"
            className="chromium-tool-btn"
            onClick={() => setIsHistoryOpen(true)}
            title="Browsing History (Recent Sites)"
            data-focusable
          >
            <Icon name="clock" size={15} />
          </button>

          <button
            type="button"
            className="chromium-tool-btn"
            onClick={copyCurrentUrl}
            disabled={!activeTab?.url}
            title="Copy URL to Clipboard"
            data-focusable
          >
            <Icon name="link" size={15} />
          </button>

          <div className="chromium-zoom-group">
            <button
              type="button"
              className="chromium-tool-btn chromium-zoom-btn"
              onClick={() => changeZoom(-0.1)}
              title="Zoom Out (-)"
              data-focusable
            >
              <Icon name="zoom-out" size={14} />
            </button>
            <button
              type="button"
              className="chromium-zoom-badge"
              onClick={resetZoom}
              title="Reset Zoom (100%)"
              data-focusable
            >
              {Math.round((activeTab?.zoom || 1) * 100)}%
            </button>
            <button
              type="button"
              className="chromium-tool-btn chromium-zoom-btn"
              onClick={() => changeZoom(0.1)}
              title="Zoom In (+)"
              data-focusable
            >
              <Icon name="zoom-in" size={14} />
            </button>
          </div>

          <div className="chromium-scroll-group">
            <button
              type="button"
              className="chromium-tool-btn"
              onClick={() => scrollRemote('up')}
              title="Scroll Up"
              data-focusable
            >
              ▲
            </button>
            <button
              type="button"
              className="chromium-tool-btn"
              onClick={() => scrollRemote('down')}
              title="Scroll Down"
              data-focusable
            >
              ▼
            </button>
          </div>

          <button
            type="button"
            className={`chromium-tool-btn ${showBookmarks ? 'active' : ''}`}
            onClick={() => setShowBookmarks(!showBookmarks)}
            title="Toggle Bookmarks Bar"
            data-focusable
          >
            <Icon name="bookmark" size={16} />
          </button>
        </div>
      </div>

      {/* FIND IN PAGE BAR */}
      {isFindOpen ? (
        <div className="chromium-find-bar">
          <Icon name="search" size={15} />
          <input
            type="text"
            className="chromium-find-input"
            value={findQuery}
            onChange={(e) => runFind(e.target.value)}
            placeholder="Find in page..."
            data-focusable
            autoFocus
          />
          <span className="chromium-find-count">{findMatches > 0 ? `${findMatches} found` : findQuery ? 'no match' : ''}</span>
          <button type="button" className="chromium-find-btn" onClick={() => findNext(false)} title="Previous match">
            <Icon name="chevron-up" size={14} />
          </button>
          <button type="button" className="chromium-find-btn" onClick={() => findNext(true)} title="Next match">
            <Icon name="chevron-down" size={14} />
          </button>
          <button
            type="button"
            className="chromium-find-btn"
            onClick={() => {
              setIsFindOpen(false)
              setFindQuery('')
              setFindMatches(0)
            }}
            title="Close find bar"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}

      {/* 3. BOOKMARKS / FAVORITES BAR */}
      {showBookmarks ? (
        <div className="chromium-bookmarks-bar">
          <div className="chromium-bookmarks-scroll">
            {bookmarks.map((bm) => (
              <button
                key={bm.id}
                type="button"
                className="chromium-bookmark-item"
                onClick={() => handleBookmarkClick(bm)}
                title={bm.url}
                data-focusable
              >
                <BrandLogo iconUrl={faviconFor(bm.url)} color={bm.color || '#38bdf8'} label={bm.title} size={16} rounded={4} />
                <span className="chromium-bm-title">{bm.title}</span>
                <span
                  className="chromium-bm-del"
                  onClick={(e) => removeBookmark(bm.id, e)}
                  title="Remove bookmark"
                >
                  ×
                </span>
              </button>
            ))}
          </div>

          <div className="chromium-bookmarks-tools">
            {activeTab?.url ? (
              <button
                type="button"
                className="chromium-bm-add-btn"
                onClick={handleAddCurrentAsBookmark}
                title="Bookmark current site"
                data-focusable
              >
                <Icon name="star" size={13} />
                <span>Bookmark</span>
              </button>
            ) : null}
            <button
              type="button"
              className="chromium-bm-add-btn"
              onClick={() => setIsAddBookmarkOpen(!isAddBookmarkOpen)}
              title="Add Custom Bookmark"
              data-focusable
            >
              <Icon name="plus" size={13} />
              <span>Add</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* ADD BOOKMARK MODAL */}
      {isAddBookmarkOpen ? (
        <div className="chromium-dialog-overlay" onClick={() => setIsAddBookmarkOpen(false)}>
          <div
            className="chromium-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add Bookmark"
          >
            <h3>Add New Web Bookmark</h3>
            <form onSubmit={handleCustomAddBookmark}>
              <div className="dialog-field">
                <label>Website Name</label>
                <input
                  type="text"
                  value={newBookmarkTitle}
                  onChange={(e) => setNewBookmarkTitle(e.target.value)}
                  placeholder="e.g. Live Sports Stream"
                  autoFocus
                  required
                />
              </div>
              <div className="dialog-field">
                <label>URL / Address</label>
                <input
                  type="text"
                  value={newBookmarkUrl}
                  onChange={(e) => setNewBookmarkUrl(e.target.value)}
                  placeholder="e.g. espn.com"
                  required
                />
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsAddBookmarkOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Bookmark
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* INSTALL ANY WEB APP MODAL */}
      {isAddAppOpen ? (
        <div className="chromium-dialog-overlay" onClick={() => setIsAddAppOpen(false)}>
          <div
            className="chromium-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Install Web App to Platform"
          >
            <h3>Install Web App to Platform</h3>
            <p className="muted" style={{ marginBottom: 12, fontSize: '0.85rem' }}>
              Add any website, streaming portal, or sports service directly to your Platform's Apps shelf with its live icon.
            </p>
            <form onSubmit={handleCustomAddApp}>
              <div className="dialog-field">
                <label>Website URL / Domain</label>
                <input
                  type="text"
                  value={newAppUrl}
                  onChange={(e) => setNewAppUrl(e.target.value)}
                  placeholder="e.g. cricbuzz.com, netflix.com, twitch.tv"
                  autoFocus
                  required
                />
              </div>
              <div className="dialog-field">
                <label>App Name (Optional)</label>
                <input
                  type="text"
                  value={newAppTitle}
                  onChange={(e) => setNewAppTitle(e.target.value)}
                  placeholder="e.g. Cricbuzz Live Cricket"
                />
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsAddAppOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Install to Apps &amp; Tools
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* BROWSER SETTINGS MODAL */}
      {isSettingsOpen ? (
        <div className="chromium-dialog-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div
            className="chromium-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Browser Settings"
          >
            <h3>Browser Settings</h3>
            <div className="dialog-field">
              <label>Default Search Engine</label>
              <select
                className="dialog-select"
                value={settings.defaultEngine}
                onChange={(e) => {
                  const eng = e.target.value as BrowserEngineId
                  saveSettings({ ...settings, defaultEngine: eng })
                  setTabEngine(eng)
                }}
              >
                {BROWSER_ENGINES_LIST.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="dialog-field">
              <label>Custom Homepage (empty = Speed Dial)</label>
              <input
                type="text"
                value={settings.homepage}
                onChange={(e) => saveSettings({ ...settings, homepage: e.target.value })}
                placeholder="https://example.com"
              />
            </div>
            <div className="dialog-field">
              <label className="dialog-check">
                <input
                  type="checkbox"
                  checked={settings.privateMode}
                  onChange={(e) => saveSettings({ ...settings, privateMode: e.target.checked })}
                />
                <span>Private browsing (don't record history)</span>
              </label>
            </div>
            <div className="dialog-field">
              <label className="dialog-check">
                <input
                  type="checkbox"
                  checked={settings.blockImages}
                  onChange={(e) => saveSettings({ ...settings, blockImages: e.target.checked })}
                />
                <span>Block images and media (faster, less tracking)</span>
              </label>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  clearAllHistory()
                  saveBookmarks([])
                  showToast('✓ Browsing data cleared')
                }}
              >
                Clear Browsing Data
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setIsSettingsOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* DOWNLOADS MANAGER MODAL */}
      {isDownloadsOpen ? (
        <div className="chromium-dialog-overlay" onClick={() => setIsDownloadsOpen(false)}>
          <div
            className="chromium-dialog chromium-downloads-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Downloads Manager"
          >
            <div className="dialog-header-flex">
              <h3>
                <Icon name="download" size={20} /> Downloads Manager (Movies & TV APKs)
              </h3>
              <button
                type="button"
                className="btn-tiny"
                onClick={() => setIsDownloadsOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStartManualDownload} className="downloads-form">
              <div className="dialog-field">
                <label>Download URL (Direct Video / Movie .mp4, .mkv or Android .apk)</label>
                <input
                  type="text"
                  value={manualDownloadUrl}
                  onChange={(e) => setManualDownloadUrl(e.target.value)}
                  placeholder="https://example.com/movie.mp4 or app.apk"
                  required
                />
              </div>
              <div className="dialog-row-2">
                <div className="dialog-field">
                  <label>Title / Label</label>
                  <input
                    type="text"
                    value={manualDownloadName}
                    onChange={(e) => setManualDownloadName(e.target.value)}
                    placeholder="e.g. My Favorite Movie"
                  />
                </div>
                <div className="dialog-field">
                  <label>Type</label>
                  <select
                    value={downloadType}
                    onChange={(e) => setDownloadType(e.target.value as any)}
                    className="dialog-select"
                  >
                    <option value="movie">Movie / Video (.mp4/.mkv)</option>
                    <option value="apk">Android TV App (.apk)</option>
                    <option value="file">Generic File</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <Icon name="download" size={15} /> Start Download to TV
              </button>
            </form>

            <div className="downloads-list">
              {downloadItems.length === 0 ? (
                <div className="empty muted">No downloads in progress or stored yet.</div>
              ) : (
                downloadItems.map((item) => (
                  <div key={item.id} className="download-item-card">
                    <div className="download-item-badge">
                      <Icon name={item.type === 'apk' ? 'apps' : 'film'} size={24} />
                    </div>
                    <div className="download-item-info">
                      <div className="download-item-name">{item.name}</div>
                      <div className="download-item-meta">
                        <span className={`status-pill ${item.status}`}>{item.status}</span>
                        {item.status === 'downloading' ? (
                          <span>{item.speed}</span>
                        ) : null}
                        {item.sizeBytes ? <span>{(item.sizeBytes / 1048576).toFixed(1)} MB</span> : null}
                      </div>
                      {item.status === 'downloading' ? (
                        <div className="dl-progress-bar">
                          <div
                            className="dl-progress-fill"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="download-item-actions">
                      {item.status === 'completed' && item.type === 'apk' ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-tiny"
                          onClick={() => nativeInstallApk(item.downloadUrl)}
                          title="Install APK on TV"
                        >
                          Install
                        </button>
                      ) : null}
                      {item.status === 'completed' && item.type === 'movie' ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-tiny"
                          onClick={() => {
                            if (onPlayMovie) onPlayMovie(item.downloadUrl, item.name)
                          }}
                          title="Play Movie"
                        >
                          Play
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost btn-tiny"
                        onClick={() => handleDeleteDl(item.id)}
                        title="Delete Download"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 4. VIEWPORT */}
      <div className="chromium-progressbar-container">
        <div className="chromium-progressbar" />
      </div>

      <div className="chromium-viewport">
        {activeTab?.url ? (
          /* ACTIVE WEBSITE IFRAME */
          <div className={`chromium-iframe-wrapper ${darkModeWeb ? 'dark-web-active' : ''} ${desktopMode ? 'desktop-canvas-mode' : ''}`}>
            {activeTab.isLoading ? (
              <div className="chrome-loading-bar">
                <div className="chrome-loading-indeterminate" />
              </div>
            ) : null}

            {activeTab.isLoading ? (
              <div className="chrome-load-helper">
                <span className="chrome-load-text">
                  <span className="chrome-spinner" /> Loading <strong>{activeTab.displayUrl}</strong>...
                </span>
                <div className="chrome-load-buttons">
                  <button
                    type="button"
                    className="btn-tiny"
                    onClick={() => reloadTab()}
                    title="Reload this page"
                  >
                    🔄 Reload
                  </button>
                  <button
                    type="button"
                    className="btn-tiny"
                    onClick={() => stopLoading()}
                    title="Stop loading"
                  >
                    ⏹ Stop
                  </button>
                </div>
              </div>
            ) : null}

            <div
              className="chromium-iframe-scaler"
              style={{
                width: `${100 / (activeTab.zoom || 1)}%`,
                height: `${100 / (activeTab.zoom || 1)}%`,
                transform: `scale(${activeTab.zoom || 1})`,
                transformOrigin: 'top left',
              }}
            >
              <iframe
                ref={iframeRef}
                key={`${activeTab.id}-${activeTab.navKey || 0}`}
                src={getIframeSrc(activeTab)}
                className="chromium-iframe"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-presentation allow-popups allow-popups-to-escape-sandbox"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                referrerPolicy="origin"
                onLoad={handleIframeLoad}
                title={activeTab.title}
              />
            </div>
          </div>
        ) : (
          /* SPEED DIAL */
          <div className="chromium-speeddial">
            <div className="speeddial-header">
              <div className="speeddial-logo">
                <div className="speeddial-icon-wrap">
                  <Icon name="compass" size={48} />
                </div>
                <div>
                  <h2>Vyora Browser</h2>
                  <p className="muted">Choose a search engine or jump to a favourite</p>
                </div>
              </div>
            </div>

            <div className="speeddial-engines-bar" role="radiogroup" aria-label="Choose search engine">
              {BROWSER_ENGINES_LIST.map((conf) => {
                const eId = conf.id
                const isSelected = activeTab?.engine === eId
                return (
                  <button
                    key={eId}
                    type="button"
                    className={`speeddial-engine-btn ${isSelected ? 'active' : ''}`}
                    style={{ '--engine-color': conf.color } as React.CSSProperties}
                    onClick={() => setTabEngine(eId)}
                    role="radio"
                    aria-checked={isSelected}
                    title={`Search with ${conf.name}`}
                    data-focusable
                  >
                    <BrandLogo iconUrl={logoUrl(conf.favicon)} color={conf.color} label={conf.short} size={26} rounded={13} />
                    <span className="engine-label">{conf.short}</span>
                    <span className="speeddial-engine-via">{conf.tagline}</span>
                  </button>
                )
              })}
            </div>

            <form className="speeddial-search-form" onSubmit={handleSpeedDialSearchSubmit}>
              <div className="speeddial-search-box">
                <span
                  className="speeddial-engine-tag"
                  style={{ '--engine-color': currentEngine.color } as React.CSSProperties}
                  title={`Active Engine: ${currentEngine.name}`}
                >
                  {currentEngine.short}
                </span>
                <input
                  type="text"
                  value={speedDialSearch}
                  onChange={(e) => setSpeedDialSearch(e.target.value)}
                  placeholder={`Search with ${currentEngine.name} or type URL...`}
                  data-focusable
                />
                <button type="submit" className="speeddial-search-btn" data-focusable>
                  <Icon name="arrow-right" size={16} />
                </button>
              </div>
            </form>

            <div className="speeddial-section">
              <div className="speeddial-head-row">
                <h3 className="speeddial-title">
                  <Icon name="star-filled" size={16} /> Quick Access Portals
                </h3>
                <div className="speeddial-category-chips">
                  {(
                    [
                      ['all', 'All'],
                      ['streaming', 'Streaming'],
                      ['sports', 'Sports'],
                      ['news', 'News'],
                      ['tools', 'Tools'],
                      ['gaming', 'Gaming'],
                    ] as const
                  ).map(([cat, label]) => (
                    <button
                      key={cat}
                      type="button"
                      className={`speeddial-cat-chip ${portalCategory === cat ? 'active' : ''}`}
                      onClick={() => setPortalCategory(cat as any)}
                      data-focusable
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="speeddial-grid">
                {SPEED_DIAL_PORTALS.filter(
                  (p) => portalCategory === 'all' || p.category === portalCategory,
                ).map((portal) => (
                  <button
                    key={portal.id}
                    type="button"
                    className="speeddial-card"
                    onClick={() => navigateActiveTab(portal.url)}
                    data-focusable
                  >
                    <BrandLogo
                      iconUrl={faviconFor(portal.url)}
                      color={portal.color}
                      label={portal.title}
                      size={36}
                      rounded={10}
                    />
                    <div className="speeddial-card-info">
                      <div className="speeddial-card-title">{portal.title}</div>
                      <div className="speeddial-card-url">
                        {portal.url.replace(/^https?:\/\//i, '')}
                      </div>
                    </div>
                    {portal.badge ? <span className="speeddial-pill-badge">{portal.badge}</span> : null}
                    <span
                      className="speeddial-card-pin"
                      onClick={(e) => {
                        e.stopPropagation()
                        installCurrentAsWebApp(portal.url, portal.title)
                      }}
                      title="Install to Platform Apps & Tools"
                    >
                      <Icon name="plus" size={13} />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="speeddial-section">
              <div className="speeddial-head-row">
                <h3 className="speeddial-title">
                  <Icon name="clock" size={16} /> Recently Visited
                </h3>
                <button
                  type="button"
                  className="btn-tiny"
                  onClick={() => setIsHistoryOpen(true)}
                  data-focusable
                >
                  View All
                </button>
              </div>
              <div className="speeddial-grid speeddial-recent-grid">
                {historyItems.slice(0, 6).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="speeddial-card speeddial-recent-card"
                    onClick={() => navigateActiveTab(h.url)}
                    data-focusable
                  >
                    <BrandLogo
                      iconUrl={faviconFor(h.url)}
                      color={BROWSER_ENGINES[h.engine]?.color || '#0ea5e9'}
                      label={h.title}
                      size={36}
                      rounded={10}
                    />
                    <div className="speeddial-card-info">
                      <div className="speeddial-card-title">{h.title}</div>
                      <div className="speeddial-card-url">{h.url.replace(/^https?:\/\//i, '')}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="speeddial-features">
              <div className="speeddial-feat-item">
                <Icon name="shield" size={16} />
                <span>Tracking Protection &amp; Private Mode</span>
              </div>
              <div className="speeddial-feat-item">
                <Icon name="search" size={16} />
                <span>Five independent search engines</span>
              </div>
              <div className="speeddial-feat-item">
                <Icon name="plus" size={16} />
                <span>1-Click Web App Installation</span>
              </div>
              <div className="speeddial-feat-item">
                <Icon name="download" size={16} />
                <span>TV Movie & APK Download Manager</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BROWSING HISTORY MODAL */}
      {isHistoryOpen ? (
        <div className="chromium-dialog-overlay" onClick={() => setIsHistoryOpen(false)}>
          <div className="chromium-history-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="history-header">
              <h3>
                <Icon name="clock" size={20} /> Browsing History ({historyItems.length})
              </h3>
              <div className="history-header-actions">
                {historyItems.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearAllHistory}
                    data-focusable
                  >
                    Clear All
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsHistoryOpen(false)}
                  data-focusable
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>

            <div className="history-search-bar">
              <input
                type="text"
                placeholder="Search history by title or URL..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                data-focusable
              />
            </div>

            {historyItems.length === 0 ? (
              <div className="empty" style={{ padding: '30px 0' }}>
                <Icon name="clock" size={32} />
                <p>No browsing history yet.</p>
                <p className="muted">Websites you visit in Chromium Browser will appear here.</p>
              </div>
            ) : (
              <div className="history-list">
                {historyItems
                  .filter(
                    (h) =>
                      !historySearch ||
                      h.title.toLowerCase().includes(historySearch.toLowerCase()) ||
                      h.url.toLowerCase().includes(historySearch.toLowerCase()),
                  )
                  .map((h) => (
                    <div
                      key={h.id}
                      className="history-item-row"
                      onClick={() => {
                        navigateActiveTab(h.url)
                        setIsHistoryOpen(false)
                      }}
                      data-focusable
                    >
                      <div
                        className="history-item-badge"
                        style={{
                          backgroundColor: BROWSER_ENGINES[h.engine]?.color || '#0ea5e9',
                        }}
                      >
                        {h.title.charAt(0).toUpperCase()}
                      </div>
                      <div className="history-item-info">
                        <div className="history-item-title">{h.title}</div>
                        <div className="history-item-url">{h.url}</div>
                      </div>
                      <div className="history-item-time">
                        {new Date(h.visitedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <button
                        type="button"
                        className="history-item-del"
                        onClick={(e) => deleteHistoryItem(h.id, e)}
                        title="Remove from history"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

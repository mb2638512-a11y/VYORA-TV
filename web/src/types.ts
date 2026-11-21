export type Stream = {
  id: string
  url: string
  quality: string
  label: string
  referer?: string
  ua?: string
  /** true when the source is an HLS playlist */
  hls?: boolean
  /** true when the source is an MPEG-DASH manifest */
  dash?: boolean
}

export type Programme = {
  title: string
  start: string | null
  stop: string | null
  desc: string
}

export type Channel = {
  id: string
  name: string
  alt: string[]
  network: string
  owner: string
  categories: string[]
  country: string
  website: string
  logo: string
  icon: string
  launched: number | null
  closed: number | null
  lang: string
  streams: Stream[]
  epg?: Programme[]
}

export type Country = {
  code: string
  name: string
  flag: string
  flagImg: string
  flagLocal?: string
  count: number
  languages: string[]
  categories: string[]
}

export type Category = {
  id: string
  name: string
  description: string
  count: number
}

export type Bootstrap = {
  generatedAt: string
  totals: { countries: number; channels: number; categories: number; streams: number }
  featured: string[]
  countries: Country[]
  categories: Category[]
}

export type Movie = {
  id: string
  title: string
  logo: string
  backdrop?: string
  genre: string
  year?: number | string
  duration?: number | string
  rating?: number | string
  quality?: string
  description?: string
  url: string
  source?: string
}

export type Episode = {
  id: string
  title: string
  season: number
  episode: number
  duration?: number
  url: string
  logo?: string
}

export type Series = {
  id: string
  title: string
  logo: string
  genre: string
  year?: number | string
  episodes: Episode[]
  source?: string
}

// Each provider has its own real search URL. Results are never silently
// replaced by another provider.
export type BrowserEngineId = 'google' | 'bing' | 'duckduckgo' | 'yahoo' | 'brave'


export type Lang = 'en' | 'ur'

export type InstalledApp = {
  id: string
  title: string
  url: string
  icon?: string
  category?: string
  color?: string
  installedAt: number
}

export type DownloadItem = {
  id: string
  name: string
  url: string
  type: 'apk' | 'movie' | 'audio' | 'file'
  sizeBytes: number
  downloaded: number
  progress: number
  status: 'downloading' | 'completed' | 'failed'
  speed: string
  fileName: string
  downloadUrl: string
  createdAt: string
  completedAt?: string
  errorMsg?: string
}

export type View =
  | { name: 'home' }
  | { name: 'country'; code: string }
  | { name: 'category'; id: string }
  | { name: 'search' }
  | { name: 'favorites' }
  | { name: 'settings' }
  | { name: 'moviebox'; genre?: string }
  | { name: 'movies' }
  | { name: 'series' }
  | { name: 'global' }
  | { name: 'browser'; initialUrl?: string; initialEngine?: BrowserEngineId }
  | { name: 'apps' }
  | { name: 'downloads' }

export type Accessibility = {
  largeText: boolean
  highContrast: boolean
  audioDescription: boolean
  announceFocus: boolean
}

export type XtreamAccount = {
  id: string
  name: string
  server: string
  username: string
  password: string
  status?: string
  expDate?: string
  activeChannels?: number
  lastConnected?: number
}

export type CustomPlaylist = {
  id: string
  name: string
  type: 'xtream' | 'm3u'
  url?: string
  account?: XtreamAccount
  channelsCount?: number
  addedAt: number
}

export type PlayerEngineId =
  | 'internal'
  | 'turbo'
  | 'exoplayer'
  | 'hlsjs'
  | 'html5'
  | 'stadium'
  | 'failover'
  | 'vlc'
  | 'mx'
  | 'nova'
  | 'just'
  | 'mpv'
  | 'potplayer'
  | 'kodi'
  | 'vimu'
  | 'wvc'

export type PlayerInfo = {
  id: PlayerEngineId
  name: string
  badge: string
  description: string
  pkg?: string
  scheme?: string
  platforms: 'all' | 'android' | 'desktop'
  icon: string
}

export type ChannelPanelLayout = 'cards' | 'cable' | 'rails'
export type VodPanelLayout = 'poster' | 'banner'
export type StartupScreen = 'home' | 'global' | 'moviebox' | 'movies' | 'series' | 'favorites' | 'browser'
export type BufferDepth = 'fast' | 'balanced' | 'deep'
export type TunnelMode = 'auto' | 'direct' | 'tunnel'
export type VideoScaling = 'fit' | 'fill' | 'zoom' | '4:3'
export type AudioMode = 'standard' | 'night' | 'dialog'

export const TOP_STREAMING_PLAYERS: PlayerInfo[] = [
  {
    id: 'internal',
    name: 'Vyora Cinema Turbo Engine',
    badge: 'Platform Core (Recommended)',
    description: 'Proprietary ultra-low latency engine with RAM pre-warming, dual-lane manifest proxy and sub-second live channel switching.',
    platforms: 'all',
    icon: 'play',
  },
  {
    id: 'exoplayer',
    name: 'ExoPlayer Media3 Pro',
    badge: 'Native Android TV Core',
    description: 'Google Media3 hardware-accelerated video pipeline with multi-source candidate racing and zero-copy hardware surface rendering.',
    platforms: 'all',
    icon: 'tv',
  },
  {
    id: 'hlsjs',
    name: 'Hls.js Adaptive Stream Engine',
    badge: 'Dynamic Bitrate Ladder',
    description: 'Industry-standard adaptive streaming core with network jitter compensation, automatic recovery watchdogs, and 240p-1080p ladder.',
    platforms: 'all',
    icon: 'signal',
  },
  {
    id: 'html5',
    name: 'HTML5 Native Hardware Engine',
    badge: 'Zero CPU Overhead',
    description: 'Direct GPU decoding via browser media pipeline with lowest power consumption, minimal memory footprint, and native OS sync.',
    platforms: 'all',
    icon: 'monitor',
  },
  {
    id: 'stadium',
    name: 'Ultra-Low Latency Stadium Live',
    badge: 'Real-Time Sports Feed',
    description: 'Aggressive 800ms buffer tuning designed for live stadium sports broadcasts, news tickers, and real-time audio synchronization.',
    platforms: 'all',
    icon: 'sparkles',
  },
  {
    id: 'failover',
    name: 'Auto-Failover Resilient Engine',
    badge: 'High Reliability',
    description: 'High-availability stream supervisor that actively tests alternative candidate sources, removes dead variants, and prevents black screens.',
    platforms: 'all',
    icon: 'refresh',
  },
]

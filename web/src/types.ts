export type Stream = {
  id: string
  url: string
  quality: string
  label: string
  referer?: string
  ua?: string
  /** Original source position before network/health sorting. */
  sourceIndex?: number
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
  displayMode?: 'auto' | 'mobile' | 'desktop'
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
  | { name: 'browser'; initialUrl?: string; initialEngine?: BrowserEngineId; standalone?: boolean; initialDisplayMode?: 'auto' | 'mobile' | 'desktop' }
  | { name: 'apps' }
  | { name: 'allsitehub' }
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
  { id: 'internal', name: 'VYORA Player', badge: 'Default • Platform built-in', description: 'VYORA’s own player. Default for Live TV, Movies and Series with automatic source recovery.', platforms: 'all', icon: 'play' },
  { id: 'exoplayer', name: 'ExoPlayer / Media3 Direct', badge: 'Native Android TV • Direct mode', description: 'Direct single-source Media3 playback. VYORA Player remains the managed mode with multi-source racing and automatic failover.', platforms: 'android', icon: 'tv' },
  { id: 'hlsjs', name: 'HLS.js Player', badge: 'In-app web engine', description: 'Adaptive HLS playback inside VYORA on supported browsers and WebViews.', platforms: 'all', icon: 'signal' },
  { id: 'html5', name: 'HTML5 Player', badge: 'In-app web engine', description: 'Browser-native video playback for supported direct media URLs.', platforms: 'all', icon: 'monitor' },
  { id: 'vlc', name: 'VLC Media Player', badge: 'External Android app', description: 'Open streams in VLC when installed on the Android device.', pkg: 'org.videolan.vlc', platforms: 'android', icon: 'play-circle' },
  { id: 'mx', name: 'MX Player', badge: 'External Android app', description: 'Open compatible streams in MX Player when installed.', pkg: 'com.mxtech.videoplayer.ad', platforms: 'android', icon: 'monitor-play' },
  { id: 'mpv', name: 'mpv Player', badge: 'External Android app', description: 'Open compatible direct media streams in mpv when installed.', pkg: 'is.xyz.mpv', platforms: 'android', icon: 'film' },
  { id: 'kodi', name: 'Kodi', badge: 'External Android app', description: 'Send compatible streams to Kodi when installed.', pkg: 'org.xbmc.kodi', platforms: 'android', icon: 'tv' },
  { id: 'nova', name: 'Nova Video Player', badge: 'External Android app', description: 'Open compatible movie and episode streams in Nova when installed.', pkg: 'org.courville.nova', platforms: 'android', icon: 'clapperboard' },
  { id: 'just', name: 'Just (Video) Player', badge: 'External Android app', description: 'Open compatible streams in Just Player when installed.', pkg: 'com.brouken.player', platforms: 'android', icon: 'play-square' },
]

/**
 * Real SVG icon set (no emoji).
 * Every UI glyph in the app comes from here - crisp on a TV screen at any size.
 */
export type IconName =
  | 'search'
  | 'settings'
  | 'globe'
  | 'film'
  | 'star'
  | 'star-filled'
  | 'clock'
  | 'close'
  | 'download'
  | 'play'
  | 'pause'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'tv'
  | 'list'
  | 'grid'
  | 'check'
  | 'wifi'
  | 'signal'
  | 'layers'
  | 'refresh'
  | 'hash'
  | 'alert'
  | 'volume'
  | 'mute'
  | 'queue'
  | 'menu'
  | 'info'
  | 'trash'
  | 'plus'
  | 'compass'
  | 'arrow-left'
  | 'arrow-right'
  | 'home'
  | 'lock'
  | 'external'
  | 'zoom-in'
  | 'zoom-out'
  | 'maximize'
  | 'minimize'
  | 'shield'
  | 'bookmark'
  | 'apps'
  | 'copy'
  | 'moon'
  | 'sun'
  | 'link'
  | 'filter'
  | 'arrow-down-a-z'
  | 'upload'
  | 'play-circle'
  | 'monitor'
  | 'monitor-play'
  | 'clapperboard'
  | 'play-square'
  | 'bolt'
  | 'sparkles'

const PATHS: Record<IconName, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8.4-2.6.1-1.9-.1-1.9 1.7-1.3-1.8-3.1-2 .7a7.9 7.9 0 0 0-3.3-1.9L14.6 2h-3.6l-.4 2.4A7.9 7.9 0 0 0 7.3 6.3l-2-.7L3.5 8.7l1.7 1.3-.1 1.9.1 1.9-1.7 1.3 1.8 3.1 2-.7a7.9 7.9 0 0 0 3.3 1.9l.4 2.4h3.6l.4-2.4a7.9 7.9 0 0 0 3.3-1.9l2 .7 1.8-3.1-1.7-1.3z',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0c2.5 2.2 3.8 5.2 3.8 9S14.5 18.8 12 21m0-18C9.5 5.2 8.2 8.2 8.2 12s1.3 6.8 3.8 9M3.5 9h17m-17 6h17',
  film: 'M3 4h18v16H3zM3 9h18M3 15h18M8 4v5m8-5v5M8 15v5m8-5v5',
  star: 'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z',
  'star-filled':
    'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5V12l3.2 2',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16',
  play: 'M7 4.5v15l13-7.5z',
  pause: 'M8 4.5v15M16 4.5v15',
  'chevron-up': 'M5 15l7-7 7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  tv: 'M3 5h18v12H3zM8 21h8m-4-4v4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  check: 'M4.5 12.5l5 5 10-11',
  wifi: 'M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10.5 10.5 0 0 1 13 0M8.5 16a6 6 0 0 1 7 0M12 19.5h.01',
  signal: 'M4 20v-4m5 4v-8m5 8V8m5 12V4',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  hash: 'M9 3L7 21M17 3l-2 18M4 9h16M3 15h16',
  alert: 'M12 3l9.5 17H2.5zM12 9v5m0 3h.01',
  volume: 'M4 9.5h3L12 5v14l-5-4.5H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5h3L12 5v14l-5-4.5H4zM16 9.5l5 5m0-5l-5 5',
  queue: 'M4 6h11M4 12h11M4 18h7M17 15v6m3-3-3 3-3-3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5h.01M11 11h1v6h1',
  trash: 'M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  compass: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm3.6 6.4-2.1 5.7-5.7 2.1 2.1-5.7z',
  'arrow-left': 'M19 12H5m7 7-7-7 7-7',
  'arrow-right': 'M5 12h14m-7 7 7-7-7-7',
  home: 'M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4m-12 0h14v10H5z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 4v6m-3-3h6m8 9-4.35-4.35',
  'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-3 7h6m9 9-4.35-4.35',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  minimize: 'M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6 7 7M14 10h6m-6 0V4m0 6 7-7M10 10H4m6 0V4m0 6L3 3',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  apps: 'M4 4h4v4H4zm12 0h4v4h-4zm-6 0h4v4h-4zm-6 6h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zm-12 6h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  moon: 'M21 13.2A8.6 8.6 0 1 1 10.8 3a7 7 0 0 0 10.2 10.2z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  'arrow-down-a-z': 'M5 4v16m0 0-3-3m3 3 3-3M12 6h9M12 10h7M12 14h5M12 18h3',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 20h16',
  'play-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 6v8l7-4z',
  monitor: 'M3 4h18v13H3zM8 21h8m-4-4v4',
  'monitor-play': 'M3 4h18v13H3zM10 8v5l4-2.5zM8 21h8m-4-4v4',
  clapperboard: 'M3 5h18v15H3zM3 9h18M7 5l4 4m2-4 4 4m2-4 2 2',
  'play-square': 'M4 3h16v18H4zM10 8v8l6-4z',
  bolt: 'M13 2 4 14h7l-1 8 10-13h-7z',
  sparkles: 'M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
}

export function Icon({
  name,
  size = 22,
  className = '',
  strokeWidth = 1.8,
  filled = false,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
  filled?: boolean
}) {
  const solid = filled || name === 'star-filled' || name === 'play' || name === 'pause'
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

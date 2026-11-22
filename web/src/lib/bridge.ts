/**
 * Bridge to the native Android TV shell (VyoraBridge).
 * In a normal browser every function is a no-op and `available` is false,
 * so the web app can fall back to hls.js inside the page.
 */

type AndroidBridge = {
  isTvDevice?(): boolean
  play(url: string, referer: string, ua: string, title: string, logo: string): void
  playMulti?(candidates: string, title: string, logo: string): void
  stop(): void
  setVolume(volume: number): void
  getVolume(): number
  speak(text: string): void
  isMuted(): boolean
  toggleMute(): void
  openExternal(url: string): void
  launchPlayer?(url: string, title: string, pkg: string, referer?: string, ua?: string): boolean
  setBrowserDisplayMode?(mode: 'auto' | 'mobile' | 'desktop'): void
  installApk?(urlOrPath: string): void
  exitApp(): void
}

declare global {
  interface Window {
    VyoraBridge?: AndroidBridge
  }
}

export const bridge: AndroidBridge | null =
  typeof window !== 'undefined' && window.VyoraBridge ? window.VyoraBridge : null

// Treat the shell as a native player only when its playback method exists.
// Lightweight bridge stubs (for browser display-mode integration) must not
// accidentally disable the in-page player.
export const isNative = typeof bridge?.play === 'function'

export function nativePlay(url: string, referer = '', ua = '', title = '', logo = '') {
  bridge?.play(url, referer, ua, title, logo)
}

/**
 * Turbo start: give the native player every source of the channel. It races
 * them and keeps the first one that works, so a dead CDN never produces a
 * black screen.
 */
export function nativePlayMulti(
  candidates: Array<{ url: string; referer?: string; ua?: string }>,
  title = '',
  logo = '',
) {
  const list = (candidates || []).filter((c) => c?.url)
  if (!list.length) return
  if (bridge?.playMulti) {
    bridge.playMulti(JSON.stringify(list), title, logo)
    return
  }
  const first = list[0]
  bridge?.play(first.url, first.referer || '', first.ua || '', title, logo)
}

export function setBrowserDisplayMode(mode: 'auto' | 'mobile' | 'desktop') {
  bridge?.setBrowserDisplayMode?.(mode)
}

export function nativeStop() {
  bridge?.stop()
}

export function speak(text: string) {
  if (bridge?.speak) {
    bridge.speak(text)
    return
  }
  // Browser fallback: Web Speech API (best effort, only when enabled)
  try {
    if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Fallback used when the native shell exposes no handler. Opening an OS window
 * is deliberately avoided: the app must stay self-contained (Chrome-like
 * experience), so a plain in-page notification is used instead of window.open.
 */
export function nativeOpenExternal(url: string) {
  if (bridge?.openExternal) {
    bridge.openExternal(url)
    return
  }
  if (url) {
    console.info('[Vyora] external open requested (in-app only):', url)
  }
}

export function nativeInstallApk(urlOrPath: string) {
  if (bridge?.installApk) {
    bridge.installApk(urlOrPath)
    return
  }
  // No OS window: the download itself is handled by the in-app downloads panel.
  if (urlOrPath) {
    console.info('[Vyora] APK install requested:', urlOrPath)
  }
}

import type { PlayerEngineId } from '../types'
import { TOP_STREAMING_PLAYERS } from '../types'

export function getPlayerIntentOrUri(playerId: PlayerEngineId, streamUrl: string, title = ''): string {
  const encUrl = encodeURIComponent(streamUrl)
  const encTitle = encodeURIComponent(title || 'Vyora Stream')
  switch (playerId) {
    case 'vlc':
      return `vlc://${streamUrl}`
    case 'mpv':
      return `mpv://${streamUrl}`
    case 'potplayer':
      return `potplayer://${streamUrl}`
    case 'wvc':
      return `wvc-x-callback://open?url=${encUrl}&title=${encTitle}`
    case 'mx':
      return `intent:${streamUrl}#Intent;package=com.mxtech.videoplayer.ad;type=video/*;S.title=${encTitle};end`
    case 'nova':
      return `intent:${streamUrl}#Intent;package=org.courville.nova;type=video/*;S.title=${encTitle};end`
    case 'just':
      return `intent:${streamUrl}#Intent;package=com.brouken.player;type=video/*;S.title=${encTitle};end`
    case 'kodi':
      return `intent:${streamUrl}#Intent;package=org.xbmc.kodi;type=video/*;S.title=${encTitle};end`
    case 'vimu':
      return `intent:${streamUrl}#Intent;package=net.gtvbox.videoplayer;type=video/*;S.title=${encTitle};end`
    default:
      return streamUrl
  }
}

export function downloadStreamM3u(title: string, streamUrl: string) {
  const safeTitle = title.replace(/[\r\n]/g, ' ').trim() || 'Vyora Stream'
  const content = `#EXTM3U\n#EXTINF:-1,${safeTitle}\n${streamUrl}\n`
  const blob = new Blob([content], { type: 'audio/x-mpegurl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = safeTitle.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50) || 'stream'
  a.download = `${safeName}.m3u`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function launchExternalStream(playerId: PlayerEngineId, streamUrl: string, title = '', referer = '', ua = '') {
  const player = TOP_STREAMING_PLAYERS.find((p) => p.id === playerId)
  if (playerId === 'internal' || playerId === 'exoplayer' || playerId === 'hlsjs' || playerId === 'html5') {
    return { launched: false, inPlatform: true }
  }
  if (bridge?.launchPlayer && player?.pkg) {
    const launched = bridge.launchPlayer(streamUrl, title, player.pkg, referer, ua)
    return launched
      ? { launched: true, method: 'bridge_launch' }
      : { launched: false, reason: 'not_installed', inPlatform: true }
  }
  // External apps are Android-only. Never claim a launch on desktop/web.
  return { launched: false, reason: isNative ? 'unsupported_player' : 'android_only', inPlatform: true }
}



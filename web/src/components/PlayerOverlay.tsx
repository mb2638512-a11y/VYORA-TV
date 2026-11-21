import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Channel, Country, PlayerEngineId } from '../types'
import { TOP_STREAMING_PLAYERS } from '../types'
import type { HealthRecord } from '../lib/api'
import { ChannelLogo } from './ChannelLogo'
import {
  buildProxyUrl,
  currentMode,
  markStream,
  notifyPlaybackActive,
  notifyPlaybackInactive,
  prefetchParams,
  reportStreamPlayback,
  requestLookahead,
  resolveFastestStream,
} from '../lib/api'
import { downloadStreamM3u, isNative, launchExternalStream, nativePlay, nativePlayMulti, nativeStop } from '../lib/bridge'
import { Icon } from './Icon'

type Props = {
  channel: Channel
  country?: Country
  channels: Channel[]
  onExit: () => void
  onSwitch: (ch: Channel) => void
  onCycleStream: (delta: number) => void
  onQueue: (ch: Channel) => void
  t: (key: string) => string
  audioDescription: boolean
  filterSummary?: string
  statuses?: Record<string, HealthRecord>
  networkQuality?: string
  networkMaxLevel?: number
  networkKbps?: number
  drawer: boolean
  onDrawer: (open: boolean) => void
  autoSkipOffline?: boolean
  assignedPlayerId?: PlayerEngineId
  assignedPlayerName?: string
  assignedPlayerBadge?: string
  onSelectPlayer?: (playerId: PlayerEngineId) => void
}

const DRAWER_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'kids', label: 'Kids' },
  { id: 'sports', label: 'Sports' },
  { id: 'news', label: 'News' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'music', label: 'Music' },
  { id: 'religious', label: 'Religious' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'animation', label: 'Animation' },
  { id: 'education', label: 'Education' },
  { id: 'science', label: 'Science' },
  { id: 'lifestyle', label: 'Lifestyle' },
]

/** Fixed row height of the drawer list - the virtualiser relies on it. */
const DRAWER_ROW_H = 52

/**
 * Full-bleed TV player with zero-blank loading, auto-failover,
 * parallel stream racing, and real-time status synchronization.
 */
export function PlayerOverlay({
  channel,
  country,
  channels,
  onExit,
  onSwitch,
  onCycleStream,
  onQueue,
  t,
  filterSummary,
  statuses = {},
  networkQuality = 'auto',
  networkMaxLevel = 0,
  networkKbps = 0,
  drawer,
  onDrawer,
  autoSkipOffline = false,
  assignedPlayerId = 'internal',
  assignedPlayerName,
  assignedPlayerBadge,
  onSelectPlayer,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('loading')
  const [buffering, setBuffering] = useState(false)
  const [needUnmute, setNeedUnmute] = useState(false)
  const [message, setMessage] = useState('')
  const [streamIndex, setStreamIndex] = useState(0)
  const [showInfo, setShowInfo] = useState(true)
  const [toast, setToast] = useState('')
  const [volume, setVolume] = useState<number>(() => {
    try {
      const v = localStorage.getItem('vyora_player_volume')
      return v ? parseFloat(v) : 1
    } catch {
      return 1
    }
  })
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [volumeOsd, setVolumeOsd] = useState<{ show: boolean; val: number; muted: boolean } | null>(null)
  const volumeTimerRef = useRef<number | null>(null)
  const [drawerIndex, setDrawerIndex] = useState(0)
  const [drawerFilter, setDrawerFilter] = useState<string>('all')
  const [drawerQuery, setDrawerQuery] = useState('')
  const [drawerScrollTop, setDrawerScrollTop] = useState(0)
  const [drawerViewH, setDrawerViewH] = useState(640)
  const drawerListRef = useRef<HTMLDivElement | null>(null)
  const [offline, setOffline] = useState(false)
  const [availableLevels, setAvailableLevels] = useState<
    Array<{ index: number; name: string; height: number; bitrate: number }>
  >([])
  const [selectedLevel, setSelectedLevel] = useState<number>(-1) // -1 = Auto Adaptive Bitrate
  const [activeResolution, setActiveResolution] = useState<string>('')
  const [activeBitrate, setActiveBitrate] = useState<number>(0)
  // Index of the source the server raced and won (-1 = not resolved yet).
  const [resolvedIdx, setResolvedIdx] = useState<number | null>(null)
  const [showPlayerPicker, setShowPlayerPicker] = useState(false)
  const [activeEngineId, setActiveEngineId] = useState<PlayerEngineId>(assignedPlayerId || 'internal')

  useEffect(() => {
    if (assignedPlayerId) setActiveEngineId(assignedPlayerId)
  }, [assignedPlayerId])

  const currentEngine = useMemo(() => {
    return TOP_STREAMING_PLAYERS.find((p) => p.id === activeEngineId) || {
      id: 'internal',
      name: 'Vyora Cinema Turbo Engine',
      badge: 'Core',
      description: '',
      platforms: 'all' as const,
      icon: 'play',
    }
  }, [activeEngineId])

  const stream = channel.streams[streamIndex]
  const currentIndex = channels.findIndex((c) => c.id === channel.id)
  const channelStatus = statuses[channel.id]?.status ?? 'unknown'

  /** Clean source label - "Live HLS" / "Auto" say nothing to the viewer. */
  const sourceLabel = useMemo(() => {
    const lbl = (stream?.label || '').trim()
    if (!lbl || lbl === 'Auto' || /^live\s*hls$/i.test(lbl)) {
      const q = (stream?.quality || '').trim()
      return q ? q : `Source ${streamIndex + 1}`
    }
    return lbl
  }, [stream, streamIndex])

  /* Auto fallback: if a source is dead, errors or stalls, cycle to next */
  const triedRef = useRef<Set<number>>(new Set())
  const attemptRef = useRef<number>(0) // honest "attempt N of M" counter
  const networkFailsRef = useRef<number>(0)
  const watchdogRef = useRef<number | null>(null)
  const cycleCountRef = useRef<number>(0)
  const [retryNonce, setRetryNonce] = useState(0)

  const hasPlayedRef = useRef<boolean>(false)
  const manifestParsedRef = useRef<boolean>(false)
  const fragLoadedRef = useRef<boolean>(false)

  useEffect(() => {
    hasPlayedRef.current = false
    manifestParsedRef.current = false
    fragLoadedRef.current = false
    const best = statuses[channel.id]?.bestStream
    const initialIdx =
      typeof best === 'number' && best >= 0 && best < (channel.streams?.length || 0) ? best : 0
    setStreamIndex(initialIdx)
    setStatus('loading')
    setBuffering(false)
    setNeedUnmute(false)
    setOffline(false)
    setAvailableLevels([])
    setSelectedLevel(-1)
    setActiveResolution('')
    setActiveBitrate(0)
    triedRef.current = new Set([initialIdx])
    networkFailsRef.current = 0
    cycleCountRef.current = 0
    attemptRef.current = 0

    // Turbo start: ask the server which source answers fastest. The server
    // races every source in parallel (they are already warm in RAM) and we
    // only start the player once the winner is known -> no restart, no blank
    // screen, first frame in milliseconds.
    setResolvedIdx(null)
    if (channel.streams && channel.streams.length > 1) {
      resolveFastestStream(channel.id)
        .then((res) => {
          if (!res || !res.ok || typeof res.streamIndex !== 'number') {
            setResolvedIdx((cur) => (cur === null ? initialIdx : cur))
            return
          }
          const idx = res.streamIndex
          if (idx < 0 || idx >= (channel.streams?.length || 0)) {
            setResolvedIdx((cur) => (cur === null ? initialIdx : cur))
            return
          }
          if (!hasPlayedRef.current && idx !== initialIdx) {
            triedRef.current.add(idx)
            setStreamIndex(idx)
          }
          // Only the first result wins - a late answer must not restart a
          // player that is already running.
          setResolvedIdx((cur) => (cur === null ? idx : cur))
        })
        .catch(() => setResolvedIdx((cur) => (cur === null ? initialIdx : cur)))
    } else {
      setResolvedIdx(initialIdx)
    }

    // Hard deadline: the server race answers in well under a second for a
    // healthy source. Give it enough room to actually return the winner -
    // bailing out too early made the player start a dead stream and then sit
    // through its 12-18s watchdog.
    const deadline = window.setTimeout(() => {
      setResolvedIdx((cur) => (cur === null ? initialIdx : cur))
    }, 3000)
    return () => window.clearTimeout(deadline)
  }, [channel.id])

  const nextOnlineChannel = useCallback(() => {
    const i = channels.findIndex((c) => c.id === channel.id)
    if (i === -1 || channels.length < 2) return false

    // 1. Search forward for a verified online channel
    let target = channels.slice(i + 1).find((c) => statuses[c.id]?.status === 'online')
    // 2. Search wrap-around from beginning
    if (!target) {
      target = channels.slice(0, i).find((c) => statuses[c.id]?.status === 'online')
    }
    // 3. Search forward for any non-offline channel
    if (!target) {
      target = channels.slice(i + 1).find((c) => statuses[c.id]?.status !== 'offline')
    }
    // 4. Search wrap-around for any non-offline channel
    if (!target) {
      target = channels.slice(0, i).find((c) => statuses[c.id]?.status !== 'offline')
    }
    // 5. Fallback to next channel
    if (!target) {
      target = channels[(i + 1) % channels.length]
    }
    if (target && target.id !== channel.id) {
      setToast(t('tuningNextLive'))
      window.setTimeout(() => {
        onSwitch(target)
      }, 250)
      return true
    }
    return false
  }, [channels, channel.id, statuses, t, onSwitch])

  const tryNextStream = useCallback(() => {
    const list = channel.streams || []
    if (list.length < 2) return false
    for (let i = 1; i <= list.length; i++) {
      const idx = (streamIndex + i) % list.length
      if (!triedRef.current.has(idx)) {
        triedRef.current.add(idx)
        networkFailsRef.current = 0
        attemptRef.current += 1
        setStreamIndex(idx)
        setStatus('loading')
        setBuffering(false)
        const lbl = list[idx]?.label || `#${idx + 1}`
        setToast(`${t('switchingSource')} • ${lbl}`)
        window.setTimeout(() => setToast(''), 2200)
        return true
      }
    }
    return false
  }, [channel.streams, streamIndex, t])

  const handleStreamFailure = useCallback(() => {
    markStream(stream?.url || '', false)
    if (tryNextStream()) return

    // Allow multiple retry passes (up to 4 full passes across all streams) before giving up!
    if (cycleCountRef.current < 4) {
      cycleCountRef.current++
      triedRef.current.clear()
      networkFailsRef.current = 0
      setStatus('loading')
      setToast(`Reconnecting to live broadcast...`)
      window.setTimeout(() => {
        if (tryNextStream()) return
        // If single stream, re-trigger loading on the same stream without flashing offline!
        setStatus('loading')
        setRetryNonce((n) => n + 1)
      }, 600)
      return
    }

    // Only after genuine extensive multi-cycle exhaustion show offline screen
    void reportStreamPlayback(channel.id, false, 0, streamIndex)
    setStatus('error')
    setOffline(true)
    setMessage(t('offlineHint'))
  }, [stream, tryNextStream, channel.id, streamIndex, t])

  /* Main stream loading and playback engine */
  useEffect(() => {
    if (!stream) {
      setStatus('error')
      setOffline(true)
      setMessage(t('noStreams'))
      return
    }

    setStatus('loading')
    setBuffering(false)
    setOffline(false)
    networkFailsRef.current = 0

    const externalPlayer = ['vlc', 'mx', 'mpv', 'kodi', 'nova', 'just'].includes(activeEngineId)
    if (externalPlayer) {
      if (isNative) {
        const result = launchExternalStream(activeEngineId, stream.url, channel.name, stream.referer || '', stream.ua || '')
        if (result.launched) {
          nativeStop()
          setStatus('playing')
          setToast(`Opened in ${currentEngine.name}`)
          return
        }
        setToast(`${currentEngine.name} could not open this stream. Falling back to VYORA Player.`)
      } else {
        setToast('External Android players are available in the Android TV app. Using VYORA Player here.')
      }
      setActiveEngineId('internal')
      return
    }

    if (isNative && (activeEngineId === 'hlsjs' || activeEngineId === 'html5')) {
      // Hide the native SurfaceView so the selected WebView engine is visible.
      nativeStop()
    }

    if (isNative && activeEngineId !== 'hlsjs' && activeEngineId !== 'html5') {
      if (activeEngineId === 'exoplayer') {
        // Direct ExoPlayer mode: play only the selected source and let Media3
        // report/fail this source; VYORA Player retains multi-source racing.
        nativePlay(stream.url, stream.referer || '', stream.ua || '', channel.name, channel.logo)
      } else {
        // VYORA-managed mode races alternate sources and performs automatic failover.
        const candidates = (channel.streams || [])
          .slice(0, 4)
          .map((s) => ({ url: s.url, referer: s.referer || '', ua: s.ua || '' }))
        nativePlayMulti(candidates, channel.name, channel.logo)
      }
      setStatus('playing')
      return
    }

    const video = videoRef.current
    if (!video) return

    const useProxy = currentMode() === 'server'
    const src = useProxy
      ? buildProxyUrl(stream.url, stream.referer, stream.ua, channel.id)
      : stream.url

    const isHls = Boolean(
      stream.hls ||
      /\.m3u8(\?|$)/i.test(stream.url) ||
      /format=m3u8/i.test(stream.url) ||
      !/\.(mp4|webm|mkv|avi|mov)(\?|$)/i.test(stream.url)
    )
    const isDash = /\.mpd(\?|$)/i.test(stream.url)

    if (isDash && !isNative) {
      handleStreamFailure()
      return
    }

    // Wait for the server-side race to pick the fastest source (max 1.2s).
    // Starting the winner directly avoids a restart of the whole pipeline.
    if (useProxy && isHls && resolvedIdx === null) {
      return
    }

    // Safety watchdog: intelligent timeout — much longer for first load, and
    // NEVER fires if manifest was already parsed (stream is live, just buffering segments).
    if (watchdogRef.current) window.clearTimeout(watchdogRef.current)
    let hasPlayedFrames = false
    manifestParsedRef.current = false
    fragLoadedRef.current = false
    const hasBackups = Boolean(channel.streams && channel.streams.length > 1 && triedRef.current.size < channel.streams.length)
    // A stream that has not produced a single frame within a few seconds is
    // not going to start: fail over quickly instead of freezing the screen.
    const watchdogTimeout = hasBackups ? 8000 : 15000
    watchdogRef.current = window.setTimeout(() => {
      // If manifest was parsed or fragments loaded, stream IS live — give it more time, don't kill it
      if (manifestParsedRef.current || fragLoadedRef.current) {
        // Re-arm a secondary watchdog for segment buffering (another 12s)
        watchdogRef.current = window.setTimeout(() => {
          if (!hasPlayedFrames && (!video || video.currentTime === 0)) {
            handleStreamFailure()
          }
        }, 12000)
        return
      }
      if (!hasPlayedFrames && (!video || video.currentTime === 0)) {
        handleStreamFailure()
      }
    }, watchdogTimeout)

    // Signal active playback to server so 100% bandwidth is focused on this stream
    void notifyPlaybackActive(channel.id)

    const onPlaying = () => {
      hasPlayedRef.current = true
      hasPlayedFrames = true
      setStatus('playing')
      setBuffering(false)
      if (watchdogRef.current) {
        window.clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
      markStream(stream.url, true)
      void reportStreamPlayback(channel.id, true, 0, streamIndex)
      void notifyPlaybackActive(channel.id)

      // Predictive Lookahead: prefetch next and previous channel in low-priority background
      const i = channels.findIndex((c) => c.id === channel.id)
      if (i !== -1 && channels.length > 1) {
        const nextCh = channels[(i + 1) % channels.length]
        const prevCh = channels[(i - 1 + channels.length) % channels.length]
        if (nextCh && prevCh) {
          void requestLookahead([nextCh.id, prevCh.id])
        }
      }
    }

    const onTimeUpdate = () => {
      if (video.currentTime > 0) {
        hasPlayedRef.current = true
        hasPlayedFrames = true
        if (status !== 'playing') {
          setStatus('playing')
          setBuffering(false)
          if (watchdogRef.current) {
            window.clearTimeout(watchdogRef.current)
            watchdogRef.current = null
          }
        }
      }
    }

    const onWaiting = () => setBuffering(true)
    const onCanPlay = () => setBuffering(false)

    const onError = () => {
      handleStreamFailure()
    }

    video.addEventListener('playing', onPlaying)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('error', onError)

    // Active stall watchdog: guarantees video flows smoothly without micro-freezes
    let lastPlayTime = 0
    let stallTicks = 0
    const stallInterval = window.setInterval(() => {
      if (status !== 'playing' || video.paused || video.ended) {
        lastPlayTime = video.currentTime
        stallTicks = 0
        return
      }
      if (Math.abs(video.currentTime - lastPlayTime) < 0.05) {
        stallTicks++
        if (stallTicks === 3) {
          // Stalled for ~2.4s: Nudge playhead past any gap and force HLS load
          setBuffering(true)
          if (video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1)
            if (end > video.currentTime + 0.3) {
              video.currentTime = video.currentTime + 0.15
            }
          }
          if (hlsRef.current) {
            hlsRef.current.startLoad()
          }
          video.play().catch(() => undefined)
        } else if (stallTicks === 7) {
          // Stalled for ~5.6s: the line cannot carry the current quality.
          // Drop straight to the lowest variant instead of one step per 5s.
          setBuffering(true)
          if (hlsRef.current) {
            const levels = hlsRef.current.levels
            if (levels && levels.length > 1) {
              let lowest = 0
              for (let i = 1; i < levels.length; i++) {
                if ((levels[i].height || 99999) < (levels[lowest].height || 99999)) lowest = i
              }
              hlsRef.current.currentLevel = lowest
              hlsRef.current.autoLevelCapping = lowest
            }
            hlsRef.current.startLoad()
          }
          video.play().catch(() => undefined)
        } else if (stallTicks >= 16) {
          // Stalled for > 12s with zero progress: trigger auto failover
          clearInterval(stallInterval)
          handleStreamFailure()
        }
      } else {
        lastPlayTime = video.currentTime
        if (stallTicks > 0) {
          stallTicks = 0
          setBuffering(false)
        }
      }
    }, 800)

    const attemptPlay = () => {
      const p = video.play()
      if (p !== undefined) {
        p.catch((err) => {
          if (err.name === 'NotAllowedError') {
            video.muted = true
            setNeedUnmute(true)
            video.play().catch(() => undefined)
          }
        })
      }
    }

    if (isHls && Hls.isSupported() && activeEngineId !== 'html5') {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        maxBufferSize: 64 * 1024 * 1024,
        liveSyncDurationCount: 1, // Instant playback: play on 1st segment immediately!
        liveMaxLatencyDurationCount: 6,
        liveDurationInfinity: true,
        startFragPrefetch: true, // Prefetch next fragment in parallel for gapless stream
        initialLiveManifestSize: 1, // Allow starting with single chunk
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 10,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 350,
        manifestLoadingMaxRetryTimeout: 16000,
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 350,
        fragLoadingMaxRetryTimeout: 20000,
        levelLoadingTimeOut: 6000,
        levelLoadingMaxRetry: 2,
        startLevel: -1, // Auto level selection!
        // The player size must NOT cap the quality: on a fast line the user
        // wants 2K/4K. The real cap comes from the measured bandwidth.
        capLevelToPlayerSize: false,
        // Start with an estimate of what the line can really carry. On a slow
        // line this avoids the "start at 4K -> stall -> drop" cycle, so the
        // picture starts smooth instead of freezing.
        abrEwmaDefaultEstimate: networkKbps > 0
          ? Math.min(8_000_000, Math.max(400_000, Math.round(networkKbps * 1000 * 0.8)))
          : 1_500_000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.6,
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)

      // Auto quality: the ABR cap is applied as soon as the levels are
      // known (see MANIFEST_PARSED) - slow line -> 480p/720p, fast line ->
      // 1080p/2K/4K.

      // Happy Eyeballs parallel stream warm-up for remaining streams
      if (channel.streams && channel.streams.length > 1) {
        const candidates = channel.streams
          .map((s, idx) => ({ s, idx }))
          .filter((item) => item.idx !== streamIndex && !triedRef.current.has(item.idx))
          .slice(0, 2)
        for (const c of candidates) {
          fetch(`/api/prefetch?${prefetchParams(c.s, channel.id)}`).catch(() => undefined)
        }
      }

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        manifestParsedRef.current = true
        if (data.levels && data.levels.length > 0) {
          const lvls = data.levels.map((l, idx) => ({
            index: idx,
            name: l.height ? `${l.height}p` : `Q${idx + 1}`,
            height: l.height,
            bitrate: l.bitrate,
          }))
          setAvailableLevels(lvls)
          // Apply the bandwidth cap as soon as the levels are known.
          if (networkMaxLevel > 0) {
            let cap = -1
            for (const l of lvls) {
              if (l.height && l.height <= networkMaxLevel) cap = l.index
            }
            if (cap >= 0) hls.autoLevelCapping = cap
          }
        }
        setSelectedLevel(-1) // Auto ABR by default!
        attemptPlay()
      })

      hls.on(Hls.Events.FRAG_LOADED, () => {
        fragLoadedRef.current = true
        if (video.paused) {
          attemptPlay()
        }
      })

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        const lvl = hls.levels[data.level]
        if (lvl) {
          const res = lvl.height ? `${lvl.height}p` : 'HD'
          const kbps = lvl.bitrate ? Math.round(lvl.bitrate / 1000) : 0
          setActiveResolution(res)
          setActiveBitrate(kbps)
        }
      })

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          networkFailsRef.current++
          if (networkFailsRef.current <= 3) {
            window.setTimeout(() => {
              if (hlsRef.current) hlsRef.current.startLoad()
            }, 500)
            return
          }
          handleStreamFailure()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else {
          handleStreamFailure()
        }
      })

      return () => {
        if (watchdogRef.current) window.clearTimeout(watchdogRef.current)
        clearInterval(stallInterval)
        void notifyPlaybackInactive()
        video.removeEventListener('playing', onPlaying)
        video.removeEventListener('timeupdate', onTimeUpdate)
        video.removeEventListener('waiting', onWaiting)
        video.removeEventListener('canplay', onCanPlay)
        video.removeEventListener('error', onError)
        hls.destroy()
        hlsRef.current = null
      }
    }

    // Direct HTML5 video source
    video.src = src
    attemptPlay()

    return () => {
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current)
      clearInterval(stallInterval)
      void notifyPlaybackInactive()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onError)
      video.pause()
    }
  }, [channel.id, streamIndex, t, tryNextStream, retryNonce, resolvedIdx, activeEngineId])

  /* Auto quality: re-cap the ABR when the measured bandwidth changes
     (without restarting the stream). */
  useEffect(() => {
    const hls = hlsRef.current
    if (!hls || networkMaxLevel <= 0 || !availableLevels.length) return
    let cap = -1
    for (const l of availableLevels) {
      if (l.height && l.height <= networkMaxLevel) cap = l.index
    }
    if (cap >= 0) hls.autoLevelCapping = cap
  }, [networkMaxLevel, availableLevels])

  /* Auto-hide info bar after 6s */
  useEffect(() => {
    if (!showInfo) return
    const id = setTimeout(() => setShowInfo(false), 6000)
    return () => clearTimeout(id)
  }, [showInfo, channel.id])

  useEffect(() => {
    return () => {
      if (isNative) nativeStop()
    }
  }, [])

  /* Remote driven stream cycling */
  useEffect(() => {
    const handler = (e: Event) => {
      const delta = (e as CustomEvent).detail as number
      cycle(delta)
    }
    window.addEventListener('vyora:cycle-stream', handler)
    return () => window.removeEventListener('vyora:cycle-stream', handler)
  })

  const cycle = (delta: number) => {
    if (!channel.streams || channel.streams.length < 2) return
    const next = (streamIndex + delta + channel.streams.length) % channel.streams.length
    setStreamIndex(next)
    onCycleStream(delta)
    const label = channel.streams[next]?.label || ''
    setToast(`${label}${label ? ' • ' : ''}${t('quality')}`)
    window.setTimeout(() => setToast(''), 2200)
  }

  /* Drawer navigation and remote keys */
  const drawerChannels = useMemo(() => {
    if (drawerFilter === 'all') return channels
    if (drawerFilter === 'online') {
      return channels.filter((c) => {
        const rec = statuses[c.id]
        return !(rec?.status === 'offline' && rec?.source === 'playback')
      })
    }
    const target = drawerFilter.toLowerCase()
    return channels.filter((c) => {
      const cats = c.categories || []
      return cats.some((cat) => {
        const norm = (cat || '').toLowerCase()
        if (norm === target || norm.includes(target)) return true
        if (target === 'kids' && (norm.includes('animat') || norm.includes('cartoon') || norm.includes('child') || norm.includes('toon'))) return true
        if (target === 'movies' && (norm.includes('film') || norm.includes('cinema'))) return true
        if (target === 'sports' && (norm.includes('cricket') || norm.includes('football') || norm.includes('racing'))) return true
        if (target === 'news' && (norm.includes('khabar') || norm.includes('samachar'))) return true
        if (target === 'music' && (norm.includes('song') || norm.includes('gaana'))) return true
        if (target === 'entertainment' && (norm.includes('general') || norm.includes('variety'))) return true
        if (target === 'religious' && (norm.includes('islam') || norm.includes('hindu') || norm.includes('quran'))) return true
        return false
      })
    })
  }, [channels, drawerFilter, statuses])

  /* Drawer search - find a channel instantly in a list of thousands. */
  const drawerSearch = useMemo(() => {
    const q = drawerQuery.trim().toLowerCase()
    if (!q) return drawerChannels
    return drawerChannels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.country || '').toLowerCase().includes(q) ||
        (c.network || '').toLowerCase().includes(q),
    )
  }, [drawerChannels, drawerQuery])

  /* Virtualised drawer: only the visible rows are rendered, so a country
     with 2000 channels scrolls smoothly instead of freezing the screen. */
  const drawerWindow = useMemo(() => {
    const total = drawerSearch.length
    const start = Math.max(0, Math.floor(drawerScrollTop / DRAWER_ROW_H) - 8)
    const visible = Math.ceil(drawerViewH / DRAWER_ROW_H) + 16
    const end = Math.min(total, start + visible)
    return {
      start,
      end,
      topPad: start * DRAWER_ROW_H,
      bottomPad: Math.max(0, (total - end) * DRAWER_ROW_H),
    }
  }, [drawerSearch, drawerScrollTop, drawerViewH])

  /* Measure the drawer and jump to the channel that is playing right now. */
  useEffect(() => {
    if (!drawer) return
    const el = drawerListRef.current
    if (!el) return
    const measure = () => setDrawerViewH(el.clientHeight || 640)
    measure()
    const idx = drawerSearch.findIndex((c) => c.id === channel.id)
    if (idx >= 0) {
      el.scrollTop = Math.max(0, idx * DRAWER_ROW_H - el.clientHeight / 2)
      setDrawerScrollTop(el.scrollTop)
    }
    const onScroll = () => setDrawerScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
    }
  }, [drawer, drawerSearch, channel.id])

  /* Keep the highlighted row inside the viewport while navigating. */
  useEffect(() => {
    const el = drawerListRef.current
    if (!el || !drawer) return
    const top = drawerIndex * DRAWER_ROW_H
    const bottom = top + DRAWER_ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [drawerIndex, drawer])

  /* Reset the list when the drawer is opened. */
  useEffect(() => {
    if (!drawer) return
    setDrawerQuery('')
    setDrawerIndex(Math.max(drawerChannels.findIndex((c) => c.id === channel.id), 0))
  }, [drawer])

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        setDrawerIndex((i) => Math.min(i + 1, Math.max(0, drawerSearch.length - 1)))
        e.preventDefault()
        e.stopPropagation()
      } else if (e.key === 'ArrowUp') {
        setDrawerIndex((i) => Math.max(i - 1, 0))
        e.preventDefault()
        e.stopPropagation()
      } else if (e.key === 'Enter') {
        const target = drawerSearch[drawerIndex]
        if (target) onSwitch(target)
        onDrawer(false)
        e.preventDefault()
        e.stopPropagation()
      } else if (e.key === 'Escape') {
        onDrawer(false)
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawer, drawerIndex, drawerSearch, onSwitch, onDrawer])

  const changeVolume = useCallback((delta: number) => {
    setVolume((prev) => {
      const next = Math.max(0, Math.min(1, Math.round((prev + delta) * 100) / 100))
      if (videoRef.current) {
        videoRef.current.volume = next
        if (videoRef.current.muted) videoRef.current.muted = false
      }
      setIsMuted(false)
      try {
        localStorage.setItem('vyora_player_volume', String(next))
      } catch {}
      if (volumeTimerRef.current) window.clearTimeout(volumeTimerRef.current)
      setVolumeOsd({ show: true, val: next, muted: false })
      volumeTimerRef.current = window.setTimeout(() => setVolumeOsd(null), 1600)
      return next
    })
  }, [])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      if (videoRef.current) {
        videoRef.current.muted = next
      }
      if (volumeTimerRef.current) window.clearTimeout(volumeTimerRef.current)
      setVolumeOsd({ show: true, val: volume, muted: next })
      volumeTimerRef.current = window.setTimeout(() => setVolumeOsd(null), 1600)
      return next
    })
  }, [volume])

  const prevChannel = useCallback(() => {
    const i = channels.findIndex((c) => c.id === channel.id)
    if (i !== -1 && channels.length > 1) {
      const prevIdx = (i - 1 + channels.length) % channels.length
      onSwitch(channels[prevIdx])
    }
  }, [channels, channel.id, onSwitch])

  const nextChannel = useCallback(() => {
    if (!nextOnlineChannel()) {
      const i = channels.findIndex((c) => c.id === channel.id)
      if (i !== -1 && channels.length > 1) {
        onSwitch(channels[(i + 1) % channels.length])
      }
    }
  }, [nextOnlineChannel, channels, channel.id, onSwitch])

  // Apply volume setting to video element when playing or mounted
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = isMuted
    }
  }, [status, volume, isMuted])

  // Global Player Navigation & Volume keys (when drawer is closed)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawer) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        nextChannel()
        e.preventDefault()
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        prevChannel()
        e.preventDefault()
      } else if (e.key === '+' || e.key === '=' || e.key === 'VolumeUp') {
        changeVolume(0.05)
        e.preventDefault()
      } else if (e.key === '-' || e.key === '_' || e.key === 'VolumeDown') {
        changeVolume(-0.05)
        e.preventDefault()
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'VolumeMute') {
        toggleMute()
        e.preventDefault()
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'Tab') {
        setDrawerIndex(Math.max(currentIndex, 0))
        onDrawer(!drawer)
        e.preventDefault()
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        onExit()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, nextChannel, prevChannel, changeVolume, toggleMute, currentIndex, onDrawer, onExit])

  const handleUnmute = () => {
    if (videoRef.current) {
      videoRef.current.muted = false
    }
    setIsMuted(false)
    setNeedUnmute(false)
  }

  const nowPlaying = useMemo(() => {
    const epg = channel.epg || []
    if (!epg.length) return null
    const now = Date.now()
    const current = epg.find((p) => {
      const s = p.start ? Date.parse(p.start) : NaN
      const e = p.stop ? Date.parse(p.stop) : NaN
      if (Number.isNaN(s)) return false
      return s <= now && (Number.isNaN(e) || e > now)
    })
    return current || epg[0]
  }, [channel.id, channel.epg])

  return (
    <div className="player-overlay">
      <div className="player-stage">
        {!isNative ? (
          <video
            ref={videoRef}
            className="player-video"
            autoPlay
            playsInline
            onClick={() => setShowInfo((s) => !s)}
            onDoubleClick={() => {
              if (videoRef.current) {
                if (videoRef.current.paused) {
                  videoRef.current.play()
                  setToast('▶ Playing')
                } else {
                  videoRef.current.pause()
                  setToast('⏸ Paused')
                }
                setTimeout(() => setToast(''), 1500)
              }
            }}
          />
        ) : (
          <div className="player-native-hint" aria-hidden="true" />
        )}

        {/* Loading State - Zero Blank Screen: Shows logo & stream status */}
        {status === 'loading' ? (
          <div className="player-status player-loading-stage">
            <div className="player-loading-logo">
              <ChannelLogo channel={channel} size="lg" />
              <div className="spinner" aria-hidden="true" />
              <strong className="loading-title">{channel.name}</strong>
              <span className="loading-sub">
                {resolvedIdx === null
                  ? t('findingFastestSource')
                  : attemptRef.current > 0
                    ? `${t('switchingSource')} (${attemptRef.current}/${Math.max(1, channel.streams.length)})...`
                    : t('connectingLive')}{' '}
                • {sourceLabel} ({streamIndex + 1}/{Math.max(1, channel.streams.length)})
              </span>
            </div>
          </div>
        ) : null}

        {/* Subtle mid-stream buffering indicator (keeps video visible) */}
        {status === 'playing' && buffering ? (
          <div className="player-buffering-badge" aria-live="polite">
            <div className="spinner-sm" aria-hidden="true" />
            <span>Buffering...</span>
          </div>
        ) : null}

        {/* Tap to Unmute Banner if Autoplay was blocked by browser audio policy */}
        {needUnmute ? (
          <button className="unmute-banner" onClick={handleUnmute} data-focusable>
            <Icon name="signal" size={16} /> Tap or Press OK to Unmute Audio 🔊
          </button>
        ) : null}

        {/* Error State with Smart Actions & Channel-Specific Stream Picker */}
        {status === 'error' ? (
          <div className="player-status player-error" role="alert">
            <ChannelLogo channel={channel} size="lg" />
            <strong className="error-channel-name">{channel.name}</strong>
            <span className="error-status-badge">
              <Icon name="alert" size={16} /> {offline ? t('channelOffline') : t('streamError')}
            </span>
            <span className="error-description">{message}</span>

            {/* Direct In-Player Source Selector for this Channel */}
            {channel.streams.length > 1 ? (
              <div className="player-sources-box">
                <span className="sources-box-title">Select Another Stream Source for this Channel:</span>
                <div className="sources-pills-row">
                  {channel.streams.map((s, idx) => (
                    <button
                      key={idx}
                      className={`btn btn-sm ${idx === streamIndex ? 'btn-primary' : 'btn-ghost'}`}
                      data-focusable
                      onClick={() => {
                        triedRef.current.clear()
                        triedRef.current.add(idx)
                        setStreamIndex(idx)
                        setStatus('loading')
                        setOffline(false)
                        setToast(`Testing Source #${idx + 1}${s.label ? ' (' + s.label + ')' : ''}`)
                        window.setTimeout(() => setToast(''), 2200)
                      }}
                    >
                      <Icon name="signal" size={14} /> Source #{idx + 1} {s.label ? `(${s.label})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="player-error-actions">
              <button
                className="btn btn-primary"
                data-focusable
                onClick={() => {
                  triedRef.current.clear()
                  setStatus('loading')
                  setOffline(false)
                }}
              >
                <Icon name="refresh" size={18} /> {t('retry')}
              </button>
              <button className="btn" data-focusable onClick={nextChannel}>
                <Icon name="chevron-down" size={18} /> {t('nextChannelAction')}
              </button>
              <button
                className="btn"
                data-focusable
                onClick={() => {
                  onQueue(channel)
                  setToast(t('addedToQueue'))
                  window.setTimeout(() => setToast(''), 2500)
                }}
              >
                <Icon name="queue" size={18} /> {t('waitAndRetry')}
              </button>
              <button className="btn btn-ghost" data-focusable onClick={onExit}>
                <Icon name="close" size={18} /> {t('back')}
              </button>
            </div>
            <div className="player-error-hint">
              Channel locked: Vyora TV stays on your selected channel with zero auto-hopping.
            </div>
          </div>
        ) : null}

        {/* Overlay Info Bar */}
        {showInfo ? (
          <div className="player-info" role="status">
            <div className="player-info-left">
              <ChannelLogo channel={channel} size="sm" />
              <div>
                <div className="player-name">
                  {channel.name}
                  {currentIndex >= 0 ? (
                    <span className="player-number">#{currentIndex + 1}</span>
                  ) : null}
                </div>
                <div className="player-sub">
                  {channelStatus !== 'unknown' ? (
                    <span className={`status-tag ${channelStatus === 'offline' ? 'status-offline' : 'status-online'}`}>
                      <Icon name={channelStatus === 'offline' ? 'alert' : 'signal'} size={12} />
                      {channelStatus === 'offline' ? 'OFFLINE' : 'ONLINE'}
                    </span>
                  ) : null}
                  <span className="badge-live">{t('live')}</span>
                  {country ? (
                    <span className="player-country">
                      {country.flagLocal || country.flagImg ? (
                        <img src={country.flagLocal || country.flagImg} alt="" className="player-flag" />
                      ) : (
                        <span>{country.flag}</span>
                      )}
                      {country.name}
                    </span>
                  ) : null}
                  {/* Dynamic Adaptive Bitrate Badge */}
                  <span className="badge-quality auto-quality-badge" title="Adaptive Network Flow">
                    <span className="auto-quality-dot" />
                    {selectedLevel === -1
                      ? `Auto ${activeResolution ? '• ' + activeResolution : ''}${activeBitrate ? ' (' + activeBitrate + 'k)' : ''}`
                      : `${activeResolution || stream?.label || 'Manual'}`}
                  </span>
                  {networkQuality !== 'auto' ? (
                    <span className="badge-network">
                      <Icon name="wifi" size={12} /> {networkQuality}
                      {networkKbps > 0 ? ` • ${networkKbps} kbps` : ''}
                    </span>
                  ) : null}
                  {currentEngine.name ? (
                    <span className="badge-player-engine" title="Active Media Player Engine">
                      <span className="engine-indicator-dot" />
                      {currentEngine.name}
                    </span>
                  ) : null}
                </div>

                {/* Auto Quality Ladder (360p - 1080p Adaptive Switcher) */}
                {availableLevels.length > 1 ? (
                  <div className="player-quality-ladder" role="group" aria-label="Quality selector">
                    <span className="quality-ladder-label">Quality:</span>
                    <button
                      className={`quality-chip ${selectedLevel === -1 ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedLevel(-1)
                        if (hlsRef.current) hlsRef.current.currentLevel = -1
                        setToast('Quality: AUTO (Adaptive Network Speed)')
                        window.setTimeout(() => setToast(''), 2200)
                      }}
                      title="Automatically balances video quality between 240p and 1080p based on internet speed"
                    >
                      <Icon name="signal" size={12} /> Auto {activeResolution ? `(${activeResolution})` : ''}
                    </button>
                    {availableLevels.map((lvl) => (
                      <button
                        key={lvl.index}
                        className={`quality-chip ${selectedLevel === lvl.index ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedLevel(lvl.index)
                          if (hlsRef.current) hlsRef.current.currentLevel = lvl.index
                          setActiveResolution(lvl.name)
                          setToast(`Quality locked: ${lvl.name}`)
                          window.setTimeout(() => setToast(''), 2200)
                        }}
                      >
                        {lvl.name}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Stream Switcher in HUD for multi-stream channels */}
                {channel.streams.length > 1 ? (
                  <div className="player-hud-streams">
                    <span className="hud-streams-label">Streams:</span>
                    {channel.streams.map((s, idx) => (
                      <button
                        key={idx}
                        className={`hud-stream-chip ${idx === streamIndex ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (idx !== streamIndex) {
                            triedRef.current.clear()
                            triedRef.current.add(idx)
                            setStreamIndex(idx)
                            setStatus('loading')
                            setToast(`Switched to Source #${idx + 1}${s.label ? ' (' + s.label + ')' : ''}`)
                            window.setTimeout(() => setToast(''), 2200)
                          }
                        }}
                      >
                        #{idx + 1} {s.label || ''}
                      </button>
                    ))}
                  </div>
                ) : null}

                {filterSummary ? (
                  <div className="player-filter">
                    <span className="player-now-label">{t('nowFilter')}</span>
                    <span className="player-filter-value">{filterSummary}</span>
                  </div>
                ) : null}
                {channel.categories?.length ? (
                  <div className="player-cats">
                    {channel.categories.map((c) => (
                      <span key={c} className="player-cat">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="player-info-right">
              {/* Clean Cinema Transport Actions in HUD (Auto-Hides with HUD) */}
              <div className="player-hud-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="hud-action-btn hud-btn-back"
                  onClick={onExit}
                  data-focusable
                  title="Exit Player & Return to Channels (Esc / Back)"
                >
                  <Icon name="arrow-left" size={16} />
                  <span>Exit</span>
                </button>
                <div className="hud-action-group">
                  <button
                    className="hud-action-btn"
                    onClick={prevChannel}
                    data-focusable
                    title="Previous Channel (Up Arrow / PageUp)"
                  >
                    <Icon name="chevron-left" size={16} />
                    <span>CH-</span>
                  </button>
                  <span className="hud-ch-indicator">
                    {currentIndex >= 0 ? `#${currentIndex + 1}` : 'CH'}
                  </span>
                  <button
                    className="hud-action-btn"
                    onClick={nextChannel}
                    data-focusable
                    title="Next Channel (Down Arrow / PageDown)"
                  >
                    <span>CH+</span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                </div>
                <div className="hud-action-group">
                  <button
                    className="hud-action-btn"
                    onClick={() => changeVolume(-0.1)}
                    data-focusable
                    title="Volume Down (Left Arrow / -)"
                  >
                    <span>Vol -</span>
                  </button>
                  <button
                    className={`hud-action-btn ${isMuted ? 'is-muted' : ''}`}
                    onClick={toggleMute}
                    data-focusable
                    title={isMuted ? 'Unmute Audio (M)' : 'Mute Audio (M)'}
                  >
                    <Icon name={isMuted ? 'alert' : 'signal'} size={14} />
                    <span>{isMuted ? 'MUTED' : `${Math.round(volume * 100)}%`}</span>
                  </button>
                  <button
                    className="hud-action-btn"
                    onClick={() => changeVolume(0.1)}
                    data-focusable
                    title="Volume Up (Right Arrow / +)"
                  >
                    <span>Vol +</span>
                  </button>
                </div>
                <button
                  className="hud-action-btn hud-btn-channels"
                  onClick={() => {
                    setDrawerIndex(Math.max(currentIndex, 0))
                    onDrawer(true)
                  }}
                  data-focusable
                  title="Channel Guide Drawer (List / G)"
                >
                  <Icon name="list" size={16} />
                  <span>Channels</span>
                </button>
                <button
                  className="hud-action-btn hud-btn-player"
                  onClick={() => setShowPlayerPicker((open) => !open)}
                  data-focusable
                  aria-expanded={showPlayerPicker}
                  title="Choose playback engine"
                >
                  <Icon name="play-circle" size={16} />
                  <span>Player</span>
                </button>
              </div>

              {showPlayerPicker ? (
                <div className="player-engine-picker" role="dialog" aria-label="Choose player">
                  <div className="player-engine-picker-head">
                    <strong>Choose Player</strong>
                    <button type="button" data-focusable onClick={() => setShowPlayerPicker(false)} aria-label="Close player picker">×</button>
                  </div>
                  <div className="player-engine-picker-list">
                    {TOP_STREAMING_PLAYERS.map((player) => (
                      <button
                        key={player.id}
                        type="button"
                        data-focusable
                        className={`player-engine-picker-item ${activeEngineId === player.id ? 'selected' : ''}`}
                        onClick={() => {
                          setActiveEngineId(player.id)
                          onSelectPlayer?.(player.id)
                          setShowPlayerPicker(false)
                          setToast(`Player preference set to ${player.name}`)
                        }}
                      >
                        <span>{player.name}</span>
                        <small>{player.badge}</small>
                        {activeEngineId === player.id ? <b>✓</b> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="player-clock">{new Date().toLocaleTimeString()}</div>
              {nowPlaying ? (
                <div className="player-now">
                  <span className="player-now-label">{t('nowPlaying')}</span>
                  <span className="player-now-title">{nowPlaying.title}</span>
                </div>
              ) : null}
              <div className="player-hint">
                CH ▲/▼ • Vol ◄/► • {t('openDrawer')} • BACK {t('back')}
              </div>
            </div>
          </div>
        ) : null}

        {toast ? <div className="player-toast">{toast}</div> : null}

        {/* Floating Volume OSD Banner */}
        {volumeOsd ? (
          <div className="player-volume-osd" role="status" aria-live="polite">
            <div className="volume-osd-icon">
              <Icon name={volumeOsd.muted || volumeOsd.val === 0 ? 'alert' : 'signal'} size={22} />
            </div>
            <div className="volume-osd-body">
              <div className="volume-osd-info">
                <span className="volume-osd-label">Volume</span>
                <span className="volume-osd-pct">
                  {volumeOsd.muted ? 'MUTED 🔇' : `${Math.round(volumeOsd.val * 100)}%`}
                </span>
              </div>
              <div className="volume-osd-track">
                <div
                  className="volume-osd-fill"
                  style={{ width: volumeOsd.muted ? '0%' : `${Math.round(volumeOsd.val * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Real-Time Channel Drawer */}
      {drawer ? (
        <>
          <div className="drawer-scrim" onClick={() => onDrawer(false)} aria-hidden="true" />
          <aside className="player-drawer" aria-label={t('channelList')}>
            <div className="drawer-head">
              <div className="drawer-head-top">
                <Icon name="tv" size={19} />
                <span className="drawer-title">{t('channelList')}</span>
                <span className="drawer-count">{drawerSearch.length}</span>
                <button
                  className="btn btn-ghost drawer-close"
                  data-focusable
                  onClick={() => onDrawer(false)}
                  aria-label={t('close')}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>

              <div className="drawer-search">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={drawerQuery}
                  placeholder={t('searchChannels')}
                  onChange={(e) => {
                    setDrawerQuery(e.target.value)
                    setDrawerIndex(0)
                  }}
                  aria-label={t('searchChannels')}
                />
                {drawerQuery ? (
                  <button
                    className="drawer-search-clear"
                    onClick={() => {
                      setDrawerQuery('')
                      setDrawerIndex(0)
                    }}
                    aria-label={t('close')}
                  >
                    <Icon name="close" size={13} />
                  </button>
                ) : null}
              </div>

              <div className="drawer-filter-tabs" role="tablist">
                {DRAWER_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    className={`drawer-tab-btn ${drawerFilter === cat.id ? 'active' : ''}`}
                    onClick={() => {
                      setDrawerFilter(cat.id)
                      setDrawerIndex(0)
                    }}
                    role="tab"
                    aria-selected={drawerFilter === cat.id}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="drawer-list"
              ref={drawerListRef}
              role="listbox"
              aria-label={t('channelList')}
            >
              {drawerSearch.length === 0 ? (
                <div className="drawer-empty">
                  <Icon name="search" size={22} />
                  <span>{t('noResults')}</span>
                </div>
              ) : null}

              {drawerWindow.topPad > 0 ? (
                <div style={{ height: drawerWindow.topPad }} aria-hidden="true" />
              ) : null}

              {drawerSearch.slice(drawerWindow.start, drawerWindow.end).map((c, i) => {
                const idx = drawerWindow.start + i
                const rec = statuses[c.id]
                const st = rec?.status ?? 'online'
                const isOff = st === 'offline' && rec?.source === 'playback'
                const isCurrent = c.id === channel.id
                return (
                  <button
                    key={c.id}
                    className={`drawer-item ${idx === drawerIndex ? 'focused' : ''} ${
                      isCurrent ? 'current' : ''
                    }`}
                    data-focusable
                    onClick={() => {
                      onSwitch(c)
                      onDrawer(false)
                    }}
                  >
                    <span className="drawer-num">{idx + 1}</span>
                    <ChannelLogo channel={c} size="sm" />
                    <span className="drawer-text">
                      <span className="drawer-name">{c.name}</span>
                      <span className="drawer-meta">
                        <span className="drawer-country">{c.country}</span>
                        {c.streams?.[0]?.label ? (
                          <span className="drawer-q">{c.streams[0].label}</span>
                        ) : null}
                      </span>
                    </span>
                    <span
                      className={`drawer-state ${isOff ? 'off' : 'on'}`}
                      title={isOff ? 'OFFLINE' : 'ONLINE'}
                    >
                      <Icon name={isOff ? 'alert' : 'signal'} size={11} />
                    </span>
                  </button>
                )
              })}

              {drawerWindow.bottomPad > 0 ? (
                <div style={{ height: drawerWindow.bottomPad }} aria-hidden="true" />
              ) : null}
            </div>

            <div className="drawer-foot">
              <Icon name="chevron-up" size={13} />
              <span>{t('channelUp')}</span>
              <Icon name="chevron-down" size={13} />
              <span>{t('channelDown')}</span>
              <span className="drawer-foot-sep" />
              <span>OK {t('select')}</span>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  )
}

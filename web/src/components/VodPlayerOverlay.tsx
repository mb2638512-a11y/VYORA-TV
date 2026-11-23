import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Channel, Stream } from '../types'
import { nativeStop } from '../lib/bridge'

type Props = {
  channel: Channel
  onExit: () => void
}

/**
 * Dedicated Movies / Series player. Live TV deliberately continues to use
 * PlayerOverlay; this component owns VOD seeking, resume position and speed.
 * Provider embed pages stay in an iframe because their media URL is not exposed
 * to the app. Direct MP4/HLS/DASH-compatible sources use the built-in controls.
 */
export function VodPlayerOverlay({ channel, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const [fit, setFit] = useState<'contain' | 'cover'>('contain')
  const [captionTrack, setCaptionTrack] = useState(-1)
  const [showControls, setShowControls] = useState(true)
  const streams = useMemo(() => (channel.streams || []).filter((item) => item?.url), [channel.streams])
  const stream = streams[sourceIndex]
  const isEmbed = Boolean((stream as (Stream & { embed?: boolean }) | undefined)?.embed ||
    (stream?.url && /(\/embed\/|autoembed|vidsrc|vidlink|multiembed|player\.php)/i.test(stream.url)))
  const progressKey = `vyora.vod.progress.${channel.id}`

  const exit = useCallback(() => {
    hlsRef.current?.destroy()
    hlsRef.current = null
    nativeStop()
    onExit()
  }, [onExit])

  useEffect(() => {
    // Hide any previous native Live-TV surface before rendering the VOD WebView.
    nativeStop()
    setSourceIndex(0)
    setError('')
    setCurrentTime(0)
    setDuration(0)
    setSpeed(1)
    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [channel.id])

  useEffect(() => {
    if (!stream || isEmbed) return
    const video = videoRef.current
    if (!video) return
    setError('')
    hlsRef.current?.destroy()
    hlsRef.current = null
    video.pause()
    video.removeAttribute('src')
    video.load()

    const saved = Number(localStorage.getItem(progressKey) || 0)
    const isHls = /\.m3u8(?:$|\?)/i.test(stream.url) || /format=m3u8/i.test(stream.url)
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 })
      hlsRef.current = hls
      hls.loadSource(stream.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (saved > 0) video.currentTime = saved
        void video.play().catch(() => setShowControls(true))
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('This video source could not be decoded. Try another source or use the provider player.')
      })
    } else {
      video.src = stream.url
      const onReady = () => {
        if (saved > 0 && Number.isFinite(video.duration) && saved < video.duration - 10) video.currentTime = saved
        void video.play().catch(() => setShowControls(true))
      }
      video.addEventListener('loadedmetadata', onReady, { once: true })
      video.load()
    }
    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [stream?.url, isEmbed, progressKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => {
      setCurrentTime(video.currentTime || 0)
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      setPlaying(!video.paused)
    }
    video.addEventListener('timeupdate', update)
    video.addEventListener('durationchange', update)
    video.addEventListener('play', update)
    video.addEventListener('pause', update)
    video.addEventListener('ended', update)
    return () => {
      video.removeEventListener('timeupdate', update)
      video.removeEventListener('durationchange', update)
      video.removeEventListener('play', update)
      video.removeEventListener('pause', update)
      video.removeEventListener('ended', update)
    }
  }, [isEmbed, sourceIndex])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault()
        exit()
      } else if (!isEmbed && event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(-10)
      } else if (!isEmbed && event.key === 'ArrowRight') {
        event.preventDefault()
        seek(10)
      } else if (!isEmbed && event.key === ' ' && document.activeElement?.tagName !== 'BUTTON') {
        event.preventDefault()
        togglePlayback()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit, isEmbed])

  const seek = (delta: number) => {
    const video = videoRef.current
    if (video && Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta))
    }
  }
  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setError('Playback was blocked. Press Play to start again.'))
    else video.pause()
  }
  const setRate = (rate: number) => {
    setSpeed(rate)
    if (videoRef.current) videoRef.current.playbackRate = rate
  }
  const toggleCaptions = () => {
    const video = videoRef.current
    if (!video) return
    const tracks = video.textTracks
    if (!tracks || !tracks.length) {
      setError('No subtitle tracks are available in this video source.')
      return
    }
    const next = captionTrack + 1 >= tracks.length ? -1 : captionTrack + 1
    for (let i = 0; i < tracks.length; i++) tracks[i].mode = i === next ? 'showing' : 'disabled'
    setCaptionTrack(next)
    setError('')
  }
  const toggleFullscreen = () => {
    const root = document.querySelector('.vyora-vod-player') as HTMLElement | null
    if (!root) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (root.requestFullscreen) void root.requestFullscreen()
  }
  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return '00:00'
    const seconds = Math.floor(value)
    return `${Math.floor(seconds / 3600) ? String(Math.floor(seconds / 3600)).padStart(2, '0') + ':' : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }

  return (
    <div className="vyora-vod-player" role="dialog" aria-label={`Movie player: ${channel.name}`} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#05070b', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 'max(12px, env(safe-area-inset-top)) 16px 12px', background: 'linear-gradient(#111827, transparent)' }}>
        <button type="button" aria-label="Back" onClick={exit} style={buttonStyle}>‹</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channel.name}</strong>
          <small style={{ color: '#9ca3af' }}>VYORA Cinema Player</small>
        </div>
        {streams.length > 1 && <select aria-label="Video source" value={sourceIndex} onChange={(e) => setSourceIndex(Number(e.target.value))} style={selectStyle}>{streams.map((item, index) => <option key={item.id || index} value={index}>{item.label || item.quality || `Source ${index + 1}`}</option>)}</select>}
      </header>
      <main style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }} onClick={() => setShowControls((value) => !value)}>
        {isEmbed && stream ? (
          <iframe title={channel.name} src={stream.url} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer-when-downgrade" style={{ width: '100%', height: '100%', border: 0, background: '#000' }} />
        ) : (
          <>
            <video ref={videoRef} playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: fit, background: '#000' }} onError={() => {
              if (sourceIndex + 1 < streams.length) setSourceIndex((value) => value + 1)
              else setError('Unable to play this source. Check the connection or select another source.')
            }} onTimeUpdate={(event) => {
              const video = event.currentTarget
              try { localStorage.setItem(progressKey, String(video.currentTime)) } catch {}
            }} />
            {showControls && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 18, background: 'linear-gradient(transparent, rgba(0,0,0,.65))', pointerEvents: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, marginTop: 'auto', marginBottom: 'auto', pointerEvents: 'auto' }}>
                <button type="button" aria-label="Back 10 seconds" onClick={(e) => { e.stopPropagation(); seek(-10) }} style={buttonStyle}>↶ 10</button>
                <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); togglePlayback() }} style={{ ...buttonStyle, width: 64, height: 64, fontSize: 26 }}>{playing ? 'Ⅱ' : '▶'}</button>
                <button type="button" aria-label="Forward 10 seconds" onClick={(e) => { e.stopPropagation(); seek(10) }} style={buttonStyle}>10 ↷</button>
              </div>
              <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <input aria-label="Seek video" type="range" min={0} max={Math.max(duration, 1)} step={1} value={Math.min(currentTime, duration || 0)} onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value) }} style={{ width: '100%', accentColor: '#38bdf8' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <small>{formatTime(currentTime)} / {formatTime(duration)}</small>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setRate(speed === 2 ? 0.5 : speed + 0.25)} style={smallButtonStyle}>{speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×</button>
                    <button type="button" onClick={toggleCaptions} style={smallButtonStyle}>CC</button>
                    <button type="button" onClick={() => setFit((value) => value === 'contain' ? 'cover' : 'contain')} style={smallButtonStyle}>{fit === 'contain' ? 'Fit' : 'Zoom'}</button>
                    <button type="button" onClick={toggleFullscreen} style={smallButtonStyle}>⛶</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span>🔊</span><input aria-label="Volume" type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => { const value = Number(e.target.value); setVolume(value); if (videoRef.current) videoRef.current.volume = value }} style={{ width: 120 }} />
                </div>
              </div>
            </div>}
          </>
        )}
        {error && <div role="alert" style={{ position: 'absolute', bottom: 18, left: 16, right: 16, padding: 12, borderRadius: 10, background: '#7f1d1d', color: '#fff' }}>{error}</div>}
      </main>
      <footer style={{ padding: '10px 16px max(12px, env(safe-area-inset-bottom))', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
        {isEmbed ? 'Provider video player • use its playback controls' : '← / →: seek 10 seconds • Space: play / pause • Back: close'}
      </footer>
    </div>
  )
}

const buttonStyle: React.CSSProperties = { border: '1px solid #475569', borderRadius: 999, background: 'rgba(15,23,42,.9)', color: '#fff', minWidth: 46, minHeight: 44, padding: '8px 14px', fontSize: 16 }
const smallButtonStyle: React.CSSProperties = { border: '1px solid #475569', borderRadius: 8, background: 'rgba(15,23,42,.9)', color: '#fff', minHeight: 36, padding: '6px 10px' }
const selectStyle: React.CSSProperties = { maxWidth: 130, background: '#111827', color: '#fff', border: '1px solid #475569', borderRadius: 8, padding: 8 }

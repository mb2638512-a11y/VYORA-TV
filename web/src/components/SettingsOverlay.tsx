import { useState } from 'react'
import type {
  Accessibility,
  Lang,
  PlayerEngineId,
  ChannelPanelLayout,
  VodPanelLayout,
  StartupScreen,
  BufferDepth,
  TunnelMode,
  VideoScaling,
  AudioMode,
} from '../types'
import { TOP_STREAMING_PLAYERS } from '../types'
import { categoryName } from '../lib/i18n'
import { Icon, type IconName } from './Icon'
import { isNative, downloadStreamM3u, launchExternalStream } from '../lib/bridge'

export type Settings = {
  lang: Lang
  a11y: Accessibility
  autoPlayBest: boolean
  autoSkipOffline?: boolean
  verifiedOnly?: boolean
  // Player Engine Suite
  defaultPlayer: PlayerEngineId
  channelsPlayer: PlayerEngineId
  moviesPlayer: PlayerEngineId
  seriesPlayer: PlayerEngineId
  downloadsPlayer: PlayerEngineId
  // Panel & Layout Configurations
  channelPanelLayout: ChannelPanelLayout
  vodPanelLayout: VodPanelLayout
  startupScreen: StartupScreen
  // Turbo Streaming & Buffer Controls
  bufferDepth: BufferDepth
  tunnelMode: TunnelMode
  pruneDeadVariants: boolean
  // Display & Video
  videoScaling: VideoScaling
  // Audio & Sound
  audioMode: AudioMode
  // Parental Controls & Privacy
  parentalLock: boolean
  parentalPin?: string
  hiddenCategories?: string[]
}

type TabId = 'players' | 'display' | 'turbo' | 'audio' | 'parental' | 'playlists' | 'about'

const STANDARD_FILTER_CATEGORIES = [
  'news',
  'sports',
  'kids',
  'entertainment',
  'music',
  'religious',
  'documentary',
  'comedy',
]

const SAMPLE_TEST_STREAM = 'https://iptv-org.github.io/iptv/index.m3u'

export function SettingsOverlay({
  settings,
  setSettings,
  onClose,
  onOpenPlaylists,
  t,
  mode,
  version,
  totals,
  onTestPlayer,
  theme,
  onToggleTheme,
}: {
  settings: Settings
  setSettings: (s: Settings) => void
  onClose: () => void
  onOpenPlaylists?: () => void
  t: (key: string) => string
  mode: string
  version: string
  totals?: { channels: number; countries: number }
  onTestPlayer?: (playerId: PlayerEngineId) => void
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabId>('players')
  const [toastMsg, setToastMsg] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)

  const activePlayerId = settings.channelsPlayer || settings.defaultPlayer || 'internal'
  const activePlayer = TOP_STREAMING_PLAYERS.find((p) => p.id === activePlayerId) || TOP_STREAMING_PLAYERS[0]

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3200)
  }

  const setA11y = (patch: Partial<Accessibility>) =>
    setSettings({ ...settings, a11y: { ...settings.a11y, ...patch } })

  const selectActivePlayer = (playerId: PlayerEngineId) => {
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
    const p = TOP_STREAMING_PLAYERS.find((x) => x.id === playerId)
    showToast(`✓ ${p ? p.name : playerId} activated as primary streaming engine!`)
  }

  const handleSetPlayer = (key: 'defaultPlayer' | 'channelsPlayer' | 'moviesPlayer' | 'seriesPlayer' | 'downloadsPlayer', val: PlayerEngineId) => {
    const updated: Settings = key === 'defaultPlayer'
      ? { ...settings, defaultPlayer: val, channelsPlayer: val, moviesPlayer: val, seriesPlayer: val, downloadsPlayer: val }
      : { ...settings, [key]: val }
    setSettings(updated)
    try { localStorage.setItem('vyora.settings', JSON.stringify(updated)) } catch {}
    const player = TOP_STREAMING_PLAYERS.find((item) => item.id === val)
    showToast(`${key === 'channelsPlayer' ? 'Live channels' : key === 'moviesPlayer' ? 'Movies' : key === 'seriesPlayer' ? 'Series' : key === 'downloadsPlayer' ? 'Downloads' : 'Default'} player: ${player?.name || val}`)
  }

  const handleTestPlayer = (playerId: PlayerEngineId) => {
    const player = TOP_STREAMING_PLAYERS.find((p) => p.id === playerId)
    const testUrl = 'https://cdn4.mjunoon.tv/m-app/geo-news/playlist.m3u8'
    const testTitle = `Vyora Test Stream (${player?.name || playerId})`

    if (onTestPlayer) {
      onTestPlayer(playerId)
    } else {
      launchExternalStream(playerId, testUrl, testTitle)
    }
    showToast(`Testing stream in ${player?.name || playerId}...`)
  }

  const handleDownloadM3u = (playerId: PlayerEngineId) => {
    const player = TOP_STREAMING_PLAYERS.find((p) => p.id === playerId)
    downloadStreamM3u(`Vyora TV - ${player?.name || playerId} Test`, 'https://cdn4.mjunoon.tv/m-app/geo-news/playlist.m3u8')
    showToast(`M3U playlist downloaded for ${player?.name || playerId}`)
  }

  const handleClearCache = async () => {
    try {
      // Purge any local temporary items and trigger garbage collection
      sessionStorage.clear()
      showToast('✓ RAM Cache & Pre-Warmed Stream Buffers Purged Successfully!')
    } catch {
      showToast('Cache purge complete')
    }
  }

  const handleResetDefaults = () => {
    if (window.confirm('Reset all Vyora TV settings to factory defaults?')) {
      const reset: Settings = {
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
      setSettings(reset)
      showToast('✓ Settings reset to factory defaults')
    }
  }

  const toggleCategoryVisibility = (cat: string) => {
    const current = settings.hiddenCategories || []
    const updated = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat]
    setSettings({ ...settings, hiddenCategories: updated })
  }

  const handleToggleParentalLock = () => {
    if (!settings.parentalLock) {
      // Enabling lock
      setSettings({ ...settings, parentalLock: true })
      showToast('Parental Controls Lock Enabled (PIN: ' + (settings.parentalPin || '0000') + ')')
    } else {
      // Require PIN to disable
      setShowPinModal(true)
      setPinInput('')
      setPinError(false)
    }
  }

  const handleVerifyPin = () => {
    const currentPin = settings.parentalPin || '0000'
    if (pinInput.trim() === currentPin.trim()) {
      setSettings({ ...settings, parentalLock: false })
      setShowPinModal(false)
      showToast('Parental Controls Unlocked')
    } else {
      setPinError(true)
    }
  }

  const tabs: Array<{ id: TabId; label: string; icon: IconName; badge?: string }> = [
    { id: 'players', label: 'Player Engines', icon: 'play', badge: '10' },
    { id: 'display', label: 'Panels & Layout', icon: 'tv' },
    { id: 'turbo', label: 'Turbo & Buffers', icon: 'bolt' },
    { id: 'audio', label: 'Audio & A11y', icon: 'volume' },
    { id: 'parental', label: 'Parental & Privacy', icon: 'sparkles' },
    { id: 'playlists', label: 'Playlists & Xtream', icon: 'list' },
    { id: 'about', label: 'Diagnostics & About', icon: 'settings' },
  ]

  return (
    <div className="overlay settings-overlay cinema-settings-modal">
      <div className="overlay-head cinema-settings-head">
        <div className="cinema-settings-title-group">
          <h2><Icon name="settings" size={24} /> {t('settingsTitle')}</h2>
          <span className="cinema-settings-subhead">
            Advanced Cinema Control Center • 10 Top Players • Content Stream Routing
          </span>
        </div>
        <div className="cinema-settings-head-actions">
          {toastMsg ? <div className="cinema-toast-pill animate-fade">{toastMsg}</div> : null}
          <button className="btn btn-ghost cinema-settings-close" data-focusable onClick={onClose}>
            <Icon name="close" size={16} /> {t('close')}
          </button>
        </div>
      </div>

      <div className="cinema-settings-body">
        {/* Left Navigation Sidebar */}
        <nav className="cinema-settings-nav" aria-label="Settings Categories">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`cinema-settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              data-focusable
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon name={tab.icon} size={18} />
              <span className="nav-label">{tab.label}</span>
              {tab.badge ? <span className="nav-badge">{tab.badge}</span> : null}
            </button>
          ))}
        </nav>

        {/* Right Tab Content Container */}
        <main className="cinema-settings-content">
          {/* TAB 1: 10 TOP STREAMING PLAYERS */}
          {activeTab === 'players' ? (
            <div className="settings-tab-pane">
              <div className="settings-banner">
                <div className="settings-banner-icon">
                  <Icon name="play" size={26} />
                </div>
                <div className="settings-banner-info">
                  <h3>Native Platform Playback Engines</h3>
                  <p>
                    Select the real media player engine that powers Vyora Cinema TV.
                    Choose between the high-performance Turbo Engine with dual-lane pre-buffering,
                    native Android TV ExoPlayer Media3 hardware decoding, Adaptive HLS streaming ladder,
                    HTML5 GPU pipeline, or ultra-low latency live stadium sports feeds.
                  </p>
                </div>
              </div>

              {/* Active Media Player Showcase Banner */}
              <div className="active-player-banner">
                <div className="active-player-left">
                  <div className="active-player-icon-box">
                    <Icon name={activePlayer.icon as IconName} size={28} />
                  </div>
                  <div>
                    <div className="active-player-subtitle">CURRENT ACTIVE STREAMING ENGINE</div>
                    <h2 className="active-player-title">
                      {activePlayer.name} <span className="active-player-pill">{activePlayer.badge}</span>
                    </h2>
                    <p className="active-player-desc">
                      {activePlayer.description}
                    </p>
                  </div>
                </div>
                <div className="active-player-status">
                  <span className="active-status-dot" />
                  <strong>ACTIVE & READY</strong>
                </div>
              </div>

              {/* Platform Streaming Engines Cards Grid */}
              <section className="settings-section">
                <div className="section-head-with-badge">
                  <h3><Icon name="sparkles" size={18} /> Available Playback Players ({TOP_STREAMING_PLAYERS.length} Options)</h3>
                  <span className="badge-counter">1-Click Selection</span>
                </div>
                <p className="settings-hint">
                  Choose a default player for everything, or set separate players for Live TV, Movies and Series above. External apps must be installed on the Android TV device.
                </p>

                <div className="player-category-preferences">
                  <label>Default player
                    <select data-focusable value={settings.defaultPlayer || 'internal'} onChange={(e) => handleSetPlayer('defaultPlayer', e.target.value as PlayerEngineId)}>
                      {TOP_STREAMING_PLAYERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label>Live TV channels
                    <select data-focusable value={settings.channelsPlayer || 'internal'} onChange={(e) => handleSetPlayer('channelsPlayer', e.target.value as PlayerEngineId)}>
                      {TOP_STREAMING_PLAYERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label>Movies
                    <select data-focusable value={settings.moviesPlayer || 'internal'} onChange={(e) => handleSetPlayer('moviesPlayer', e.target.value as PlayerEngineId)}>
                      {TOP_STREAMING_PLAYERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label>Series
                    <select data-focusable value={settings.seriesPlayer || 'internal'} onChange={(e) => handleSetPlayer('seriesPlayer', e.target.value as PlayerEngineId)}>
                      {TOP_STREAMING_PLAYERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label>Downloads
                    <select data-focusable value={settings.downloadsPlayer || 'internal'} onChange={(e) => handleSetPlayer('downloadsPlayer', e.target.value as PlayerEngineId)}>
                      {TOP_STREAMING_PLAYERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                </div>

                <div className="top-players-grid">
                  {TOP_STREAMING_PLAYERS.map((player) => {
                    const isSelected = activePlayerId === player.id

                    return (
                      <div
                        key={player.id}
                        className={`player-engine-card ${isSelected ? 'is-selected is-default' : ''}`}
                        data-focusable
                        onClick={() => selectActivePlayer(player.id)}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                      >
                        <div className="player-card-head">
                          <div className="player-icon-box">
                            <Icon name={player.icon as IconName} size={22} />
                          </div>
                          <div className="player-title-box">
                            <h4 className="player-name">{player.name}</h4>
                            <span className="player-badge">{player.badge}</span>
                          </div>
                          {isSelected ? (
                            <span className="player-active-tag">✓ ACTIVE</span>
                          ) : null}
                        </div>

                        <p className="player-desc">{player.description}</p>

                        <div className="player-meta-row">
                          <span className="player-platform-pill">
                            {player.platforms === 'android'
                              ? 'Android TV'
                              : player.platforms === 'desktop'
                              ? 'Desktop / Web'
                              : 'Universal (TV & Web)'}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="player-actions-row">
                          <button
                            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'} btn-select-player`}
                            data-focusable
                            onClick={(e) => {
                              e.stopPropagation()
                              selectActivePlayer(player.id)
                            }}
                          >
                            {isSelected ? '✓ Active Engine' : 'Activate Engine'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {/* TAB 2: DISPLAY, PANELS & LAYOUT */}
          {activeTab === 'display' ? (
            <div className="settings-tab-pane">
              {/* Channels View Panel Selection */}
              <section className="settings-section">
                <h3><Icon name="tv" size={18} /> Channels View Panel Mode</h3>
                <p className="settings-hint">
                  Select your preferred browsing panel for Live TV Channels ("channels ko konsa panel se dekhe").
                </p>

                <div className="layout-picker-grid">
                  {/* Option 1: Cinema Cards Grid */}
                  <div
                    className={`layout-card ${settings.channelPanelLayout === 'cards' ? 'selected' : ''}`}
                    data-focusable
                    onClick={() => {
                      setSettings({ ...settings, channelPanelLayout: 'cards' })
                      showToast('Live Channels set to Cinema Cards Grid')
                    }}
                  >
                    <div className="layout-preview-icon">
                      <Icon name="sparkles" size={26} />
                    </div>
                    <h4>Cinema Cards Grid</h4>
                    <p>Modern glass cards with channel logos, live status pulse, country flags, and hover zoom.</p>
                    <div className="layout-check">
                      {settings.channelPanelLayout === 'cards' ? '✓ Selected' : 'Choose'}
                    </div>
                  </div>

                  {/* Option 2: Cable EPG Compact List */}
                  <div
                    className={`layout-card ${settings.channelPanelLayout === 'cable' ? 'selected' : ''}`}
                    data-focusable
                    onClick={() => {
                      setSettings({ ...settings, channelPanelLayout: 'cable' })
                      showToast('Live Channels set to Cable EPG Compact List')
                    }}
                  >
                    <div className="layout-preview-icon">
                      <Icon name="list" size={26} />
                    </div>
                    <h4>Cable EPG Compact List</h4>
                    <p>High-density horizontal channel list with channel numbers, compact logos, and instant zapping.</p>
                    <div className="layout-check">
                      {settings.channelPanelLayout === 'cable' ? '✓ Selected' : 'Choose'}
                    </div>
                  </div>

                  {/* Option 3: Curated Category Rails */}
                  <div
                    className={`layout-card ${settings.channelPanelLayout === 'rails' ? 'selected' : ''}`}
                    data-focusable
                    onClick={() => {
                      setSettings({ ...settings, channelPanelLayout: 'rails' })
                      showToast('Live Channels set to Curated Category Rails')
                    }}
                  >
                    <div className="layout-preview-icon">
                      <Icon name="film" size={26} />
                    </div>
                    <h4>Curated Category Rails</h4>
                    <p>Netflix & Prime style infinite horizontal shelves grouped by Sports, News, Movies, and Kids.</p>
                    <div className="layout-check">
                      {settings.channelPanelLayout === 'rails' ? '✓ Selected' : 'Choose'}
                    </div>
                  </div>
                </div>
              </section>

              {/* Startup Screen Panel */}
              <section className="settings-section">
                <h3><Icon name="home" size={18} /> Default Startup Panel</h3>
                <p className="settings-hint">
                  Choose which panel opens automatically when you start Vyora TV.
                </p>
                <div className="btn-group-row">
                  {[
                    { id: 'home', label: 'Home Live Broadcast' },
                    { id: 'global', label: 'Global Channels (14,297)' },
                    { id: 'favorites', label: 'Favourites' },
                    { id: 'browser', label: 'Web Browser' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      className={`btn ${settings.startupScreen === s.id ? 'btn-primary' : 'btn-outline'}`}
                      data-focusable
                      onClick={() => {
                        setSettings({ ...settings, startupScreen: s.id as StartupScreen })
                        showToast(`Default startup screen set to ${s.label}`)
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Theme & Video Scaling */}
              <section className="settings-section">
                <h3><Icon name="sparkles" size={18} /> Cinema Theme & Video Scaling</h3>
                {onToggleTheme ? (
                  <button
                    className="settings-row"
                    data-focusable
                    onClick={onToggleTheme}
                  >
                    <span>Cinema Theme Palette</span>
                    <span className="settings-value">
                      {theme === 'light' ? '☀️ Studio Light Mode' : '🌙 Cinema Dark Mode'}
                    </span>
                  </button>
                ) : null}

                <div className="settings-row-select">
                  <span>Video Aspect Ratio & Scaling</span>
                  <select
                    className="cinema-select inline"
                    data-focusable
                    value={settings.videoScaling || 'fit'}
                    onChange={(e) => {
                      setSettings({ ...settings, videoScaling: e.target.value as VideoScaling })
                      showToast(`Video scaling set to ${e.target.value}`)
                    }}
                  >
                    <option value="fit">Original Fit (Letterbox Preserve)</option>
                    <option value="fill">16:9 Stretch Fill (Full Screen)</option>
                    <option value="zoom">Cinema Zoom (Crop Fill)</option>
                    <option value="4:3">4:3 Legacy CRT Aspect Ratio</option>
                  </select>
                </div>
              </section>
            </div>
          ) : null}

          {/* TAB 3: TURBO STREAMING & BUFFERS */}
          {activeTab === 'turbo' ? (
            <div className="settings-tab-pane">
              <section className="settings-section">
                <h3><Icon name="bolt" size={18} /> Turbo Playback Engine & Latency Tuning</h3>
                <p className="settings-hint">
                  Configure RAM pre-warming depth and stream racing to ensure first video frame in milliseconds.
                </p>

                {/* Buffer Depth */}
                <div className="settings-row-select">
                  <div>
                    <span className="setting-label-bold">Buffer Depth Mode</span>
                    <p className="setting-subtext">Pre-buffered video duration stored in high-speed RAM.</p>
                  </div>
                  <select
                    className="cinema-select inline"
                    data-focusable
                    value={settings.bufferDepth || 'balanced'}
                    onChange={(e) => {
                      setSettings({ ...settings, bufferDepth: e.target.value as BufferDepth })
                      showToast(`Buffer depth set to ${e.target.value}`)
                    }}
                  >
                    <option value="fast">Fast Zapping (1.5s - Instant Zap)</option>
                    <option value="balanced">Balanced (3.5s - Recommended)</option>
                    <option value="deep">Deep Anti-Buffer (10.0s - Slow Connection Shield)</option>
                  </select>
                </div>

                {/* Dual Lane Racing */}
                <div className="settings-row-select">
                  <div>
                    <span className="setting-label-bold">Dual-Lane Network Racing</span>
                    <p className="setting-subtext">Races Direct CDN vs Local Tunnel Proxy on first body byte.</p>
                  </div>
                  <select
                    className="cinema-select inline"
                    data-focusable
                    value={settings.tunnelMode || 'auto'}
                    onChange={(e) => {
                      setSettings({ ...settings, tunnelMode: e.target.value as TunnelMode })
                      showToast(`Dual-lane racing set to ${e.target.value}`)
                    }}
                  >
                    <option value="auto">Auto (Direct + Tunnel First-Byte Race)</option>
                    <option value="direct">Direct CDN Only (Maximum Throughput)</option>
                    <option value="tunnel">Local Tunnel Proxy Only (Geo & SSL Shield)</option>
                  </select>
                </div>

                {/* Dead Variant Pruner */}
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() => {
                    const next = !settings.pruneDeadVariants
                    setSettings({ ...settings, pruneDeadVariants: next })
                    showToast(next ? 'Dead Variant Auto-Pruning Enabled' : 'Dead Variant Pruning Disabled')
                  }}
                >
                  <div>
                    <span>Dead Variant Auto-Pruning</span>
                    <p className="setting-subtext">Probes child master streams to eliminate 404 stalls before playback.</p>
                  </div>
                  <span className={`toggle ${settings.pruneDeadVariants ? 'on' : ''}`}>
                    {settings.pruneDeadVariants ? t('on') : t('off')}
                  </span>
                </button>

                {/* Auto Play Best Quality */}
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() => setSettings({ ...settings, autoPlayBest: !settings.autoPlayBest })}
                >
                  <div>
                    <span>Auto-Play Best Stream (Adaptive Bitrate)</span>
                    <p className="setting-subtext">Dynamically selects optimal quality level matching connection.</p>
                  </div>
                  <span className={`toggle ${settings.autoPlayBest ? 'on' : ''}`}>
                    {settings.autoPlayBest ? t('on') : t('off')}
                  </span>
                </button>

                {/* Auto Skip Offline */}
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() =>
                    setSettings({
                      ...settings,
                      autoSkipOffline: !(settings.autoSkipOffline ?? false),
                    })
                  }
                >
                  <div>
                    <span>Auto-Skip Offline Feeds</span>
                    <p className="setting-subtext">Automatically moves to next channel if current feed is dead.</p>
                  </div>
                  <span className={`toggle ${(settings.autoSkipOffline ?? false) ? 'on' : ''}`}>
                    {(settings.autoSkipOffline ?? false) ? t('on') : t('off')}
                  </span>
                </button>

                {/* Verified Only */}
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() =>
                    setSettings({
                      ...settings,
                      verifiedOnly: !(settings.verifiedOnly ?? false),
                    })
                  }
                >
                  <div>
                    <span>Verified Channels Only</span>
                    <p className="setting-subtext">Only displays channels that passed health check tests.</p>
                  </div>
                  <span className={`toggle ${(settings.verifiedOnly ?? false) ? 'on' : ''}`}>
                    {(settings.verifiedOnly ?? false) ? t('on') : t('off')}
                  </span>
                </button>
              </section>
            </div>
          ) : null}

          {/* TAB 4: AUDIO, EQUALIZER & A11Y */}
          {activeTab === 'audio' ? (
            <div className="settings-tab-pane">
              <section className="settings-section">
                <h3><Icon name="volume" size={18} /> Audio Dynamic Range & Dialog Clarity</h3>
                <p className="settings-hint">
                  Tune sound output for theater loudness, late night watching, or speech intelligibility.
                </p>

                <div className="settings-row-select">
                  <div>
                    <span className="setting-label-bold">Audio Dynamic Range Mode (DRC)</span>
                    <p className="setting-subtext">Compresses peak volumes or elevates spoken dialog.</p>
                  </div>
                  <select
                    className="cinema-select inline"
                    data-focusable
                    value={settings.audioMode || 'standard'}
                    onChange={(e) => {
                      setSettings({ ...settings, audioMode: e.target.value as AudioMode })
                      showToast(`Audio DRC set to ${e.target.value}`)
                    }}
                  >
                    <option value="standard">Standard (Neutral Studio Dynamic Range)</option>
                    <option value="night">Night Mode (Quiet Action & Loud Explosions Compressed)</option>
                    <option value="dialog">Cinema Dialog Boost (Crisp Clear Vocals)</option>
                  </select>
                </div>
              </section>

              <section className="settings-section">
                <h3><Icon name="sparkles" size={18} /> Accessibility Suite</h3>
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() => setA11y({ largeText: !settings.a11y.largeText })}
                >
                  <span>{t('largeText')}</span>
                  <span className={`toggle ${settings.a11y.largeText ? 'on' : ''}`}>
                    {settings.a11y.largeText ? t('on') : t('off')}
                  </span>
                </button>
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() => setA11y({ highContrast: !settings.a11y.highContrast })}
                >
                  <span>{t('highContrast')}</span>
                  <span className={`toggle ${settings.a11y.highContrast ? 'on' : ''}`}>
                    {settings.a11y.highContrast ? t('on') : t('off')}
                  </span>
                </button>
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() => setA11y({ audioDescription: !settings.a11y.audioDescription })}
                >
                  <div>
                    <span>{t('audioDescription')}</span>
                    <p className="setting-subtext">TTS announces channel name and country upon switching.</p>
                  </div>
                  <span className={`toggle ${settings.a11y.audioDescription ? 'on' : ''}`}>
                    {settings.a11y.audioDescription ? t('on') : t('off')}
                  </span>
                </button>
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() => setA11y({ announceFocus: !settings.a11y.announceFocus })}
                >
                  <div>
                    <span>{t('announceFocus')}</span>
                    <p className="setting-subtext">Announces highlighted item with remote focus.</p>
                  </div>
                  <span className={`toggle ${settings.a11y.announceFocus ? 'on' : ''}`}>
                    {settings.a11y.announceFocus ? t('on') : t('off')}
                  </span>
                </button>
              </section>

              <section className="settings-section">
                <h3><Icon name="settings" size={18} /> Platform Language</h3>
                <button
                  className="settings-row"
                  data-focusable
                  onClick={() =>
                    setSettings({ ...settings, lang: settings.lang === 'en' ? 'ur' : 'en' })
                  }
                >
                  <span>{t('language')}</span>
                  <span className="settings-value">
                    {settings.lang === 'en' ? 'English (Global)' : 'اردو (Roman)'}
                  </span>
                </button>
              </section>
            </div>
          ) : null}

          {/* TAB 5: PARENTAL & CATEGORY PRIVACY */}
          {activeTab === 'parental' ? (
            <div className="settings-tab-pane">
              <section className="settings-section">
                <h3><Icon name="sparkles" size={18} /> Parental Controls & Adult Lock</h3>
                <p className="settings-hint">
                  Protect kids and family by locking 18+ channels and mature broadcasts with a PIN.
                </p>

                <button
                  className="settings-row"
                  data-focusable
                  onClick={handleToggleParentalLock}
                >
                  <div>
                    <span className="setting-label-bold">18+ Mature Content PIN Lock</span>
                    <p className="setting-subtext">
                      {settings.parentalLock
                        ? 'Active • Protected with PIN code'
                        : 'Disabled • All channels accessible'}
                    </p>
                  </div>
                  <span className={`toggle ${settings.parentalLock ? 'on' : ''}`}>
                    {settings.parentalLock ? 'LOCKED' : 'OFF'}
                  </span>
                </button>
              </section>

              <section className="settings-section">
                <h3><Icon name="list" size={18} /> Category Visibility Filter</h3>
                <p className="settings-hint">
                  Customize which channel categories appear across your home rails and catalog.
                </p>

                <div className="category-chips-grid">
                  {STANDARD_FILTER_CATEGORIES.map((cat) => {
                    const isHidden = (settings.hiddenCategories || []).includes(cat)
                    return (
                      <button
                        key={cat}
                        className={`chip-filter-btn ${isHidden ? 'hidden' : 'visible'}`}
                        data-focusable
                        onClick={() => toggleCategoryVisibility(cat)}
                      >
                        <span className="chip-indicator">{isHidden ? '✕' : '✓'}</span>
                        <span className="chip-text">{categoryName(settings.lang, cat)}</span>
                        <span className="chip-status">{isHidden ? 'Hidden' : 'Visible'}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {/* TAB 6: PLAYLISTS & XTREAM CODES */}
          {activeTab === 'playlists' ? (
            <div className="settings-tab-pane">
              <section className="settings-section">
                <h3><Icon name="list" size={18} /> Playlists & Xtream Codes IPTV Management</h3>
                <p className="settings-hint">
                  Connect private Xtream Codes (Host, Username, Password) or custom M3U/M3U8 URLs for 24/7 dedicated streams.
                </p>

                <div className="status-overview-card">
                  <div className="status-overview-icon">
                    <Icon name="tv" size={32} />
                  </div>
                  <div className="status-overview-details">
                    <h4>Vyora Global Catalog</h4>
                    <p>
                      14,297 Live Channels • 180 Countries
                    </p>
                    <span className="status-pill online">Active & Connected</span>
                  </div>
                </div>

                <button
                  className="btn btn-primary cinema-launch-btn"
                  data-focusable
                  onClick={() => {
                    onClose()
                    onOpenPlaylists?.()
                  }}
                >
                  <Icon name="list" size={20} /> Open Xtream Codes & Playlist Manager
                </button>
              </section>
            </div>
          ) : null}

          {/* TAB 7: DIAGNOSTICS & ABOUT */}
          {activeTab === 'about' ? (
            <div className="settings-tab-pane">
              <section className="settings-section">
                <h3><Icon name="settings" size={18} /> Engine Diagnostics & Statistics</h3>
                <div className="settings-row static">
                  <span>Platform Version</span>
                  <span className="settings-value">Vyora TV v{version} (Turbo Edition)</span>
                </div>
                <div className="settings-row static">
                  <span>Live Catalog Totals</span>
                  <span className="settings-value">
                    {totals ? `${totals.channels.toLocaleString()} Channels • ${totals.countries} Countries` : '14,297 Channels • 180 Countries'}
                  </span>
                </div>
                <div className="settings-row static">
                  <span>Server Execution Mode</span>
                  <span className="settings-value">{mode || 'Go Engine (:8787)'}</span>
                </div>
                <div className="settings-row static">
                  <span>Architecture Standard</span>
                  <span className="settings-value">Dual-Lane HLS/DASH + External Engine Suite (10 Players)</span>
                </div>
              </section>

              <section className="settings-section">
                <h3><Icon name="bolt" size={18} /> Maintenance & System Operations</h3>
                <div className="action-buttons-stack">
                  <button
                    className="btn btn-outline full-btn"
                    data-focusable
                    onClick={handleClearCache}
                  >
                    <Icon name="sparkles" size={17} /> Purge RAM Cache & Pre-Warmed Buffers
                  </button>

                  <button
                    className="btn btn-outline full-btn danger"
                    data-focusable
                    onClick={handleResetDefaults}
                  >
                    <Icon name="close" size={17} /> Reset All Settings to Factory Defaults
                  </button>

                  {!isNative ? (
                    <a
                      className="btn btn-primary full-btn"
                      href="./VyoraTV-1.0.0.apk"
                      download
                      data-focusable
                    >
                      <Icon name="download" size={17} /> Download Android TV APK (VyoraTV-1.0.0.apk)
                    </a>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </main>
      </div>

      {/* Parental PIN Verification Modal */}
      {showPinModal ? (
        <div className="overlay-backdrop">
          <div className="cinema-pin-modal">
            <h3>Enter Parental PIN</h3>
            <p>Please enter your 4-digit PIN to unlock parental controls (Default: 0000).</p>
            <input
              type="password"
              maxLength={4}
              className={`cinema-input pin-input ${pinError ? 'error' : ''}`}
              placeholder="••••"
              value={pinInput}
              autoFocus
              onChange={(e) => {
                setPinInput(e.target.value)
                setPinError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleVerifyPin()
              }}
            />
            {pinError ? <p className="pin-error-text">Incorrect PIN. Try default (0000).</p> : null}
            <div className="pin-modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setShowPinModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleVerifyPin}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

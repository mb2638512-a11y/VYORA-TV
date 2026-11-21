import { useState } from 'react'
import type { CustomPlaylist } from '../types'
import { authXtream, fetchXtreamChannels, importM3UPlaylist } from '../lib/api'
import { Icon } from './Icon'

export function PlaylistsModal({
  activePlaylistId,
  playlists,
  onSelectPlaylist,
  onSavePlaylist,
  onDeletePlaylist,
  onClose,
  t,
}: {
  activePlaylistId: string
  playlists: CustomPlaylist[]
  onSelectPlaylist: (playlist: CustomPlaylist | null) => void
  onSavePlaylist: (playlist: CustomPlaylist) => void
  onDeletePlaylist: (id: string) => void
  onClose: () => void
  t: (key: string) => string
}) {
  const [tab, setTab] = useState<'list' | 'xtream' | 'm3u'>('list')

  // Xtream Form State
  const [xtreamName, setXtreamName] = useState('')
  const [xtreamServer, setXtreamServer] = useState('')
  const [xtreamUser, setXtreamUser] = useState('')
  const [xtreamPass, setXtreamPass] = useState('')
  const [xtreamTesting, setXtreamTesting] = useState(false)
  const [xtreamResult, setXtreamResult] = useState<{
    ok: boolean
    status?: string
    expDate?: string
    maxConnections?: string
    serverMsg?: string
    error?: string
  } | null>(null)

  // M3U Form State
  const [m3uName, setM3uName] = useState('')
  const [m3uUrl, setM3uUrl] = useState('')
  const [m3uTesting, setM3uTesting] = useState(false)
  const [m3uResult, setM3uResult] = useState<{
    ok: boolean
    total?: number
    error?: string
  } | null>(null)

  const [busyAction, setBusyAction] = useState(false)

  // Test Xtream Connection
  const handleTestXtream = async () => {
    if (!xtreamServer.trim() || !xtreamUser.trim() || !xtreamPass.trim()) {
      setXtreamResult({ ok: false, error: 'Please enter server URL, username, and password.' })
      return
    }
    setXtreamTesting(true)
    setXtreamResult(null)
    try {
      const res = await authXtream(xtreamServer.trim(), xtreamUser.trim(), xtreamPass.trim())
      if (res.ok && res.user_info) {
        const u = res.user_info
        let exp = 'Never / Unlimited'
        if (u.exp_date && u.exp_date !== 'null') {
          const timestamp = parseInt(u.exp_date, 10)
          if (!isNaN(timestamp) && timestamp > 0) {
            exp = new Date(timestamp * 1000).toLocaleDateString()
          }
        }
        setXtreamResult({
          ok: true,
          status: u.status || 'Active',
          expDate: exp,
          maxConnections: String(u.max_connections || '1'),
          serverMsg: res.server_info?.server_name || 'Connected',
        })
      } else {
        setXtreamResult({
          ok: false,
          error: res.error || 'Authentication failed. Please check credentials.',
        })
      }
    } catch (err: any) {
      setXtreamResult({
        ok: false,
        error: err?.message || 'Failed to reach Xtream server. Check the URL and try again.',
      })
    } finally {
      setXtreamTesting(false)
    }
  }

  // Save Xtream Playlist
  const handleSaveXtream = async () => {
    if (!xtreamResult?.ok) return
    setBusyAction(true)
    try {
      // Fetch channel count
      let count = 0
      try {
        const streamsRes = await fetchXtreamChannels(
          xtreamServer.trim(),
          xtreamUser.trim(),
          xtreamPass.trim(),
        )
        count = streamsRes.total || streamsRes.channels?.length || 0
      } catch {
        count = 0
      }

      const newPlaylist: CustomPlaylist = {
        id: `xtream-${Date.now()}`,
        name: xtreamName.trim() || `Xtream (${xtreamUser.trim()})`,
        type: 'xtream',
        channelsCount: count,
        addedAt: Date.now(),
        account: {
          id: `acc-${Date.now()}`,
          name: xtreamName.trim() || xtreamUser.trim(),
          server: xtreamServer.trim(),
          username: xtreamUser.trim(),
          password: xtreamPass.trim(),
          status: xtreamResult.status,
          expDate: xtreamResult.expDate,
          activeChannels: count,
          lastConnected: Date.now(),
        },
      }

      onSavePlaylist(newPlaylist)
      onSelectPlaylist(newPlaylist)
      setTab('list')
    } finally {
      setBusyAction(false)
    }
  }

  // Test M3U Import
  const handleTestM3U = async () => {
    if (!m3uUrl.trim()) {
      setM3uResult({ ok: false, error: 'Please enter an M3U playlist URL.' })
      return
    }
    setM3uTesting(true)
    setM3uResult(null)
    try {
      const res = await importM3UPlaylist(m3uUrl.trim())
      if (res.ok && res.total > 0) {
        setM3uResult({
          ok: true,
          total: res.total,
        })
      } else {
        setM3uResult({
          ok: false,
          error: res.error || 'No valid channels found in this M3U URL.',
        })
      }
    } catch (err: any) {
      setM3uResult({
        ok: false,
        error: err?.message || 'Failed to fetch M3U file. Check URL or CORS.',
      })
    } finally {
      setM3uTesting(false)
    }
  }

  // Save M3U Playlist
  const handleSaveM3U = () => {
    if (!m3uResult?.ok) return
    const newPlaylist: CustomPlaylist = {
      id: `m3u-${Date.now()}`,
      name: m3uName.trim() || 'Custom M3U Playlist',
      type: 'm3u',
      url: m3uUrl.trim(),
      channelsCount: m3uResult.total || 0,
      addedAt: Date.now(),
    }
    onSavePlaylist(newPlaylist)
    onSelectPlaylist(newPlaylist)
    setTab('list')
  }

  return (
    <div className="overlay playlists-overlay">
      <div className="overlay-head">
        <h2>
          <Icon name="list" size={24} /> {t('playlistsTitle')}
        </h2>
        <button className="btn btn-ghost" data-focusable onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} /> {t('close')}
        </button>
      </div>

      {/* Tabs */}
      <div className="chips" style={{ marginBottom: '24px' }}>
        <button
          className={`chip ${tab === 'list' ? 'active' : ''}`}
          data-focusable
          onClick={() => setTab('list')}
        >
          <Icon name="list" size={15} /> Saved Playlists ({playlists.length + 1})
        </button>
        <button
          className={`chip ${tab === 'xtream' ? 'active' : ''}`}
          data-focusable
          onClick={() => setTab('xtream')}
        >
          <Icon name="plus" size={15} /> {t('addXtream')}
        </button>
        <button
          className={`chip ${tab === 'm3u' ? 'active' : ''}`}
          data-focusable
          onClick={() => setTab('m3u')}
        >
          <Icon name="plus" size={15} /> {t('addM3U')}
        </button>
      </div>

      {/* TAB 1: SAVED PLAYLISTS */}
      {tab === 'list' && (
        <div className="playlists-list-grid">
          {/* Default Built-in Catalog */}
          <div
            className={`playlist-card ${activePlaylistId === 'default' ? 'active-border' : ''}`}
          >
            <div className="playlist-card-header">
              <span className="badge badge-default">Global Free</span>
              {activePlaylistId === 'default' ? (
                <span className="badge badge-active">
                  <Icon name="check" size={12} /> {t('active')}
                </span>
              ) : null}
            </div>
            <div className="playlist-card-title">{t('defaultPlaylist')}</div>
            <div className="playlist-card-desc">
              14,302 channels across 150+ countries. Filterable by verified live status.
            </div>
            <div className="playlist-card-actions">
              {activePlaylistId === 'default' ? (
                <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.8 }}>
                  <Icon name="check" size={14} /> Selected
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  data-focusable
                  onClick={() => onSelectPlaylist(null)}
                >
                  <Icon name="play" size={14} /> {t('switchPlaylist')}
                </button>
              )}
            </div>
          </div>

          {/* User Custom Playlists */}
          {playlists.map((pl) => {
            const isActive = activePlaylistId === pl.id
            return (
              <div
                key={pl.id}
                className={`playlist-card ${isActive ? 'active-border' : ''}`}
              >
                <div className="playlist-card-header">
                  <span
                    className={`badge ${pl.type === 'xtream' ? 'badge-xtream' : 'badge-m3u'}`}
                  >
                    {pl.type === 'xtream' ? 'Xtream Codes' : 'M3U URL'}
                  </span>
                  {isActive ? (
                    <span className="badge badge-active">
                      <Icon name="check" size={12} /> {t('active')}
                    </span>
                  ) : null}
                </div>
                <div className="playlist-card-title">{pl.name}</div>
                <div className="playlist-card-desc">
                  <div>
                    <strong>Channels:</strong> {pl.channelsCount ?? 'Unknown'}
                  </div>
                  {pl.account?.expDate ? (
                    <div>
                      <strong>{t('expires')}:</strong> {pl.account.expDate}
                    </div>
                  ) : null}
                  {pl.account?.server ? (
                    <div className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                      {pl.account.server}
                    </div>
                  ) : pl.url ? (
                    <div className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                      {pl.url.slice(0, 45)}...
                    </div>
                  ) : null}
                </div>
                <div className="playlist-card-actions">
                  {isActive ? (
                    <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.8 }}>
                      <Icon name="check" size={14} /> Selected
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      data-focusable
                      onClick={() => onSelectPlaylist(pl)}
                    >
                      <Icon name="play" size={14} /> {t('switchPlaylist')}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    data-focusable
                    onClick={() => {
                      if (confirm(`Delete playlist "${pl.name}"?`)) {
                        onDeletePlaylist(pl.id)
                      }
                    }}
                    aria-label="Delete playlist"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TAB 2: ADD XTREAM CODES */}
      {tab === 'xtream' && (
        <div className="playlist-form-container">
          <div className="form-explainer">
            <h3>Connect Xtream Codes IPTV</h3>
            <p>
              Connect your private IPTV subscription to watch high-speed, zero-lag, 24/7 channels
              with your dedicated credentials.
            </p>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>{t('playlistName')}</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. My Premium IPTV"
                value={xtreamName}
                onChange={(e) => setXtreamName(e.target.value)}
                data-focusable
              />
            </div>

            <div className="form-group">
              <label>{t('serverUrl')}</label>
              <input
                type="text"
                className="input-text"
                placeholder="http://iptv.example.com:8080"
                value={xtreamServer}
                onChange={(e) => setXtreamServer(e.target.value)}
                data-focusable
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>{t('username')}</label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="Username"
                  value={xtreamUser}
                  onChange={(e) => setXtreamUser(e.target.value)}
                  data-focusable
                />
              </div>
              <div className="form-group">
                <label>{t('password')}</label>
                <input
                  type="password"
                  className="input-text"
                  placeholder="Password"
                  value={xtreamPass}
                  onChange={(e) => setXtreamPass(e.target.value)}
                  data-focusable
                />
              </div>
            </div>

            {xtreamResult && (
              <div
                className={`result-banner ${xtreamResult.ok ? 'result-success' : 'result-error'}`}
              >
                {xtreamResult.ok ? (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                      <Icon name="check" size={16} /> Connection Successful!
                    </div>
                    <div>Status: {xtreamResult.status}</div>
                    <div>Expiration: {xtreamResult.expDate}</div>
                    <div>Max Connections: {xtreamResult.maxConnections}</div>
                  </div>
                ) : (
                  <div>
                    <Icon name="alert" size={16} /> {xtreamResult.error}
                  </div>
                )}
              </div>
            )}

            <div className="form-actions">
              <button
                className="btn btn-ghost"
                data-focusable
                disabled={xtreamTesting}
                onClick={handleTestXtream}
              >
                <Icon name="refresh" size={16} />{' '}
                {xtreamTesting ? t('testing') : t('testConnection')}
              </button>

              {xtreamResult?.ok && (
                <button
                  className="btn btn-primary"
                  data-focusable
                  disabled={busyAction}
                  onClick={handleSaveXtream}
                >
                  <Icon name="check" size={16} />{' '}
                  {busyAction ? 'Loading Streams...' : 'Save & Switch to this Playlist'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ADD M3U PLAYLIST */}
      {tab === 'm3u' && (
        <div className="playlist-form-container">
          <div className="form-explainer">
            <h3>Add Custom M3U / M3U8 Playlist</h3>
            <p>
              Paste any public or private M3U URL (e.g. GitHub raw URL, cable operator feed, or
              custom stream playlist).
            </p>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>{t('playlistName')}</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. Adeel Wajid Pakistan TV"
                value={m3uName}
                onChange={(e) => setM3uName(e.target.value)}
                data-focusable
              />
            </div>

            <div className="form-group">
              <label>{t('m3uUrl')}</label>
              <input
                type="text"
                className="input-text"
                placeholder="https://example.com/playlist.m3u"
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                data-focusable
              />
            </div>

            {m3uResult && (
              <div className={`result-banner ${m3uResult.ok ? 'result-success' : 'result-error'}`}>
                {m3uResult.ok ? (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                      <Icon name="check" size={16} /> Playlist Verified!
                    </div>
                    <div>Found {m3uResult.total} live channels ready to stream.</div>
                  </div>
                ) : (
                  <div>
                    <Icon name="alert" size={16} /> {m3uResult.error}
                  </div>
                )}
              </div>
            )}

            <div className="form-actions">
              <button
                className="btn btn-ghost"
                data-focusable
                disabled={m3uTesting}
                onClick={handleTestM3U}
              >
                <Icon name="refresh" size={16} /> {m3uTesting ? t('importing') : t('importChannels')}
              </button>

              {m3uResult?.ok && (
                <button className="btn btn-primary" data-focusable onClick={handleSaveM3U}>
                  <Icon name="check" size={16} /> Save & Switch to this Playlist
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

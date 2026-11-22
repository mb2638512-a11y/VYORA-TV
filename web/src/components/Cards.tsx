import { useMemo } from 'react'
import type { Channel, Country, Movie, Series } from '../types'
import type { HealthRecord } from '../lib/api'
import { ChannelLogo } from './ChannelLogo'
import { Icon } from './Icon'

export function ChannelCard({
  channel,
  country,
  onPlay,
  onFavourite,
  onPrefetch,
  favourite,
  status = 'unknown',
}: {
  channel: Channel
  country?: Country
  onPlay: (ch: Channel) => void
  onFavourite?: (ch: Channel) => void
  onPrefetch?: (ch: Channel) => void
  favourite?: boolean
  status?: HealthRecord['status']
}) {
  const quality = channel.streams?.[0]?.label
  const offline = status === 'offline'
  const online = status === 'online'
  const primaryCategory = channel.categories?.[0]

  return (
    <button
      className={`card channel-card ${offline ? 'is-offline' : ''} ${
        online ? 'is-online' : ''
      }`}
      data-focusable
      data-channel-id={channel.id}
      onClick={() => onPlay(channel)}
      onPointerEnter={() => onPrefetch?.(channel)}
      onFocus={() => onPrefetch?.(channel)}
      aria-label={`${channel.name}, ${country?.name ?? channel.country}${
        quality ? `, ${quality}` : ''
      }${status !== 'unknown' ? `, ${status}` : ''}`}
    >
      {online ? (
        <span className="status-tag status-online">
          <span className="status-pulse" aria-hidden="true" />
          <Icon name="signal" size={11} /> LIVE
        </span>
      ) : null}

      {offline ? (
        <span className="status-tag status-offline">
          <Icon name="alert" size={11} /> OFFLINE
        </span>
      ) : null}

      <div className="channel-card-logo">
        <ChannelLogo channel={channel} size="lg" />
        <span
          className={`live-dot ${
            offline ? 'dot-offline' : online ? 'dot-online' : 'dot-unknown'
          }`}
          aria-hidden="true"
        />
        {quality ? <span className="badge-quality card-quality">{quality}</span> : null}

        <div className="channel-card-hover-action" aria-hidden="true">
          <span className="play-glyph">
            <Icon name="play" size={22} />
          </span>
        </div>
      </div>

      <div className="channel-card-meta">
        <div className="channel-card-name" title={channel.name}>
          {channel.name}
        </div>
        <div className="channel-card-sub">
          <div className="channel-card-origin">
            {country ? (
              <span className="mini-flag" aria-hidden="true">
                {country.flag}
              </span>
            ) : null}
            <span className="channel-card-country-name">{country?.name ?? channel.country}</span>
          </div>
          {primaryCategory ? (
            <span className="channel-category-tag">{primaryCategory}</span>
          ) : null}
        </div>
      </div>

      {onFavourite ? (
        <span
          className={`fav-btn ${favourite ? 'is-fav' : ''}`}
          role="button"
          tabIndex={-1}
          aria-hidden="true"
          title={favourite ? 'Remove from Favourites' : 'Add to Favourites'}
          onClick={(e) => {
            e.stopPropagation()
            onFavourite(channel)
          }}
        >
          <Icon name={favourite ? 'star-filled' : 'star'} size={18} />
        </span>
      ) : null}
    </button>
  )
}

export function CountryCard({
  country,
  onOpen,
}: {
  country: Country & { flagLocal?: string }
  onOpen: (code: string) => void
}) {
  const flag = country.flagLocal || country.flagImg
  return (
    <button
      className="card country-card"
      data-focusable
      onClick={() => onOpen(country.code)}
      aria-label={`${country.name}, ${country.count} channels`}
    >
      <div className="country-flag-wrap">
        {flag ? (
          <img className="country-flag-img" src={flag} alt="" aria-hidden="true" loading="lazy" />
        ) : (
          <span className="country-flag-emoji" aria-hidden="true">
            {country.flag}
          </span>
        )}
      </div>
      <div className="country-name" title={country.name}>{country.name}</div>
      <div className="country-count-badge">
        <Icon name="tv" size={11} /> {country.count}
      </div>
    </button>
  )
}

export function ThemeCard({
  id,
  name,
  count,
  onOpen,
}: {
  id: string
  name: string
  count: number
  onOpen: (id: string) => void
}) {
  return (
    <button
      className="card theme-card"
      data-focusable
      onClick={() => onOpen(id)}
      aria-label={`${name}, ${count} channels`}
    >
      <div className="theme-card-icon">
        <Icon name={id === 'sports' ? 'signal' : id === 'news' ? 'globe' : id === 'movies' ? 'film' : id === 'music' ? 'volume' : 'grid'} size={20} />
      </div>
      <div className="theme-name">{name}</div>
      <div className="theme-count">{count} channels</div>
    </button>
  )
}

export function MovieCard({
  movie,
  onPlay,
}: {
  movie: Movie
  onPlay: (m: Movie) => void
}) {
  const durationText = useMemo(() => {
    if (!movie.duration) return null
    if (typeof movie.duration === 'string') return movie.duration
    // VOD catalogue durations are stored in minutes (not seconds).
    const durationMin = Math.round(movie.duration)
    return durationMin > 0 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : null
  }, [movie.duration])

  return (
    <button
      className="card movie-card"
      data-focusable
      onClick={() => onPlay(movie)}
      aria-label={`${movie.title}, ${movie.genre}${movie.year ? `, ${movie.year}` : ''}`}
    >
      <div className="movie-poster-wrap">
        {movie.logo ? (
          <img
            className="movie-poster"
            src={movie.logo}
            alt={movie.title}
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLElement).style.display = 'none'
            }}
          />
        ) : null}
        <div className="movie-poster-fallback">
          <Icon name="play" size={32} />
        </div>
        <div className="movie-card-badges">
          {movie.rating ? (
            <span className="badge-rating" title={`Rating: ${movie.rating}`}>
              ⭐ {movie.rating}
            </span>
          ) : (
            <span className="badge-quality movie-genre-badge">{movie.genre || 'Cinema'}</span>
          )}
          {movie.quality ? (
            <span className="badge-res-pill">{movie.quality}</span>
          ) : movie.year ? (
            <span className="badge-year">{movie.year}</span>
          ) : null}
        </div>
        <div className="movie-hover-overlay" aria-hidden="true">
          <span className="movie-play-btn">
            <Icon name="play" size={26} />
          </span>
          <span className="movie-hover-watch">WATCH NOW</span>
        </div>
      </div>
      <div className="movie-card-meta">
        <div className="movie-card-title" title={movie.title}>{movie.title}</div>
        <div className="movie-card-sub">
          {movie.year ? <span className="movie-meta-year">{movie.year}</span> : null}
          {durationText ? <span>• {durationText}</span> : <span>• VOD Cinema</span>}
          {movie.genre ? <span className="movie-meta-genre">• {movie.genre}</span> : null}
        </div>
      </div>
    </button>
  )
}

export function SeriesCard({
  series,
  onOpen,
}: {
  series: Series
  onOpen: (s: Series) => void
}) {
  const epCount = series.episodes?.length || 0

  return (
    <button
      className="card series-card"
      data-focusable
      onClick={() => onOpen(series)}
      aria-label={`${series.title}, ${series.genre}, ${epCount} episodes`}
    >
      <div className="movie-poster-wrap">
        {series.logo ? (
          <img
            className="movie-poster"
            src={series.logo}
            alt={series.title}
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLElement).style.display = 'none'
            }}
          />
        ) : null}
        <div className="movie-poster-fallback">
          <Icon name="grid" size={32} />
        </div>
        <div className="movie-card-badges">
          <span className="badge-quality movie-genre-badge">{series.genre}</span>
          <span className="badge-year">{epCount} Ep{epCount === 1 ? '' : 's'}</span>
        </div>
        <div className="movie-hover-overlay" aria-hidden="true">
          <span className="movie-play-btn">
            <Icon name="play" size={26} />
          </span>
        </div>
      </div>
      <div className="movie-card-meta">
        <div className="movie-card-title" title={series.title}>{series.title}</div>
        <div className="movie-card-sub">
          <span>TV Series • {epCount} Episodes</span>
        </div>
      </div>
    </button>
  )
}

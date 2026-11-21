import { useEffect, useMemo, useRef, useState } from 'react'
import type { Channel } from '../types'
import { Icon } from './Icon'
import { ChannelCard } from './Cards'
import { searchChannels } from '../lib/api'
import { useChannelHealth, statusOf } from '../hooks/useChannelHealth'

const KEYS = [
  'abcdefghijklmnopqrstuvwxyz'.split(''),
  '1234567890'.split(''),
  ' -'.split(''),
]

export function SearchOverlay({
  onClose,
  onPlay,
  t,
}: {
  onClose: () => void
  onPlay: (ch: Channel) => void
  t: (key: string) => string
  lang: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Channel[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      try {
        const r = await searchChannels(query)
        setResults(r)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [query])

  const resultIds = useMemo(() => results.map((c) => c.id), [results])
  const statuses = useChannelHealth(resultIds)

  const press = (key: string) => {
    if (key === 'backspace') setQuery((q) => q.slice(0, -1))
    else if (key === 'space') setQuery((q) => q + ' ')
    else setQuery((q) => q + key)
  }

  return (
    <div className="overlay search-overlay">
      <div className="overlay-head">
        <h2><Icon name="search" size={22} /> {t('search')}</h2>
        <div className="search-box" aria-live="polite">
          <span>{query || t('searchHint')}</span>
          <span className="caret" aria-hidden="true" />
        </div>
        <button className="btn btn-ghost" data-focusable onClick={onClose}>
          <Icon name="close" size={16} /> {t('close')}
        </button>
      </div>

      <div className="keyboard" role="group" aria-label="on-screen keyboard">
        {KEYS.map((keys, r) => (
          <div className="kb-row" key={r}>
            {keys.map((k) => (
              <button
                key={k}
                className="kb-key"
                data-focusable
                onClick={() => press(k)}
                aria-label={k === ' ' ? 'space' : k}
              >
                {k === ' ' ? 'space' : k}
              </button>
            ))}
            {r === 2 ? (
              <button
                className="kb-key kb-back"
                data-focusable
                onClick={() => press('backspace')}
              >
                <Icon name="chevron-left" size={20} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="search-results">
        <div className="search-results-head">
          <span>
            {t('resultsFor')} {query ? `‘${query}’` : ''}
          </span>
          <span className="muted">
            {searching ? '...' : `${results.length} ${t('channels')}`}
          </span>
        </div>
        {results.length === 0 && query && !searching ? (
          <div className="empty">{t('noResults')}</div>
        ) : null}
        <div className="grid grid-channels">
          {results.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              onPlay={onPlay}
              status={statusOf(statuses, ch.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

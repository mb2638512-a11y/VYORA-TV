import { useEffect, useRef, useState } from 'react'
import type { Channel } from '../types'
import { logoUrl } from '../lib/api'

/**
 * Channel logo with a resilient fallback chain:
 *   1. real logo from the IPTV directory (logos.json)
 *   2. broadcaster favicon (duckduckgo icon service) derived from the website
 *   3. generated letter tile (always works, offline)
 *
 * The image is only requested when the card is close to the viewport - a grid
 * can hold hundreds of channels and loading every logo at once starves the
 * browser's 6 connection slots.
 */
export function ChannelLogo({
  channel,
  logo,
  name,
  size = 'md',
  className = '',
}: {
  channel?: Channel
  logo?: string
  name?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const [inView, setInView] = useState(false)
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const effectiveChannel: Channel = channel || {
    id: logo || name || 'ch-default',
    name: name || 'TV',
    alt: [],
    network: '',
    owner: '',
    categories: [],
    country: '',
    website: '',
    logo: logo || '',
    icon: '',
    launched: null,
    closed: null,
    lang: 'en',
    streams: [],
  }

  useEffect(() => {
    const el = boxRef.current
    if (!el || inView) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  useEffect(() => {
    setIndex(0)
    setFailed(false)
  }, [effectiveChannel.id])

  const candidates: string[] = []
  if (effectiveChannel.logo) {
    candidates.push(logoUrl(effectiveChannel.logo))
    if (candidates[0] !== effectiveChannel.logo) candidates.push(effectiveChannel.logo)
  }
  if (effectiveChannel.website) {
    try {
      const host = new URL(effectiveChannel.website).hostname.replace(/^www\./, '')
      if (host) candidates.push(`https://icons.duckduckgo.com/ip3/${host}.ico`)
    } catch {
      /* no website */
    }
  }

  const src = candidates[index]

  return (
    <div
      ref={boxRef}
      className={`logo-box logo-box-${size} ${className}`}
      aria-hidden={failed ? 'true' : undefined}
    >
      {!inView ? null : !src || failed ? (
        <LetterTile channel={effectiveChannel} size={size} />
      ) : (
        <img
          className={`logo logo-${size}`}
          src={src}
          alt={`${effectiveChannel.name} logo`}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (index + 1 < candidates.length) setIndex((i) => i + 1)
            else setFailed(true)
          }}
        />
      )}
    </div>
  )
}

export function LetterTile({
  channel,
  size = 'md',
  className = '',
}: {
  channel?: Channel
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const chName = channel?.name || 'TV'
  const chId = channel?.id || 'tv'
  const initials = chName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  const hue = hashHue(chId)
  return (
    <div
      className={`logo logo-${size} logo-tile ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 65% 38%), hsl(${(hue + 40) % 360} 70% 22%))`,
      }}
      aria-hidden="true"
    >
      <span>{initials || 'TV'}</span>
    </div>
  )
}

function hashHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

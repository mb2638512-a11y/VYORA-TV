import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

type ShellProps = {
  left?: ReactNode
  right?: ReactNode
  clock?: string
  onBrandClick?: () => void
  onMenuToggle?: () => void
  menuOpen?: boolean
}

function Brand({ onClick, compact = false }: { onClick?: () => void; compact?: boolean }) {
  return (
    <button
      className={`brand ${compact ? 'brand-compact' : ''}`}
      data-focusable
      onClick={onClick}
      aria-label="Vyora Cinema TV Home"
      title="Vyora Cinema TV"
    >
      <span className="brand-mark">
        <span className="brand-mark-inner">V</span>
        <span className="brand-mark-glow" aria-hidden="true" />
      </span>
      <span className="brand-titles">
        <span className="brand-name">VYORA<span className="brand-accent">TV</span></span>
        {!compact ? <span className="brand-edition">CINEMA PRO</span> : null}
      </span>
    </button>
  )
}

function Clock({ value }: { value?: string }) {
  return value ? (
    <div className="clock-pill" title="Current Local Time">
      <Icon name="clock" size={13} />
      <span className="clock-digits">{value}</span>
    </div>
  ) : null
}

/** Touch-first phone shell: compact app bar + persistent bottom navigation. */
function PhoneNavigationShell({ left, right, clock, onBrandClick, onMenuToggle, menuOpen }: ShellProps) {
  return (
    <div className="device-shell device-shell-phone" data-shell="phone">
      <header className="topbar topbar-phone">
        <div className="topbar-left">
          <Brand onClick={onBrandClick} compact />
        </div>
        <div className="topbar-right">
          <button type="button" className="phone-menu-toggle" onClick={onMenuToggle}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={Boolean(menuOpen)} title={menuOpen ? 'Close menu' : 'All sections'}>
            <Icon name="menu" size={19} />
          </button>
          <Clock value={clock} />
        </div>
      </header>
      <nav className={`mobile-bottom-nav phone-tab-shell${menuOpen ? ' menu-open' : ''}`}
        aria-label="Primary phone navigation"
        onClick={() => { if (menuOpen) onMenuToggle?.() }}>
        <div className="phone-menu-panel" onClick={(event) => event.stopPropagation()}>
          {left}
          <div className="phone-utility-actions">{right}</div>
        </div>
      </nav>
    </div>
  )
}

/** Ten-foot TV shell: wide header navigation with large remote-focus targets. */
function TvNavigationShell({ left, right, clock, onBrandClick }: ShellProps) {
  return (
    <div className="device-shell device-shell-tv" data-shell="tv">
      <header className="topbar topbar-tv">
        <div className="topbar-left">
          <Brand onClick={onBrandClick} />
          <div className="topbar-nav-wrapper">{left}</div>
        </div>
        <div className="topbar-right">{right}<Clock value={clock} /></div>
      </header>
    </div>
  )
}

/** Desktop retains its conventional header layout. */
function DesktopNavigationShell({ left, right, clock, onBrandClick }: ShellProps) {
  return (
    <div className="device-shell device-shell-desktop" data-shell="desktop">
      <header className="topbar">
        <div className="topbar-left">
          <Brand onClick={onBrandClick} />
          <div className="topbar-nav-wrapper">{left}</div>
        </div>
        <div className="topbar-right">{right}<Clock value={clock} /></div>
      </header>
    </div>
  )
}

function detectShellDevice(): 'phone' | 'tv' | 'desktop' {
  const bridge = window.VyoraBridge
  if (bridge?.isTvDevice?.() === true) return 'tv'
  if (window.matchMedia('(max-width: 768px)').matches || /Android/i.test(navigator.userAgent)) return 'phone'
  return 'desktop'
}

export function TopBar(props: ShellProps) {
  const [device, setDevice] = useState<'phone' | 'tv' | 'desktop'>(() =>
    document.documentElement.dataset.device === 'tv' ? 'tv' :
      document.documentElement.dataset.device === 'phone' ? 'phone' : 'desktop',
  )

  // Browser previews and rotated phones can change layout after first paint.
  // Native TV detection always takes precedence over viewport size.
  useEffect(() => {
    const updateDevice = () => {
      const next = detectShellDevice()
      document.documentElement.dataset.device = next
      document.body.classList.remove('device-phone', 'device-tv', 'device-desktop')
      document.body.classList.add('device-' + next)
      setDevice(next)
    }
    window.addEventListener('resize', updateDevice)
    window.addEventListener('orientationchange', updateDevice)
    updateDevice()
    return () => {
      window.removeEventListener('resize', updateDevice)
      window.removeEventListener('orientationchange', updateDevice)
    }
  }, [])

  if (device === 'phone') return <PhoneNavigationShell {...props} />
  if (device === 'tv') return <TvNavigationShell {...props} />
  return <DesktopNavigationShell {...props} />
}

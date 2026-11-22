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
function PhoneNavigationShell({ left, right, clock, onBrandClick }: ShellProps) {
  return (
    <div className="device-shell device-shell-phone" data-shell="phone">
      <header className="topbar topbar-phone">
        <div className="topbar-left">
          <Brand onClick={onBrandClick} compact />
        </div>
        <div className="topbar-right">{right}<Clock value={clock} /></div>
      </header>
      <nav className="mobile-bottom-nav phone-tab-shell" aria-label="Primary phone navigation">
        {left}
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

export function TopBar(props: ShellProps) {
  const device = document.documentElement.dataset.device || 'desktop'
  if (device === 'phone') return <PhoneNavigationShell {...props} />
  if (device === 'tv') return <TvNavigationShell {...props} />
  return <DesktopNavigationShell {...props} />
}

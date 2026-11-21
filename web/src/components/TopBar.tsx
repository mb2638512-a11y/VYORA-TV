import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function TopBar({
  left,
  right,
  clock,
  onBrandClick,
  onMenuToggle,
  menuOpen,
}: {
  left?: ReactNode
  right?: ReactNode
  clock?: string
  onBrandClick?: () => void
  onMenuToggle?: () => void
  menuOpen?: boolean
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {onMenuToggle ? (
          <button
            className="mobile-menu-btn"
            data-focusable
            onClick={onMenuToggle}
            aria-label={menuOpen ? 'Close Menu' : 'Open Menu'}
            title="Navigation Menu"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
          </button>
        ) : null}

        <button
          className="brand"
          data-focusable
          onClick={onBrandClick}
          aria-label="Vyora Cinema TV Home"
          title="Vyora Cinema TV"
        >
          <span className="brand-mark">
            <span className="brand-mark-inner">V</span>
            <span className="brand-mark-glow" aria-hidden="true" />
          </span>
          <div className="brand-titles">
            <span className="brand-name">
              VYORA<span className="brand-accent">TV</span>
            </span>
            <span className="brand-edition">CINEMA PRO</span>
          </div>
        </button>

        <div className="topbar-nav-wrapper">{left}</div>
      </div>

      <div className="topbar-right">
        {right}
        {clock ? (
          <div className="clock-pill" title="Current Local Time">
            <Icon name="clock" size={13} />
            <span className="clock-digits">{clock}</span>
          </div>
        ) : null}
      </div>
    </header>
  )
}

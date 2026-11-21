/**
 * Spatial (D-pad) navigation for TV remotes.
 *
 * Every focusable element registers itself with `data-focusable`. Arrow keys
 * move the focus to the closest element in that direction using real geometry,
 * which is what makes a grid of channel cards feel natural on a remote.
 */

const FOCUSABLE = '[data-focusable]:not([data-focusable="false"])'

export function getFocusables(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
}

type Dir = 'up' | 'down' | 'left' | 'right'

export function findNeighbor(current: HTMLElement, dir: Dir): HTMLElement | null {
  const items = getFocusables()
  if (items.length === 0) return null
  const cur = current.getBoundingClientRect()
  const curCx = cur.left + cur.width / 2
  const curCy = cur.top + cur.height / 2

  let best: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const el of items) {
    if (el === current) continue
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let score = Number.POSITIVE_INFINITY

    if (dir === 'right') {
      if (cx <= curCx + 4) continue
      score = cx - curCx + Math.abs(cy - curCy) * 3
    } else if (dir === 'left') {
      if (cx >= curCx - 4) continue
      score = curCx - cx + Math.abs(cy - curCy) * 3
    } else if (dir === 'down') {
      if (cy <= curCy + 4) continue
      score = cy - curCy + Math.abs(cx - curCx) * 3
    } else {
      if (cy >= curCy - 4) continue
      score = curCy - cy + Math.abs(cx - curCx) * 3
    }

    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

let handler: ((e: KeyboardEvent) => void) | null = null

export interface NavOptions {
  onFocus?: (el: HTMLElement) => void
  onBack?: () => void
  onEnter?: (el: HTMLElement) => void
  onChannelUp?: () => void
  onChannelDown?: () => void
  onKey?: (e: KeyboardEvent) => void
  enabled?: boolean
}

/** Installs the global remote-control key handler. */
export function installNavigation(opts: NavOptions) {
  if (handler) window.removeEventListener('keydown', handler)
  handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    const inInput =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)

    const key = e.key

    // Back / Escape always work (even while the player is open).
    if (key === 'Backspace' || key === 'Escape') {
      if (inInput) return
      opts.onBack?.()
      e.preventDefault()
      return
    }

    if (opts.enabled === false) {
      opts.onKey?.(e)
      return
    }

    if (key === 'ChannelUp' || key === 'PageUp' || e.keyCode === 166) {
      opts.onChannelUp?.()
      e.preventDefault()
      return
    }
    if (key === 'ChannelDown' || key === 'PageDown' || e.keyCode === 167) {
      opts.onChannelDown?.()
      e.preventDefault()
      return
    }

    if (inInput) return

    const dir: Dir | null =
      key === 'ArrowUp'
        ? 'up'
        : key === 'ArrowDown'
          ? 'down'
          : key === 'ArrowLeft'
            ? 'left'
            : key === 'ArrowRight'
              ? 'right'
              : null

    if (dir) {
      const active = document.activeElement as HTMLElement | null
      const current = active && active.matches(FOCUSABLE) ? active : null
      const next = current ? findNeighbor(current, dir) : getFocusables()[0]
      if (next) {
        next.focus({ preventScroll: false })
        next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
        opts.onFocus?.(next)
      }
      e.preventDefault()
      return
    }

    if (key === 'Enter' || key === ' ') {
      const active = document.activeElement as HTMLElement | null
      if (active && active.matches(FOCUSABLE) && active.tagName !== 'BUTTON') {
        active.click()
        e.preventDefault()
        return
      }
      opts.onEnter?.(active as HTMLElement)
    }

    opts.onKey?.(e)
  }
  window.addEventListener('keydown', handler)
  return () => {
    if (handler) window.removeEventListener('keydown', handler)
    handler = null
  }
}

/** Scroll a row so the focused item is visible (used by horizontal rows). */
export function ensureVisible(el: HTMLElement) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

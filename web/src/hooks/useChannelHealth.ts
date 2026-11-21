import { useEffect, useMemo, useState } from 'react'
import {
  fetchStatuses,
  getHealthRecord,
  initHealthStream,
  onHealthChange,
  trackStatuses,
  type HealthRecord,
} from '../lib/api'

/**
 * Live online/offline state for channels on screen in real time via SSE.
 *
 * Automatically subscribes to SSE stream from server and triggers instant
 * component updates whenever any channel status changes.
 */
export function useChannelHealth(ids: string[]): Record<string, HealthRecord> {
  const [statuses, setStatuses] = useState<Record<string, HealthRecord>>(() => {
    const initial: Record<string, HealthRecord> = {}
    for (const id of ids) {
      const rec = getHealthRecord(id)
      if (rec) initial[id] = rec
    }
    return initial
  })

  const key = useMemo(() => ids.join(','), [ids])

  useEffect(() => {
    initHealthStream()
    if (!ids.length) return
    let alive = true

    // Request server to prioritize probing these channels
    void trackStatuses(ids)

    // Sync from local health registry immediately
    const syncFromRegistry = () => {
      if (!alive) return
      setStatuses((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of ids) {
          const rec = getHealthRecord(id)
          if (rec && (!prev[id] || prev[id].status !== rec.status || prev[id].ts !== rec.ts)) {
            next[id] = rec
            changed = true
          }
        }
        return changed ? next : prev
      })
    }

    syncFromRegistry()
    const unsubscribe = onHealthChange(syncFromRegistry)

    // Fast initial fetch and periodic fallback polling
    const poll = async () => {
      if (!alive) return
      const data = await fetchStatuses(ids)
      if (!alive) return
      setStatuses((prev) => ({ ...prev, ...data }))
    }

    void poll()
    const timer = setInterval(poll, 8000)

    return () => {
      alive = false
      unsubscribe()
      clearInterval(timer)
    }
  }, [key])

  return statuses
}

/** Status of a single channel: 'online' | 'offline' | 'unknown'. */
export function statusOf(
  statuses: Record<string, HealthRecord>,
  id: string,
): HealthRecord['status'] {
  const rec = statuses[id] || getHealthRecord(id)
  if (!rec) return 'unknown'
  if (rec.status === 'online') return 'online'
  if (rec.status === 'offline') return 'offline'
  return 'unknown'
}

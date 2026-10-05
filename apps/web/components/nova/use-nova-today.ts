'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NovaTodayView } from '@repo/api/nova/product/today.types'

const REFRESH_MS = 60_000

// Loads GET /api/nova/today. The page renders what comes back and decides
// nothing: no ranking, no fallback recommendation.
export function useNovaToday(availableMinutes: number | null) {
  const [view, setView]             = useState<NovaTodayView | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState(false)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latest.current
    setRefreshing(true)
    try {
      const query = availableMinutes ? `?minutes=${availableMinutes}` : ''
      const res   = await fetch(`/api/nova/today${query}`, { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/signin'; return }
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as NovaTodayView
      if (request !== latest.current) return   // a newer request is in flight
      setView(json)
      setError(false)
    } catch {
      if (request === latest.current) setError(true)
    } finally {
      if (request === latest.current) { setLoading(false); setRefreshing(false) }
    }
  }, [availableMinutes])

  useEffect(() => {
    void load()
    const interval  = setInterval(() => { if (!document.hidden) void load() }, REFRESH_MS)
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  return { view, loading, refreshing, error, refresh: load }
}

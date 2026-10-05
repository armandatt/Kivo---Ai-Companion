'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const REFRESH_MS = 60_000

// Loads one of Nova's read models and keeps it fresh. The page renders what
// comes back and decides nothing: no ranking, no fallback, no local planning.
export function useNovaView<T>(url: string) {
  const [view, setView]             = useState<T | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState(false)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latest.current
    setRefreshing(true)
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/signin'; return }
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as T
      if (request !== latest.current) return   // a newer request is in flight
      setView(json)
      setError(false)
    } catch {
      if (request === latest.current) setError(true)
    } finally {
      if (request === latest.current) { setLoading(false); setRefreshing(false) }
    }
  }, [url])

  useEffect(() => {
    void load()
    const interval  = setInterval(() => { if (!document.hidden) void load() }, REFRESH_MS)
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  return { view, loading, refreshing, error, refresh: load }
}

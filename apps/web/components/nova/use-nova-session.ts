'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NovaSessionResponse, NovaSessionView } from '@repo/api/nova/product/today.types'
import { fetchSession, sendSessionCommand } from './nova-api'

const SYNC_MS = 30_000

type Synced = { session: NovaSessionView | null; at: number }

// The running study session, as the server records it. The clock shown is
// the server's elapsed time plus the time since it was read; pausing,
// resuming and ending are server commands. Nothing is kept only in the page.
export function useNovaSession() {
  const [synced, setSynced]   = useState<Synced | null>(null)
  const [ended, setEnded]     = useState<{ topicName: string | null; minutes: number } | null>(null)
  const [pending, setPending] = useState<'pause' | 'resume' | 'end' | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)   // this account cannot have a session
  const [now, setNow]         = useState(() => Date.now())

  const apply = useCallback((res: NovaSessionResponse) => {
    if (res.ok) {
      setSynced({ session: res.session, at: Date.now() })
      setNow(Date.now())
      if (res.ended) setEnded(res.ended)
      setError(null)
      return
    }
    if (res.error === 'unauthenticated') { window.location.href = '/signin'; return }
    if (res.error === 'not_nova' || res.error === 'not_connected' || res.error === 'onboarding_incomplete') {
      setBlocked(res.message)
      return
    }
    setError(res.message)
  }, [])

  const sync = useCallback(async () => apply(await fetchSession()), [apply])

  useEffect(() => {
    void sync()
    const interval  = setInterval(() => { if (!document.hidden) void sync() }, SYNC_MS)
    const onVisible = () => { if (!document.hidden) void sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [sync])

  const running = synced?.session?.status === 'in_progress'
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [running])

  const command = useCallback(async (action: 'pause' | 'resume' | 'end') => {
    setPending(action)
    apply(await sendSessionCommand({ action }))
    setPending(null)
  }, [apply])

  const session = synced?.session ?? null
  const elapsedSeconds = session
    ? session.elapsedSeconds + (running && synced ? Math.max(0, (now - synced.at) / 1000) : 0)
    : 0

  return { loading: synced === null && !blocked && !error, session, elapsedSeconds, ended, pending, error, blocked, command, retry: sync }
}

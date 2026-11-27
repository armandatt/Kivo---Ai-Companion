'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NovaAutoSavedSession, NovaSessionOutcome, NovaSessionResponse, NovaSessionView } from '@repo/api/nova/product/today.types'
import { fetchSession, sendSessionCommand } from './nova-api'

const SYNC_MS = 30_000
// Auto-saved sessions the learner has already been told about (dismissed), by id.
const SEEN_SAVED = 'kivo:auto-saved-seen'
function seenSaved(): string[] { try { return JSON.parse(localStorage.getItem(SEEN_SAVED) ?? '[]') as string[] } catch { return [] } }

type Synced = { session: NovaSessionView | null; at: number }
type Ended  = NonNullable<Extract<NovaSessionResponse, { ok: true }>['ended']>

// The running study session, as the server records it. The clock shown is
// the server's elapsed time plus the time since it was read; pausing,
// resuming and ending are server commands. Nothing is kept only in the page.
export function useNovaSession() {
  const [synced, setSynced]   = useState<Synced | null>(null)
  const [ended, setEnded]     = useState<Ended | null>(null)
  const [pending, setPending] = useState<'pause' | 'resume' | 'end' | 'start' | 'details' | 'topic' | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)   // this account cannot have a session
  const [now, setNow]         = useState(() => Date.now())
  // A paused session the server saved for the learner (item 1, 28 Nov): shown
  // until dismissed, once per session.
  const [autoSaved, setAutoSaved] = useState<NovaAutoSavedSession | null>(null)

  const apply = useCallback((res: NovaSessionResponse) => {
    if (res.ok) {
      setSynced({ session: res.session, at: Date.now() })
      setNow(Date.now())
      if (res.ended) setEnded(res.ended)
      if (res.session) setAutoSaved(null)
      else if (res.autoSaved && !seenSaved().includes(res.autoSaved.sessionId)) setAutoSaved(res.autoSaved)
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

  const command = useCallback(async (action: 'pause' | 'resume') => {
    setPending(action)
    apply(await sendSessionCommand({ action }))
    setPending(null)
  }, [apply])

  // Ending carries the learner's answer to "How did it go?". It is the one
  // thing in the session's report that says how the studying went.
  const end = useCallback(async (outcome: NovaSessionOutcome) => {
    setPending('end')
    apply(await sendSessionCommand({ action: 'end', outcome }))
    setPending(null)
  }, [apply])

  // A running session's length, changed: longer, or 0 for no time limit.
  const setLength = useCallback(async (minutes: number) => {
    setPending('resume')
    apply(await sendSessionCommand({ action: 'set_length', minutes }))
    setPending(null)
  }, [apply])

  // Quick Focus: a session at once, with no task, no topic and no time limit,
  // through the ordinary start command. Details can be added while it runs.
  const quickStart = useCallback(async () => {
    setPending('start'); setEnded(null)
    const res = await sendSessionCommand({ action: 'start', topicName: null, subjectName: null, plannedMinutes: 0, label: 'Quick focus' })
    apply(res)
    setPending(null)
    return res.ok && res.session !== null
  }, [apply])

  // A running session's optional details (title, category, description).
  const setDetails = useCallback(async (details: { title?: string | null; category?: string | null; description?: string | null }) => {
    setPending('details')
    const res = await sendSessionCommand({ action: 'set_details', ...details })
    apply(res)
    setPending(null)
    return res.ok
  }, [apply])

  // What a session with no topic was on, chosen before it ends (set_topic).
  const setTopic = useCallback(async (subjectId: string, topicName: string) => {
    setPending('topic')
    const res = await sendSessionCommand({ action: 'set_topic', subjectId, topicName })
    apply(res)
    setPending(null)
    return res.ok
  }, [apply])

  const dismissAutoSaved = useCallback(() => {
    setAutoSaved(a => {
      if (a) { try { localStorage.setItem(SEEN_SAVED, JSON.stringify([...seenSaved(), a.sessionId].slice(-20))) } catch { /* storage off */ } }
      return null
    })
  }, [])

  // A finished session with no topic, filed afterwards (items 3/4, 28 Nov).
  const fileSession = useCallback(async (sessionId: string, subjectId: string, topicName: string) => {
    setPending('topic')
    const res = await sendSessionCommand({ action: 'file', sessionId, subjectId, topicName })
    setPending(null)
    // The asking card says "Filed on …" itself; the ended record stays what the
    // End recorded (filing later moves no mastery, so it claims none).
    return res.ok && Boolean(res.filed)
  }, [])

  const session = synced?.session ?? null
  const elapsedSeconds = session
    ? session.elapsedSeconds + (running && synced ? Math.max(0, (now - synced.at) / 1000) : 0)
    : 0

  return { loading: synced === null && !blocked && !error, session, elapsedSeconds, ended, autoSaved, dismissAutoSaved, pending, error, blocked, command, end, setLength, quickStart, setDetails, setTopic, fileSession, retry: sync }
}

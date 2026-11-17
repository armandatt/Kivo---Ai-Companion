'use client'

// A focus session that is running, shown on every page but the two that
// already show it (Today and Focus): what it is on and its clock, and a link
// back to it. It reads the one session the server records (GET
// /api/nova/session) and changes nothing, so it can never disagree with
// the session's own page or start a second clock.
//
// It asks only when a page opens, when the tab comes back into view, and
// every minute while a session is running: a learner with nothing running
// costs one read per page, never a poll (the database is billed awake).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Pause, Timer } from 'lucide-react'
import type { NovaSessionView } from '@repo/api/nova/product/today.types'
import { fetchSession } from './nova-api'

const RUNNING_SYNC_MS = 60_000
// Pages that show the session themselves.
const SHOWN_ON = ['/home', '/focus']

const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function FocusPill() {
  const pathname = usePathname()
  const [session, setSession] = useState<{ view: NovaSessionView; at: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const read = async () => {
      const res = await fetchSession()
      if (alive && res.ok) setSession(res.session ? { view: res.session, at: Date.now() } : null)
    }
    void read()
    const onVisible = () => { if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [pathname])

  const running = session?.view.status === 'in_progress'
  useEffect(() => {
    if (!session) return
    const sync = setInterval(() => { if (!document.hidden) void fetchSession().then(r => { if (r.ok) setSession(r.session ? { view: r.session, at: Date.now() } : null) }) }, RUNNING_SYNC_MS)
    const tick = running ? setInterval(() => setNow(Date.now()), 1000) : null
    return () => { clearInterval(sync); if (tick) clearInterval(tick) }
  }, [session, running])

  if (!session || SHOWN_ON.some(p => pathname === p || pathname.startsWith(`${p}/`))) return null
  const v = session.view
  const elapsed = v.elapsedSeconds + (running ? Math.max(0, Math.floor((now - session.at) / 1000)) : 0)
  const what = v.topicName ?? v.label ?? 'Focus'
  return (
    <Link href="/focus" className="fixed bottom-4 right-4 z-40 inline-flex max-w-[min(22rem,calc(100vw-2rem))] items-center gap-2 rounded-full border border-nova/35 bg-card/95 px-3.5 py-2 text-sm shadow-lg backdrop-blur transition-colors hover:bg-card"
      aria-label={`${running ? 'Focus session running' : 'Focus session paused'}: ${what}, ${clock(elapsed)}. Open it.`} data-focus-pill>
      {running ? <Timer aria-hidden className="size-4 shrink-0 text-nova-ink" /> : <Pause aria-hidden className="size-4 shrink-0 text-amber-300" />}
      <span className="min-w-0 truncate text-foreground/85">{what}</span>
      <span className="shrink-0 font-mono tabular-nums text-foreground">{clock(elapsed)}</span>
      {!running && <span className="shrink-0 text-xs text-amber-200">Paused</span>}
    </Link>
  )
}

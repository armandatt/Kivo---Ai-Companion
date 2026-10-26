'use client'

// The session running now, at the top of Today. Its clock is the server's
// (use-nova-session.ts): a countdown for a timed session, the time studied
// for one with no time limit. Reaching zero completes nothing: it says the
// planned time has passed and the learner continues, extends or finishes.
// Finishing asks "How did it go?", the one answer that tells Nova how the
// study went; it never marks a task done.

import { useState } from 'react'
import Link from 'next/link'
import { Expand, Infinity as Unlimited, Loader2, Map as MapIcon, NotebookPen, Pause, Play, Plus, Sparkles, Square } from 'lucide-react'
import type { NovaSessionOutcome } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { clock } from '../format'
import type { useNovaSession } from '../use-nova-session'

const OUTCOMES: Array<{ value: NovaSessionOutcome; label: string }> = [
  { value: 'struggled', label: 'Struggled' }, { value: 'okay', label: 'Okay' }, { value: 'good', label: 'Good' }, { value: 'crushed_it', label: 'Crushed it' },
]
const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

export function FocusNow({ live, links, onAskNova }: {
  live: ReturnType<typeof useNovaSession>
  links: { notes: string; map: string } | null
  onAskNova: () => void
}) {
  const [finishing, setFinishing] = useState(false)
  const s = live.session
  if (!s) return null
  const paused = s.status === 'paused'
  const planned = s.plannedDurationMinutes * 60
  const timed = planned > 0
  const over = timed && live.elapsedSeconds > planned
  const shown = timed && !over ? Math.max(0, planned - live.elapsedSeconds) : live.elapsedSeconds
  const title = s.topicName ?? s.label ?? 'Focus session'
  const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5 disabled:opacity-50'

  return (
    <section aria-labelledby="focus-now-title" className="relative overflow-hidden rounded-2xl border border-nova/30 bg-nova/[0.05] p-5 sm:p-6" data-focus-now={s.untimed ? 'untimed' : timed ? 'timed' : 'open'}>
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-nova-ink">
        <span className={cn('size-2 rounded-full', paused ? 'bg-amber-300' : 'animate-pulse bg-nova')} aria-hidden />
        {paused ? 'Paused' : 'Focusing now'}
        <span className="font-normal normal-case tracking-normal text-subtle">· {timed ? `${minutesLabel(s.plannedDurationMinutes)} session` : 'No time limit'}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {s.subjectName && <p className="text-sm text-subtle">{s.subjectName}</p>}
          <h2 id="focus-now-title" className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-[1.7rem]">{title}</h2>
        </div>
        <div className="text-right">
          <p role="timer" aria-label={timed && !over ? 'Time left' : 'Time focused'} className={cn('font-semibold tabular-nums leading-none tracking-tight text-foreground text-5xl', paused && 'opacity-60')} data-focus-clock>{clock(shown)}</p>
          <p className="mt-1 text-xs text-subtle" data-focus-clock-label>{!timed ? 'focused so far' : over ? `past your ${minutesLabel(s.plannedDurationMinutes)}. Keep going, or finish when you’re ready` : 'left'}</p>
        </div>
      </div>
      {timed && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', paused ? 'bg-amber-300/80' : 'bg-nova')} style={{ width: `${Math.min(1, live.elapsedSeconds / planned) * 100}%` }} />
        </div>
      )}

      {finishing ? (
        <div className="mt-5" role="group" aria-labelledby="focus-how">
          <p id="focus-how" className="text-sm font-medium text-foreground">How did it go?</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {OUTCOMES.map(o => (
              <button key={o.value} type="button" disabled={live.pending !== null} onClick={() => void live.end(o.value)} className={btn} data-focus-outcome={o.value}>{o.label}</button>
            ))}
          </div>
          <button type="button" onClick={() => setFinishing(false)} className="mt-2 text-xs text-subtle underline">Keep going</button>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={live.pending !== null} onClick={() => void live.command(paused ? 'resume' : 'pause')} className={btn} data-focus-pause>
            {live.pending === 'pause' || live.pending === 'resume' ? <Loader2 className="size-4 animate-spin" /> : paused ? <Play className="size-4" /> : <Pause className="size-4" />} {paused ? 'Resume' : 'Pause'}
          </button>
          {timed && <button type="button" disabled={live.pending !== null} onClick={() => void live.setLength(Math.min(240, Math.max(s.plannedDurationMinutes, Math.ceil(live.elapsedSeconds / 60)) + 10))} className={btn} data-focus-extend><Plus className="size-4" /> 10 min</button>}
          {timed && <button type="button" disabled={live.pending !== null} onClick={() => void live.setLength(0)} className={btn} data-focus-untimed><Unlimited className="size-4" /> No time limit</button>}
          <button type="button" onClick={() => setFinishing(true)} className={cn(btn, 'border-nova/40 text-nova-ink')} data-focus-finish><Square className="size-3.5" /> Finish</button>
          <span className="flex-1" />
          <button type="button" onClick={onAskNova} className={btn} data-focus-ask><Sparkles className="size-4" /> Ask Nova</button>
          {links && <Link href={links.notes} className={btn}><NotebookPen className="size-4" /> Notes</Link>}
          {links && <Link href={links.map} className={btn}><MapIcon className="size-4" /> Map</Link>}
          <Link href="/focus" className={btn} title="Open the focus room"><Expand className="size-4" /> Focus room</Link>
        </div>
      )}
      {live.error && <p role="alert" className="mt-2 text-xs text-red-300">{live.error}</p>}
    </section>
  )
}

'use client'

// The session running now, at the top of Today. Its clock is the server's
// (use-nova-session.ts): a countdown for a timed session, the time studied
// for one with no time limit. Reaching zero completes nothing: it says the
// planned time has passed and the learner continues, extends or finishes.
// Finishing asks "How did it go?", the one answer that tells Nova how the
// study went; it never marks a task done.

import { useState } from 'react'
import Link from 'next/link'
import { Expand, Infinity as Unlimited, Loader2, Map as MapIcon, NotebookPen, Pause, Pencil, Play, Plus, Sparkles, Square } from 'lucide-react'
import type { NovaSessionOutcome } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { clock } from '../format'
import type { useNovaSession } from '../use-nova-session'

const OUTCOMES: Array<{ value: NovaSessionOutcome; label: string }> = [
  { value: 'struggled', label: 'Struggled' }, { value: 'okay', label: 'Okay' }, { value: 'good', label: 'Good' }, { value: 'crushed_it', label: 'Crushed it' },
]
// What a Quick Focus session can be filed as: a word for the learner's own
// record, nothing more (it moves no mastery and completes no task).
export const FOCUS_CATEGORIES = ['Study', 'Work', 'Reading', 'Writing', 'Practice', 'Other'] as const
const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

export function FocusNow({ live, links, onAskNova }: {
  live: ReturnType<typeof useNovaSession>
  links: { notes: string; map: string } | null
  onAskNova: () => void
}) {
  const [finishing, setFinishing] = useState(false)
  const [editing, setEditing] = useState(false)
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
          {(s.details?.category || s.details?.description || (!s.topicName && !editing)) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-foreground/65" data-focus-details>
              {s.details?.category && <span className="rounded-full border border-white/12 px-2 py-0.5 text-xs font-medium text-foreground/80" data-focus-category>{s.details.category}</span>}
              {s.details?.description && <span className="line-clamp-2 max-w-md">{s.details.description}</span>}
              {!s.topicName && !editing && (
                <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs text-subtle underline-offset-2 hover:text-foreground hover:underline" data-focus-edit-details>
                  <Pencil aria-hidden className="size-3" /> {s.details || (s.label && s.label !== 'Quick focus') ? 'Edit details' : 'Add details (optional)'}
                </button>
              )}
            </p>
          )}
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

      {editing && !s.topicName && <FocusDetails live={live} onDone={() => setEditing(false)} />}

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

// A Quick Focus session's optional details, while it runs. None of them is
// needed to start or finish; each is saved only when the learner presses Save.
function FocusDetails({ live, onDone }: { live: ReturnType<typeof useNovaSession>; onDone: () => void }) {
  const s = live.session!
  const [title, setTitle] = useState(s.label && s.label !== 'Quick focus' ? s.label : '')
  const [category, setCategory] = useState<string | null>(s.details?.category ?? null)
  const [description, setDescription] = useState(s.details?.description ?? '')
  const [failed, setFailed] = useState<string | null>(null)
  const saving = live.pending === 'details'
  async function save() {
    setFailed(null)
    const ok = await live.setDetails({ title: title.trim() || 'Quick focus', category, description: description.trim() || null })
    if (ok) onDone(); else setFailed('That didn’t save. Your session is still running; try again.')
  }
  return (
    <form onSubmit={e => { e.preventDefault(); void save() }} className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-background/40 p-3.5 sm:grid-cols-2" aria-label="Session details" data-focus-details-form>
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-foreground/70">What are you working on?</span>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="Quick focus" autoFocus
          className="mt-1 h-9 w-full rounded-lg border border-white/12 bg-background/60 px-3 text-sm text-foreground focus:border-nova/50 focus:outline-none" data-focus-title-input />
      </label>
      <div className="sm:col-span-2">
        <span className="text-xs font-medium text-foreground/70" id="focus-category-label">Category <span className="font-normal text-subtle">(optional)</span></span>
        <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="focus-category-label">
          {FOCUS_CATEGORIES.map(c => (
            <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(category === c ? null : c)}
              className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', category === c ? 'border-nova/50 bg-nova/12 text-nova-ink' : 'border-white/12 text-foreground/70 hover:bg-white/5')} data-focus-category-option={c}>{c}</button>
          ))}
        </div>
      </div>
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-foreground/70">Notes <span className="font-normal text-subtle">(optional)</span></span>
        <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={2}
          className="mt-1 w-full resize-none rounded-lg border border-white/12 bg-background/60 px-3 py-2 text-sm text-foreground focus:border-nova/50 focus:outline-none" data-focus-description-input />
      </label>
      {failed && <p role="alert" className="text-xs text-amber-200 sm:col-span-2">{failed}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3 text-sm font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-60" data-focus-details-save>{saving && <Loader2 className="size-4 animate-spin" />} Save</button>
        <button type="button" onClick={onDone} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-foreground/65 hover:bg-white/5">Cancel</button>
      </div>
    </form>
  )
}

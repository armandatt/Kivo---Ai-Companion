'use client'

// "Plan your time": the tasks waiting for a slot on the calendar, blocks that
// were missed, and Kivo's proposal for each (calendar-planner.ts). Nothing is
// placed until the learner chooses Add: the block is then an ordinary
// calendar event for that task, so Planner and Calendar keep one task. A
// late proposal says why; a task that can't fit says so. Working hours and a
// day's focus shape the proposals.

import { useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarPlus, Check, ChevronDown, Clock, Loader2, Play, Settings2, Sparkles } from 'lucide-react'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { dayTitle } from './calendar-grid'
import type { CalendarPlanState as Plan, MissedBlock, PlanPrefs, PlanTaskView, ProposalView } from './use-calendar-plan'
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`)
const clockOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const minOf = (v: string) => { const [h, m] = v.split(':').map(Number) as [number, number]; return h * 60 + m }
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

export function PlanPanel({ plan, onAccept, onDone, onOpenTask, onFocus }: {
  plan: Plan
  onAccept: (p: ProposalView) => Promise<boolean>
  onDone: (taskId: string) => Promise<void>
  onOpenTask: (taskId: string) => void
  onFocus: (task: PlanTaskView, minutes: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const p = plan.plan
  if (!p) return plan.error ? <p role="alert" className="mt-4 text-sm text-amber-200">{plan.error}</p> : null

  const proposal = (taskId: string) => p.proposals.find(x => x.taskId === taskId) ?? null
  const reveal = (ids: string[]) => setShown(s => new Set([...s, ...ids]))
  const accept = async (x: ProposalView) => {
    setBusy(x.taskId); setNote(null)
    const ok = await onAccept(x)
    setBusy(null)
    if (ok) { setShown(s => { const n = new Set(s); n.delete(x.taskId); return n }); setNote(`Added “${x.title}” on ${dayTitle(x.day!)} at ${x.startTime}.`) }
  }
  const addAll = async () => {
    for (const x of p.proposals.filter(x => shown.has(x.taskId) && x.day && !x.late)) {
      setBusy(x.taskId)
      if (!(await onAccept(x))) break
    }
    setBusy(null); setShown(new Set()); setNote('Added the proposed blocks to your calendar.')
  }
  const count = p.unscheduled.length, missed = p.missed.length
  const ready = p.proposals.filter(x => shown.has(x.taskId) && x.day && !x.late).length

  return (
    <section aria-labelledby="plan-heading" className="mt-6 rounded-2xl border border-white/8 bg-card/40" data-plan-panel={open ? 'open' : 'closed'}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-action/12 text-action-ink"><CalendarClock className="size-[18px]" /></span>
          <span className="min-w-0">
            <span id="plan-heading" className="block text-sm font-semibold text-foreground">Plan your time</span>
            <span className="block text-xs text-foreground/55" data-plan-summary>
              {count === 0 && missed === 0 ? 'Every open task has time set aside.' : [count ? `${count} task${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} time` : null, missed ? `${missed} missed block${missed === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronDown aria-hidden className={cn('ml-auto size-4 shrink-0 text-foreground/40 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
        </button>
        {open && count > 0 && (
          <button type="button" onClick={() => reveal(p.unscheduled.map(t => t.id))} className={cn(BUTTON_QUIET, 'h-9')} data-plan-all><Sparkles aria-hidden className="size-4" /> Find times for all</button>
        )}
        {open && <button type="button" onClick={() => setSettings(s => !s)} aria-expanded={settings} aria-label="Working hours" title="Working hours and daily focus" className="grid size-9 place-items-center rounded-lg text-foreground/55 hover:bg-white/5 hover:text-foreground"><Settings2 className="size-4" /></button>}
      </header>

      {open && (
        <div className="border-t border-white/6 px-4 pb-4 pt-3 sm:px-5">
          {settings && <PrefsForm prefs={plan.prefs} onSave={pr => { plan.setPrefs(pr); setSettings(false) }} />}
          {note && <p role="status" className="mb-3 rounded-lg bg-action/10 px-3 py-2 text-sm text-foreground/80" data-plan-note>{note}</p>}

          {missed > 0 && (
            <div className="mb-4" data-plan-missed>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300/90">Missed</p>
              <ul className="space-y-2">{p.missed.map(m => <MissedRow key={m.key} m={m} busy={busy === m.taskId} onFind={() => reveal([m.taskId])} onDone={async () => { setBusy(m.taskId); await onDone(m.taskId); setBusy(null) }} proposal={shown.has(m.taskId) ? proposal(m.taskId) : null} onAccept={accept} />)}</ul>
            </div>
          )}

          {count > 0 ? (
            <>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Needs time</p>
              <ul className="divide-y divide-white/6" data-plan-unscheduled>
                {p.unscheduled.filter(t => !p.missed.some(m => m.taskId === t.id)).map(t => {
                  const x = shown.has(t.id) ? proposal(t.id) : null
                  return (
                    <li key={t.id} className="py-3" data-plan-task={t.id}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <button type="button" onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm font-medium text-foreground/90 hover:underline">{t.title}</span>
                          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-subtle">
                            <span className="inline-flex items-center gap-1"><Clock aria-hidden className="size-3" />{hm(t.minutes)}{t.estimated ? '' : ' (no estimate)'}</span>
                            {t.dueDay && <span className={t.overdue ? 'text-amber-300' : ''}>{t.overdue ? 'Overdue · ' : 'Due '}{dayTitle(t.dueDay)}</span>}
                            {t.priority && <span>{PRIORITY_LABEL[t.priority]} priority</span>}
                            {t.subjectName && <span>{[t.subjectName, t.topicName].filter(Boolean).join(' › ')}</span>}
                          </span>
                        </button>
                        {!x && <button type="button" onClick={() => reveal([t.id])} className="text-sm font-medium text-action-ink hover:underline" data-plan-find>Find a time</button>}
                        {t.topicName && t.subjectName && <button type="button" onClick={() => onFocus(t, Math.min(90, t.minutes))} className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground" title="Start a focus session on this now"><Play aria-hidden className="size-3.5" /> Focus now</button>}
                      </div>
                      {x && <ProposalRow x={x} busy={busy === t.id} onAccept={() => void accept(x)} onSkip={() => setShown(s => { const n = new Set(s); n.delete(t.id); return n })} />}
                    </li>
                  )
                })}
              </ul>
              {ready > 1 && <div className="mt-3 flex justify-end"><button type="button" onClick={() => void addAll()} disabled={busy !== null} className={BUTTON_PRIMARY} data-plan-add-all><CalendarPlus aria-hidden className="size-4" /> Add all {ready}</button></div>}
            </>
          ) : missed === 0 ? <p className="text-sm text-foreground/60">Nothing is waiting for time. Tasks with an estimate and a due day get the best proposals.</p> : null}
          <p className="mt-3 text-[11px] text-subtle">Proposals fit your working hours ({clockOf(plan.prefs.dayStart)}–{clockOf(plan.prefs.dayEnd)}), at most {hm(plan.prefs.focusPerDay)} of planned work a day, with a short break after each block. Nothing moves until you add it.</p>
        </div>
      )}
    </section>
  )
}

function ProposalRow({ x, busy, onAccept, onSkip }: { x: ProposalView; busy: boolean; onAccept: () => void; onSkip: () => void }) {
  if (!x.day) return <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[13px] text-amber-100" data-plan-unfit><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />{x.reason}</p>
  return (
    <div className={cn('mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2', x.late ? 'bg-amber-400/10' : 'bg-action/[0.08]')} data-plan-proposal={x.taskId}>
      <span className="text-[13px] text-foreground/85"><span className="font-medium text-foreground">{dayTitle(x.day)}</span>, {x.startTime}–{x.endTime}{x.split ? ' (first block)' : ''}</span>
      {x.late && <span className="flex items-center gap-1 text-xs text-amber-200"><AlertTriangle aria-hidden className="size-3.5" /> {x.reason}</span>}
      <span className="ml-auto flex items-center gap-2">
        <button type="button" onClick={onSkip} className="text-xs text-foreground/55 hover:text-foreground">Not now</button>
        <button type="button" onClick={onAccept} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-60" data-plan-accept>
          {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Check aria-hidden className="size-3.5" />} Add to calendar
        </button>
      </span>
    </div>
  )
}

function MissedRow({ m, busy, onFind, onDone, proposal, onAccept }: { m: MissedBlock; busy: boolean; onFind: () => void; onDone: () => Promise<void>; proposal: ProposalView | null; onAccept: (x: ProposalView) => Promise<void> }) {
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <li className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2.5" data-plan-missed-row={m.taskId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 text-sm text-foreground/85"><span className="font-medium text-foreground">{m.taskTitle}</span> <span className="text-xs text-subtle">· planned {dayTitle(m.day)}, {time(m.startAt)}–{time(m.endAt)}</span></span>
        {!proposal && <button type="button" onClick={onFind} className="text-sm font-medium text-action-ink hover:underline" data-plan-reschedule>Find a new time</button>}
        <button type="button" onClick={() => void onDone()} disabled={busy} className="text-sm text-foreground/60 hover:text-foreground" data-plan-mark-done>I did it</button>
      </div>
      {proposal && <ProposalRow x={proposal} busy={busy} onAccept={() => void onAccept(proposal)} onSkip={() => undefined} />}
    </li>
  )
}

function PrefsForm({ prefs, onSave }: { prefs: PlanPrefs; onSave: (p: PlanPrefs) => void }) {
  const [start, setStart] = useState(clockOf(prefs.dayStart))
  const [end, setEnd] = useState(clockOf(prefs.dayEnd))
  const [focus, setFocus] = useState(String(prefs.focusPerDay / 60))
  const valid = minOf(end) > minOf(start) && Number(focus) >= 0.5 && Number(focus) <= 12
  const field = 'mt-1 h-9 w-full rounded-lg border border-white/12 bg-background px-2 text-sm text-foreground'
  return (
    <form className="mb-4 grid gap-3 rounded-xl bg-white/[0.03] p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" onSubmit={e => { e.preventDefault(); if (valid) onSave({ dayStart: minOf(start), dayEnd: minOf(end), focusPerDay: Math.round(Number(focus) * 60) }) }} data-plan-prefs>
      <label className="text-xs text-foreground/60">Day starts<input type="time" step={900} value={start} onChange={e => setStart(e.target.value)} className={field} /></label>
      <label className="text-xs text-foreground/60">Day ends<input type="time" step={900} value={end} onChange={e => setEnd(e.target.value)} className={field} /></label>
      <label className="text-xs text-foreground/60">Planned work a day (hours)<input type="number" min={0.5} max={12} step={0.5} value={focus} onChange={e => setFocus(e.target.value)} className={field} /></label>
      <button type="submit" disabled={!valid} className={cn(BUTTON_QUIET, 'h-9')}>Save</button>
    </form>
  )
}

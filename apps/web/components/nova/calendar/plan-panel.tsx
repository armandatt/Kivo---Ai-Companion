'use client'

// "Plan your time" (28 Nov): the tasks waiting for time, grouped by subject,
// and Kivo's proposal. Find times proposes (ghost blocks on the calendar and
// a summary bar); nothing is written until Apply, and every Apply is a run
// that Undo or Remove takes back (blocks you changed, and ones under way or
// over, stay). Settings, Clear and Recent plans live in the sliders menu.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, ChevronDown, Clock, Loader2, Play, SlidersHorizontal, Sparkles, Undo2, X } from 'lucide-react'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { dayTitle } from './calendar-grid'
import type { CalendarPlanState as Plan, MissedBlock, PlanPrefs, PlanTaskView } from './use-calendar-plan'

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`)
const clockOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const minOf = (v: string) => { const [h, m] = v.split(':').map(Number) as [number, number]; return h * 60 + m }
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const keptLine = (kept: number, started: number) => [kept ? `${kept} you changed stay` : null, started ? `${started} already under way or over stay` : null].filter(Boolean).join(' · ')

export function PlanPanel({ plan, onDone, onOpenTask, onFocus, onEstimate, onChanged }: {
  plan: Plan
  onDone: (taskId: string) => Promise<void>
  onOpenTask: (taskId: string) => void
  onFocus: (task: PlanTaskView, minutes: number) => void
  onEstimate: (taskId: string, minutes: number) => Promise<void>
  onChanged: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [adjust, setAdjust] = useState(false)
  const [toast, setToast] = useState<{ text: string; runId?: string } | null>(null)
  const [confirm, setConfirm] = useState<{ range: 'week' | 'ahead'; count: number } | null>(null)
  const p = plan.plan
  const draft = plan.draft

  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 10_000); return () => window.clearTimeout(t) }, [toast])

  // Needs time, by subject, in the order Kivo places them.
  const groups = useMemo(() => {
    if (!p) return []
    const tasks = p.unscheduled.filter(t => !p.missed.some(m => m.taskId === t.id))
      .sort((a, b) => (a.priority ? PRIORITY_RANK[a.priority] : 3) - (b.priority ? PRIORITY_RANK[b.priority] : 3) || (a.dueDay ?? '9999').localeCompare(b.dueDay ?? '9999'))
    const by = new Map<string, PlanTaskView[]>()
    for (const t of tasks) { const k = t.subjectName ?? 'No subject'; by.set(k, [...(by.get(k) ?? []), t]) }
    return [...by.entries()]
  }, [p])

  if (!p) return plan.error ? <p role="alert" className="mt-4 text-sm text-amber-600 dark:text-amber-200">{plan.error}</p> : null
  const count = p.unscheduled.length, missed = p.missed.length, overdue = p.unscheduled.filter(t => t.overdue).length
  const latest = plan.runs.find(r => !r.undoneAt && r.remaining > 0 && Date.now() - Date.parse(r.createdAt) < 24 * 3_600_000)

  const run = async (key: string, work: () => Promise<void>) => { setBusy(key); try { await work() } finally { setBusy(null) } }
  const apply = () => run('apply', async () => {
    const r = await plan.apply()
    if (!r.ok) { setToast({ text: r.message }); return }
    setToast({ text: `${r.placed} block${r.placed === 1 ? '' : 's'} added${r.skipped.length ? ` · ${r.skipped.length} no longer fit` : ''}`, runId: r.runId })
    setAdjust(false); await onChanged()
  })
  const undo = (runId: string) => run(`undo:${runId}`, async () => {
    const r = await plan.undo(runId)
    setToast({ text: !r.ok ? r.message : r.already ? 'Already removed.' : [`Removed ${r.removed.length} block${r.removed.length === 1 ? '' : 's'}`, keptLine(r.kept, r.started)].filter(Boolean).join(' · ') })
    await onChanged()
  })
  const askClear = (range: 'week' | 'ahead') => run(`clear:${range}`, async () => {
    const r = await plan.clear(range, true)
    if (r.ok) setConfirm({ range, count: r.removed.length }); else setToast({ text: r.message })
  })
  const doClear = (range: 'week' | 'ahead') => run(`clear:${range}`, async () => {
    const r = await plan.clear(range, false)
    setConfirm(null)
    setToast({ text: !r.ok ? r.message : [`Removed ${r.removed.length} block${r.removed.length === 1 ? '' : 's'} Kivo placed`, keptLine(r.kept, r.started)].filter(Boolean).join(' · ') })
    await onChanged()
  })

  const placedDays = draft ? new Set(draft.placed.map(x => x.day)).size : 0

  return (
    <section aria-labelledby="plan-heading" className="relative mt-6 rounded-2xl border border-border/70 bg-card/40" data-plan-panel={open ? 'open' : 'closed'}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-action/12 text-action-ink"><CalendarClock className="size-[18px]" /></span>
          <span className="min-w-0">
            <span id="plan-heading" className="block text-sm font-semibold text-foreground">Plan your time</span>
            <span className="block text-xs text-foreground/55" data-plan-summary>
              {count === 0 && missed === 0 ? 'Every open task has time set aside.' : [count ? `${count} need time` : null, overdue ? `${overdue} overdue` : null, missed ? `${missed} missed` : null].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronDown aria-hidden className={cn('ml-auto size-4 shrink-0 text-foreground/40 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
        </button>
        {count > 0 && !draft && (
          <button type="button" disabled={plan.loading} onClick={() => { setOpen(true); void plan.propose(null) }} className={cn(BUTTON_QUIET, 'h-9')} data-plan-all>
            {plan.loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />} Find times for all
          </button>
        )}
        <button type="button" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-label="Planning settings" title="Planning settings, clear, recent plans"
          className="grid size-9 place-items-center rounded-lg text-foreground/55 hover:bg-foreground/5 hover:text-foreground"><SlidersHorizontal className="size-4" /></button>
      </header>

      {/* A run applied in the last day: one place to take it back. */}
      {latest && !draft && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-action/[0.06] px-4 py-2 text-sm sm:px-5" data-plan-banner>
          <span className="text-foreground/75">Planned at {new Date(latest.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {latest.remaining} block{latest.remaining === 1 ? '' : 's'} on your calendar</span>
          <button type="button" disabled={busy !== null} onClick={() => undo(latest.id)} className="font-medium text-action-ink hover:underline">Remove these {latest.remaining}</button>
        </div>
      )}

      {/* The proposal: drawn on the calendar as ghosts, written only on Apply. */}
      {draft && (
        <div className="border-t border-border/60 bg-action/[0.06] px-4 py-3 sm:px-5" data-plan-proposal>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {draft.placed.length} task{draft.placed.length === 1 ? '' : 's'} placed across {placedDays} day{placedDays === 1 ? '' : 's'}{draft.unplaced.length ? ` · ${draft.unplaced.length} don’t fit` : ''}
              <span className="ml-2 text-xs font-normal text-foreground/55">Dashed on the calendar · not added yet</span>
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy !== null || draft.placed.length === 0} onClick={() => void apply()} className={cn(BUTTON_PRIMARY, 'h-9')} data-plan-apply>{busy === 'apply' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Apply</button>
              <button type="button" onClick={() => setAdjust(a => !a)} aria-expanded={adjust} className={cn(BUTTON_QUIET, 'h-9')} data-plan-adjust>Adjust</button>
              <button type="button" onClick={() => { plan.cancel(); setAdjust(false) }} className={cn(BUTTON_QUIET, 'h-9')} data-plan-cancel>Cancel</button>
            </div>
          </div>
          {adjust && (
            <ul className="mt-3 space-y-1.5" data-plan-adjust-list>
              {draft.placed.map(x => (
                <li key={x.taskId} className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{x.title} <span className="text-foreground/50">· {dayTitle(x.day!)} {x.startTime}–{x.endTime}</span></span>
                  <button type="button" onClick={() => plan.dropFromDraft(x.taskId)} aria-label={`Leave ${x.title} out`} className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground"><X className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          {draft.unplaced.length > 0 && (
            <details className="mt-2 text-sm" open={adjust}>
              <summary className="cursor-pointer text-foreground/60">Didn’t fit ({draft.unplaced.length})</summary>
              <ul className="mt-1.5 space-y-1">{draft.unplaced.map(x => <li key={x.taskId} className="text-foreground/65"><span className="font-medium text-foreground/80">{x.title}</span> · {x.reason}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {menu && (
        <div className="border-t border-border/60 px-4 py-4 sm:px-5" data-plan-menu>
          <PrefsForm prefs={plan.prefs} onSave={pr => { void plan.setPrefs(pr) }} />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground/65">Clear scheduled blocks:</span>
            <button type="button" disabled={busy !== null} onClick={() => void askClear('week')} className={BUTTON_QUIET}>This week</button>
            <button type="button" disabled={busy !== null} onClick={() => void askClear('ahead')} className={BUTTON_QUIET}>Everything ahead</button>
          </div>
          {confirm && (
            <div role="alertdialog" aria-label="Clear scheduled blocks" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              {confirm.count === 0 ? <p>No blocks Kivo placed {confirm.range === 'week' ? 'this week' : 'ahead'} can be removed.</p> : (
                <>
                  <p>Remove {confirm.count} block{confirm.count === 1 ? '' : 's'} Kivo placed {confirm.range === 'week' ? 'this week' : 'from now on'}? Your own events stay, and so do blocks you changed.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy !== null} onClick={() => void doClear(confirm.range)} className={cn(BUTTON_PRIMARY, 'h-8')}>Remove {confirm.count}</button>
                    <button type="button" onClick={() => setConfirm(null)} className={cn(BUTTON_QUIET, 'h-8')}>Keep them</button>
                  </div>
                </>
              )}
            </div>
          )}
          {plan.runs.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Recent plans</p>
              <ul className="mt-1.5 divide-y divide-border/50">
                {plan.runs.map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="text-foreground/75">{new Date(r.createdAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {r.placed} placed{r.undoneAt ? ' · removed' : r.remaining < r.placed ? ` · ${r.remaining} left` : ''}</span>
                    {!r.undoneAt && r.remaining > 0 && <button type="button" disabled={busy !== null} onClick={() => undo(r.id)} className="font-medium text-action-ink hover:underline">Remove</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="border-t border-border/60 px-4 pb-4 pt-3 sm:px-5">
          {missed > 0 && (
            <div className="mb-4" data-plan-missed>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300/90">Missed</p>
              <ul className="space-y-2">{p.missed.map(m => <MissedRow key={m.key} m={m} busy={busy === m.taskId} onFind={() => void plan.propose([m.taskId])} onDone={() => run(m.taskId, () => onDone(m.taskId))} />)}</ul>
            </div>
          )}
          {groups.length > 0 ? groups.map(([subject, tasks]) => (
            <div key={subject} className="mb-3" data-plan-group>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{subject} · {tasks.length}</p>
              <ul className="divide-y divide-border/50" data-plan-unscheduled>
                {tasks.map(t => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" data-plan-task={t.id}>
                    <button type="button" onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium text-foreground/90 hover:underline">{t.title}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-subtle">
                        <span className="inline-flex items-center gap-1"><Clock aria-hidden className="size-3" />{hm(t.minutes)}{t.estimated ? '' : ' · estimated'}</span>
                        {t.dueDay && <span className={t.overdue ? 'text-amber-600 dark:text-amber-300' : ''}>{t.overdue ? 'Overdue · ' : 'Due '}{dayTitle(t.dueDay)}</span>}
                        {t.priority && <span>{PRIORITY_LABEL[t.priority]}</span>}
                        {t.topicName && <span>{t.topicName}</span>}
                      </span>
                    </button>
                    {!t.estimated && (
                      <span className="flex items-center gap-1 text-xs text-foreground/55" data-plan-estimate>How long?
                        {[25, 45, 90].map(m => <button key={m} type="button" disabled={busy !== null} onClick={() => void run(`est:${t.id}`, () => onEstimate(t.id, m))} className="rounded-full border border-border px-2 py-0.5 hover:border-action/60 hover:text-foreground">{m}</button>)}
                      </span>
                    )}
                    <button type="button" disabled={plan.loading} onClick={() => void plan.propose([t.id])} className="text-sm font-medium text-action-ink hover:underline" data-plan-find>Find a time</button>
                    {t.topicName && t.subjectName && <button type="button" onClick={() => onFocus(t, Math.min(90, t.minutes))} className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground" title="Start a focus session on this now"><Play aria-hidden className="size-3.5" /> Focus now</button>}
                  </li>
                ))}
              </ul>
            </div>
          )) : missed === 0 ? <p className="text-sm text-foreground/60">Nothing is waiting for time. Tasks with an estimate and a due day get the best proposals.</p> : null}
          <p className="mt-3 text-[11px] text-subtle">Proposals fit your working hours ({clockOf(plan.prefs.dayStart)}–{clockOf(plan.prefs.dayEnd)}), at most {hm(plan.prefs.focusPerDay)} a day, {plan.prefs.bufferMinutes} min between blocks; exam days stay free. Nothing is added until you apply it.</p>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-lg" data-plan-toast>
          <span>{toast.text}</span>
          {toast.runId && <button type="button" onClick={() => { const id = toast.runId!; setToast(null); void undo(id) }} className="inline-flex items-center gap-1 font-semibold text-action-ink hover:underline"><Undo2 className="size-3.5" /> Undo</button>}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-foreground/50 hover:text-foreground"><X className="size-3.5" /></button>
        </div>
      )}
    </section>
  )
}

function MissedRow({ m, busy, onFind, onDone }: { m: MissedBlock; busy: boolean; onFind: () => void; onDone: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
      <AlertTriangle aria-hidden className="size-4 text-amber-600 dark:text-amber-300" />
      <span className="min-w-0 flex-1 truncate text-sm">{m.taskTitle} <span className="text-foreground/50">· missed {dayTitle(m.day)}</span></span>
      <button type="button" onClick={onFind} className="text-sm font-medium text-action-ink hover:underline">Find a new time</button>
      <button type="button" disabled={busy} onClick={onDone} className="text-sm text-foreground/60 hover:text-foreground">It’s done</button>
    </li>
  )
}

function PrefsForm({ prefs, onSave }: { prefs: PlanPrefs; onSave: (p: PlanPrefs) => void }) {
  const [v, setV] = useState(prefs)
  useEffect(() => setV(prefs), [prefs])
  const field = 'h-8 rounded-lg border border-border bg-background px-2 text-sm'
  return (
    <form onSubmit={e => { e.preventDefault(); if (v.dayEnd > v.dayStart) onSave(v) }} className="flex flex-wrap items-end gap-3 text-sm" data-plan-prefs>
      <label className="flex flex-col gap-1 text-xs text-foreground/60">Working hours
        <span className="flex items-center gap-1"><input type="time" className={field} value={clockOf(v.dayStart)} onChange={e => setV({ ...v, dayStart: minOf(e.target.value) })} />–<input type="time" className={field} value={clockOf(v.dayEnd)} onChange={e => setV({ ...v, dayEnd: minOf(e.target.value) })} /></span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-foreground/60">Max focus a day
        <select className={field} value={v.focusPerDay} onChange={e => setV({ ...v, focusPerDay: Number(e.target.value) })}>{[60, 120, 180, 240, 300, 360, 480].map(m => <option key={m} value={m}>{hm(m)}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-foreground/60">Gap between blocks
        <select className={field} value={v.bufferMinutes} onChange={e => setV({ ...v, bufferMinutes: Number(e.target.value) })}>{[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m} min</option>)}</select>
      </label>
      <fieldset className="flex flex-col gap-1 text-xs text-foreground/60"><legend className="mb-1">Days to avoid</legend>
        <span className="flex gap-1">{WEEKDAYS.map((d, i) => (
          <button key={d} type="button" aria-pressed={v.avoidDays.includes(i)} onClick={() => setV({ ...v, avoidDays: v.avoidDays.includes(i) ? v.avoidDays.filter(x => x !== i) : [...v.avoidDays, i] })}
            className={cn('h-8 rounded-lg border px-2 text-xs', v.avoidDays.includes(i) ? 'border-action/60 bg-action/15 text-foreground' : 'border-border text-foreground/60')}>{d}</button>
        ))}</span>
      </fieldset>
      <button type="submit" className={cn(BUTTON_PRIMARY, 'h-8')}>Save</button>
    </form>
  )
}

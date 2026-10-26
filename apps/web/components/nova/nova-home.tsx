'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Columns2, KanbanSquare, LayoutList, Loader2, Plus, Sparkles, Undo2, X } from 'lucide-react'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import type { CopilotMode, FlowItemView, FlowOp } from '@repo/api/nova/product/day-flow.types'
import type { NovaNotesView } from '@repo/api/nova/product/notes.types'
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaProgressView } from '@repo/api/nova/product/progress.types'
import { greetingFor } from '@repo/api/nova/product/greetings'
import { TelegramCard } from './telegram-connect'
import { ShortfallNote } from './shortfall-note'
import { RecoveryCard } from './recovery-card'
import { KnowledgeBoard, RecentlyCaptured } from './knowledge-board'
import { AccountingFor, WorkingToward } from './today-sections'
import { CompanionCard, ContinueLearning, Deadlines, WeekSoFar } from './home-panels'
import { TodayTasks } from './tasks/today-tasks'
import { useTasks } from './tasks/use-tasks'
import { useNovaView } from './use-nova-view'
import { firstName } from './format'
import { useStartSession } from './use-start-session'
import { useNovaSession } from './use-nova-session'
import { useDayFlow } from './today/use-day-flow'
import { FlowList, FlowSchedule, mapHref, noteHref } from './today/flow-list'
import { AddToToday } from './today/add-to-today'
import { FocusNow } from './today/focus-now'
import { CopilotPanel } from './today/copilot-panel'
import { cn } from '@/lib/utils'

type Props = {
  view:        NovaTodayReady
  minutes:     number | null
  onMinutes:   (minutes: number | null) => void
  subject:     string | null
  onSubject:   (subject: string | null) => void
  refreshing:  boolean
  onRefresh:   () => void
}

// A session started from a task on the board has no planned block behind
// it, so it gets the length of an ordinary one.
const TASK_SESSION_MINUTES = 25
const LAYOUT = 'kivo-today-layout'
const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

function Disclosure({ title, count, children, id }: { title: string; count?: number | null; children: React.ReactNode; id: string }) {
  return (
    <details className="group border-t border-white/8 py-3" data-more={id}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground/80 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>{title}{count ? <span className="ml-2 text-xs font-normal text-subtle">{count}</span> : null}</span>
        <span aria-hidden className="text-subtle transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}

// Today, for a Nova learner: the learner's own flow for the day, the item
// being worked on, and Nova beside it to shape the day. The flow is theirs
// and saved (today/use-day-flow.ts → /api/nova/day); the planner's
// suggestions, the task board and everything on record are a step away, in
// the sections below, never in the way.
export function NovaHome({ view, refreshing }: Props) {
  const { start, starting } = useStartSession()
  const board    = useTasks()
  const notes    = useNovaView<NovaNotesView>('/api/nova/notes')
  const creature = useNovaView<NovaCreatureView>('/api/nova/creature')
  const map      = useNovaView<NovaKnowledgeMapView>('/api/nova/knowledge-map')
  const progressView = useNovaView<NovaProgressView>('/api/nova/progress')
  const day = useDayFlow()
  const live = useNovaSession()

  const [adding, setAdding] = useState(false)
  const [startingItem, setStartingItem] = useState<string | null>(null)
  const [novaOpen, setNovaOpen] = useState(true)
  const [novaOnPhone, setNovaOnPhone] = useState(false)
  const [mode, setMode] = useState<CopilotMode>('plan')
  const [hideDraft, setHideDraft] = useState(false)
  const [intention, setIntention] = useState<string | null>(null)
  const [fitMinutes, setFitMinutes] = useState('')
  const copilotInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { try { setNovaOpen(localStorage.getItem(LAYOUT) !== 'nova-hidden') } catch { /* storage off */ } }, [])
  const showNova = (open: boolean) => { setNovaOpen(open); try { localStorage.setItem(LAYOUT, open ? 'nova-shown' : 'nova-hidden') } catch { /* storage off */ } }
  // A session ending (here or on the focus screen) brings the flow up to date.
  useEffect(() => { if (live.ended) void day.load() }, [live.ended]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live.session) setMode('focus') }, [live.session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const flow = day.flow
  const name = firstName(view.learnerName)
  const tasks = board.view?.status === 'ready' ? board.tasks : null
  const sessionRunning = live.session !== null
  const openItems = flow?.items.filter(i => i.status === 'planned' || i.status === 'active') ?? []
  const doneCount = flow?.items.filter(i => i.status === 'done').length ?? 0
  const total = flow?.items.filter(i => i.status !== 'later').length ?? 0
  const ended = flow?.items.find(i => i.sessionEnded) ?? null
  const next = openItems.find(i => i.status === 'planned') ?? null
  const focusItem = flow?.items.find(i => i.status === 'active' && !i.sessionEnded) ?? null
  const over = flow && flow.budgetMinutes ? flow.plannedMinutes - flow.budgetMinutes : 0

  const ops = useCallback((list: FlowOp[]) => day.ops(list), [day])
  const startItem = useCallback(async (item: FlowItemView, minutes: number) => {
    setStartingItem(item.id)
    const res = await day.act({ action: 'start', itemId: item.id, minutes }, { quiet: true })
    setStartingItem(null)
    if (res.ok) { await live.retry(); window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
  }, [day, live])
  const askNova = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) showNova(true); else setNovaOnPhone(true)
    window.setTimeout(() => copilotInput.current?.focus(), 60)
  }, [])
  const createTask = useCallback(async (title: string) => {
    const ok = await board.create({ title })
    if (!ok) return null
    const made = (await fetch('/api/nova/tasks', { cache: 'no-store' }).then(r => r.json()).catch(() => null)) as { tasks?: Array<{ id: string; title: string; createdAt: string }> } | null
    const mine = made?.tasks?.filter(t => t.title === title).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    await day.load()
    return mine?.id ?? null
  }, [board, day])

  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const copilot = (onClose?: () => void) => flow && (
    <CopilotPanel flow={flow} mode={mode} onMode={setMode} inputRef={copilotInput}
      onAdopt={day.adopt} onUndo={() => void day.undo()} onReload={() => { void day.load(); void board.refresh() }} onClose={onClose} />
  )

  return (
    <div className="-mx-6 -mb-6 flex min-h-[calc(100vh-1rem)] lg:-mt-6" data-today-workspace>
      <div className="min-w-0 flex-1 px-6 pb-20 pt-14 lg:pt-8">
        <div className="mx-auto w-full max-w-3xl">
          {/* ── The day: its name, what it is for, how far along ─────────── */}
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3" data-today-header>
            <div className="min-w-0">
              <p className="text-xs text-subtle">{date} · {greetingFor(view.language, new Date().getHours())}{name ? `, ${name}` : ''}</p>
              <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-foreground">Today</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {flow && flow.items.length > 0 && (
                <div role="radiogroup" aria-label="Show today as" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                  {([['list', LayoutList, 'List'], ['schedule', CalendarDays, 'Schedule']] as const).map(([v, Icon, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={flow.view === v} disabled={day.busy} onClick={() => void day.act({ action: 'view', view: v }, { quiet: true })}
                      className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1', flow.view === v ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground')} data-today-view={v}>
                      <Icon className="size-3.5" aria-hidden /> {label}
                    </button>
                  ))}
                </div>
              )}
              <Link href="/planner" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground" title="The full planner"><Columns2 className="size-4" /> <span className="max-sm:hidden">Planner</span></Link>
              <Link href="/planner?view=board" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground" title="Your task board"><KanbanSquare className="size-4" /> <span className="max-sm:hidden">Board</span></Link>
              <button type="button" disabled={!flow} onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-50" data-today-add>
                <Plus className="size-4" /> Add to today
              </button>
              {!novaOpen && <button type="button" onClick={() => showNova(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/30 px-3 text-sm font-semibold text-nova-ink hover:bg-nova/10 max-lg:hidden" data-today-nova-show><Sparkles className="size-4" /> Nova</button>}
              <button type="button" onClick={() => setNovaOnPhone(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/30 px-3 text-sm font-semibold text-nova-ink hover:bg-nova/10 lg:hidden"><Sparkles className="size-4" /> Nova</button>
            </div>
          </header>

          {flow && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-today-intention>
              <label className="min-w-0 flex-1 basis-full sm:basis-auto">
                <span className="sr-only">What today is for</span>
                <input value={intention ?? flow.intention ?? ''} maxLength={280} placeholder="What do you want today to be about? (optional)"
                  onChange={e => setIntention(e.target.value)}
                  onBlur={() => { if (intention !== null && intention.trim() !== (flow.intention ?? '')) void day.ops([{ op: 'set_intention', text: intention.trim() || null }]).then(() => setIntention(null)); else setIntention(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setIntention(null); e.currentTarget.blur() } }}
                  className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 -ml-2 text-[15px] text-foreground/90 placeholder:text-foreground/35 hover:border-white/8 focus:border-nova/50 focus:outline-none" data-intention-input />
              </label>
              {total > 0 && (
                <p className="flex items-center gap-2 text-xs text-subtle" data-today-progress>
                  <span className="inline-block h-1 w-20 overflow-hidden rounded-full bg-white/10" aria-hidden><span className="block h-full rounded-full bg-nova" style={{ width: `${(doneCount / total) * 100}%` }} /></span>
                  {doneCount} of {total} done · {minutesLabel(flow.plannedMinutes)} planned{flow.budgetMinutes ? ` of ${minutesLabel(flow.budgetMinutes)}` : ''}
                </p>
              )}
            </div>
          )}

          {/* ── What is being worked on now ─────────────────────────────── */}
          <div className="mt-6 space-y-4">
            {live.session && <FocusNow live={live} onAskNova={() => { setMode('focus'); askNova() }} links={focusItem ? { notes: noteHref(focusItem), map: mapHref(focusItem) } : null} />}
            {!live.session && ended && (
              <section className="rounded-xl border border-white/10 px-4 py-3.5" role="status" data-session-ended={ended.id}>
                <p className="text-sm text-foreground">You focused on <span className="font-medium">{ended.title}</span>{ended.spentMinutes ? ` for ${minutesLabel(ended.spentMinutes)}` : ''}. What next?</p>
                <div className="mt-2.5 flex flex-wrap gap-2 text-sm">
                  <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'done' }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5" data-ended-done>Done for today</button>
                  <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5" data-ended-keep>Keep it in today</button>
                  {next && next.id !== ended.id && <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }, { op: 'move', id: next.id, to: 0 }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5">Next: {next.title}</button>}
                  <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }]).then(() => day.setNotice({ text: 'That’s it for today. Your flow is saved as it is.', tone: 'info', undo: false, at: Date.now() }))} className="rounded-lg px-3 py-1.5 text-subtle hover:text-foreground">Stop for today</button>
                </div>
              </section>
            )}
          </div>

          {/* ── Today's flow ─────────────────────────────────────────────── */}
          <section aria-labelledby="flow-heading" className="mt-6">
            <h2 id="flow-heading" className="sr-only">Today’s flow</h2>
            {!flow ? (
              day.loadError ? (
                <div role="alert" className="rounded-xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">{day.loadError} <button type="button" onClick={() => void day.load()} className="ml-2 underline">Try again</button></div>
              ) : <div aria-busy="true" className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-white/4" />)}</div>
            ) : flow.draft && !flow.saved && !hideDraft ? (
              <div className="rounded-2xl border border-dashed border-nova/40 px-4 py-4 sm:px-5" data-flow-draft>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-nova-ink">Nova’s draft for today · not saved yet</p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {flow.draft.items.map(i => (
                    <li key={i.id} className={cn('flex items-baseline justify-between gap-3', i.status === 'later' && 'text-subtle')}>
                      <span className="min-w-0 truncate">{i.status === 'later' ? 'If there’s time: ' : ''}{i.title}<span className="ml-2 text-xs text-subtle">{i.kind === 'task' ? 'task' : 'topic'}{i.subjectName ? ` · ${i.subjectName}` : ''}</span></span>
                      {i.minutes && <span className="shrink-0 text-xs text-subtle">{minutesLabel(i.minutes)}</span>}
                    </li>
                  ))}
                </ul>
                {flow.draft.reasons.length > 0 && <ul className="mt-3 space-y-0.5 text-xs leading-relaxed text-foreground/65">{flow.draft.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" disabled={day.busy} onClick={() => void day.act({ action: 'accept', draftId: flow.draft?.id })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover" data-draft-accept>
                    {day.busy && <Loader2 className="size-4 animate-spin" />} Use this for today
                  </button>
                  <button type="button" onClick={() => { setHideDraft(true); setAdding(true) }} className="inline-flex h-9 items-center rounded-lg border border-white/12 px-3.5 text-sm hover:bg-white/5" data-draft-manual>Choose my own</button>
                  <button type="button" onClick={() => { setMode('plan'); askNova() }} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-subtle hover:text-foreground">Talk it through with Nova</button>
                </div>
                <p className="mt-2 text-[11px] text-subtle">You can change anything in it after. Nothing is saved until you choose.</p>
              </div>
            ) : flow.items.length === 0 ? (
              <div className="rounded-2xl border border-white/8 px-5 py-6" data-flow-empty>
                <h3 className="text-lg font-semibold text-foreground">What do you want to do today?</h3>
                <p className="mt-1 text-sm text-foreground/65">Pick your own work, tell Nova what today is for, or let it suggest a start from your tasks and plan.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover"><Plus className="size-4" /> Choose work</button>
                  <button type="button" onClick={() => { setMode('plan'); askNova() }} className="inline-flex h-9 items-center rounded-lg border border-white/12 px-3.5 text-sm hover:bg-white/5">Tell Nova my goals</button>
                  {flow.draft && <button type="button" onClick={() => setHideDraft(false)} className="inline-flex h-9 items-center rounded-lg border border-white/12 px-3.5 text-sm hover:bg-white/5">See Nova’s suggestion</button>}
                </div>
              </div>
            ) : (
              <>
                {flow.view === 'schedule'
                  ? <FlowSchedule flow={flow} busy={day.busy} onOps={l => void ops(l)} touched={day.touched} />
                  : <FlowList flow={flow} busy={day.busy} touched={day.touched} onOps={l => void ops(l)} onStart={(i, m) => void startItem(i, m)} starting={startingItem} sessionRunning={sessionRunning} />}
                {/* More than the day's time: said, with choices; nothing is cut. */}
                {over > 0 && (
                  <div className="mt-4 rounded-xl border border-[color:var(--sem-warning,#e6b450)]/30 px-4 py-3 text-sm text-foreground/80" data-flow-over>
                    Today’s flow adds up to {minutesLabel(flow.plannedMinutes)}; your planner gives {minutesLabel(flow.budgetMinutes!)}. Nothing has been dropped.
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <button type="button" disabled={day.busy} onClick={() => void ops([{ op: 'fit', minutes: flow.budgetMinutes! }])} className="rounded-lg border border-white/12 px-2.5 py-1 hover:bg-white/5" data-fit-budget>Fit to {minutesLabel(flow.budgetMinutes!)}</button>
                      <button type="button" onClick={() => { setMode('plan'); askNova() }} className="rounded-lg px-2.5 py-1 text-subtle hover:text-foreground">Ask Nova what to move</button>
                    </div>
                  </div>
                )}
                <form className="mt-4 flex flex-wrap items-center gap-2 text-xs text-subtle" onSubmit={e => { e.preventDefault(); const n = Number(fitMinutes); if (Number.isInteger(n) && n > 0 && n <= 1440) { void ops([{ op: 'fit', minutes: n }]); setFitMinutes('') } }} data-fit-form>
                  <label htmlFor="fit-minutes">Time left today?</label>
                  <input id="fit-minutes" inputMode="numeric" value={fitMinutes} onChange={e => setFitMinutes(e.target.value.slice(0, 4))} placeholder="min" className="h-7 w-16 rounded-md border border-white/10 bg-transparent px-2 text-foreground focus:border-nova/60 focus:outline-none" />
                  <button type="submit" disabled={!fitMinutes || day.busy} className="rounded-md border border-white/12 px-2 py-1 text-foreground/80 disabled:opacity-40">Fit the rest</button>
                  <span>Keeps your order; moves what doesn’t fit to If there’s time.</span>
                </form>
              </>
            )}
          </section>

          {/* ── Everything else, a step away ──────────────────────────────── */}
          <div className="mt-12" data-today-more>
            <Disclosure id="deadlines" title="Coming up" count={view.upcoming.length || null}>
              <Deadlines exams={view.upcoming} tasks={tasks ?? []} />
            </Disclosure>
            <Disclosure id="recovery" title="Overdue and catching up">
              <RecoveryCard onChanged={() => { void board.refresh(); void day.load() }} />
            </Disclosure>
            <Disclosure id="tasks" title="All open tasks" count={tasks ? tasks.filter(t => t.status !== 'done').length : null}>
              <TodayTasks
                tasks={tasks} failed={board.loadError} error={board.error}
                onCreate={board.create} onUpdate={board.update} onRemove={board.remove}
                subjects={board.view?.status === 'ready' ? board.view.subjects : []}
                today={board.view?.status === 'ready' ? board.view.today : null}
                dayMinutes={{ planned: view.plan.totalMinutesToday, budget: view.plan.budgetMinutes }}
                onStart={sessionRunning ? undefined : task => start({ topicName: task.topicName!, subjectName: task.subjectName!, durationMinutes: TASK_SESSION_MINUTES }, `task:${task.id}`)}
                starting={starting}
              />
            </Disclosure>
            <Disclosure id="planner" title="Your planner’s view of today">
              {view.plan.shortfall && <ShortfallNote shortfall={view.plan.shortfall} timeHref="/planner" />}
              <p className="text-sm text-foreground/70">The planner works out what is most worth studying today from your record. Its blocks appear in Add to today as suggestions; it never fills your flow by itself.</p>
              <AccountingFor constraints={view.constraints} />
            </Disclosure>
            <Disclosure id="week" title="This week">
              <WeekSoFar view={view} weeks={progressView} />
              <div className="mt-6"><ContinueLearning view={view} busy={starting !== null} onResume={() => setAdding(true)} /></div>
            </Disclosure>
            <Disclosure id="knowledge" title="Your knowledge and recent notes">
              <div className="space-y-12"><KnowledgeBoard map={map} reviewDue={view.reviewDue} /><RecentlyCaptured notes={notes} map={map} /></div>
            </Disclosure>
            <Disclosure id="you" title="Goals, companion and Telegram">
              <WorkingToward goals={view.goals} />
              <div className="mt-6 space-y-3"><CompanionCard creature={creature.view} name={null} /><TelegramCard /></div>
            </Disclosure>
          </div>
          {refreshing && <p className="mt-2 text-xs text-subtle">Refreshing…</p>}
        </div>
      </div>

      {/* ── Nova beside the day ──────────────────────────────────────────── */}
      {novaOpen && flow && (
        <aside className="sticky top-0 hidden h-screen w-[360px] shrink-0 border-l border-white/8 lg:flex lg:flex-col" data-today-nova>
          {copilot(() => showNova(false))}
        </aside>
      )}
      {novaOnPhone && flow && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Nova">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close Nova" onClick={() => setNovaOnPhone(false)} />
          <div className="absolute inset-x-0 bottom-0 top-[8vh] flex flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-background shadow-float sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[min(26rem,92vw)] sm:rounded-none sm:border-l">
            {copilot(() => setNovaOnPhone(false))}
          </div>
        </div>
      )}

      {adding && flow && <AddToToday flow={flow} onClose={() => setAdding(false)} onOps={l => day.ops(l, { quiet: true })} onCreateTask={createTask} />}
      {day.notice && (
        <div role="status" className="fixed bottom-6 left-1/2 z-40 flex w-max max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-background px-4 py-2.5 text-sm text-foreground/85 shadow-float" data-today-notice={day.notice.tone}>
          <span className={day.notice.tone === 'error' ? 'text-amber-200' : ''}>{day.notice.text}</span>
          {day.notice.undo && <button type="button" onClick={() => void day.undo()} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-today-undo><Undo2 className="size-3.5" /> Undo</button>}
          <button type="button" onClick={() => day.setNotice(null)} aria-label="Dismiss" className="text-subtle hover:text-foreground"><X className="size-3.5" /></button>
        </div>
      )}
    </div>
  )
}

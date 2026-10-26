'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BookOpen, CalendarCheck, CalendarDays, ChevronRight, Columns2, Flag, KanbanSquare, LayoutList, ListChecks, Loader2, Network, Plus, Sparkles, Sun, Target, TrendingUp, Undo2, X } from 'lucide-react'
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
import { SubjectSwitcher } from './subject-switcher'
import { heroStyle, toneStyle } from './subject-color'
import { useDayFlow } from './today/use-day-flow'
import { FlowList, FlowSchedule, mapHref, noteHref } from './today/flow-list'
import { AddToToday } from './today/add-to-today'
import { FocusNow } from './today/focus-now'
import { NextFocus } from './today/next-focus'
import { DayGlance } from './today/day-glance'
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
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

function Disclosure({ title, count, icon: Icon, children, id }: { title: string; count?: number | null; icon: typeof Flag; children: React.ReactNode; id: string }) {
  return (
    <details className="group rounded-2xl border border-white/8 bg-card/40 transition-colors open:bg-card/70 hover:border-white/14" data-more={id}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 text-sm font-medium text-foreground/85 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-foreground/60 group-open:text-nova-ink"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">{title}</span>
        {count ? <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-normal tabular-nums text-foreground/60">{count}</span> : null}
        <ChevronRight aria-hidden className="size-4 text-subtle transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t border-white/6 px-4 pb-5 pt-4">{children}</div>
    </details>
  )
}

// Today, for a Nova learner: a working page for the day. The learner's own
// subjects as coloured cards; the next thing in their flow opened out beside
// the day at a glance; the flow itself, theirs and saved
// (today/use-day-flow.ts → /api/nova/day), as a list or a schedule; and Nova
// beside it, who asks and proposes and changes nothing without a yes. The
// planner's suggestions, the task board and everything on record are a step
// away, in the sections below.
export function NovaHome({ view, subject, onSubject, refreshing }: Props) {
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
  const copilotInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { try { setNovaOpen(localStorage.getItem(LAYOUT) !== 'nova-hidden') } catch { /* storage off */ } }, [])
  const showNova = (open: boolean) => { setNovaOpen(open); try { localStorage.setItem(LAYOUT, open ? 'nova-shown' : 'nova-hidden') } catch { /* storage off */ } }
  // A session ending (here or on the focus screen) brings the flow up to date.
  useEffect(() => { if (live.ended) void day.load() }, [live.ended]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live.session) setMode('focus') }, [live.session?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!novaOnPhone) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNovaOnPhone(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [novaOnPhone])

  const flow = day.flow
  const name = firstName(view.learnerName)
  const tasks = board.view?.status === 'ready' ? board.tasks : null
  const sessionRunning = live.session !== null
  const openItems = flow?.items.filter(i => i.status === 'planned' || i.status === 'active') ?? []
  const ended = flow?.items.find(i => i.sessionEnded) ?? null
  const planned = openItems.filter(i => i.status === 'planned')
  const next = planned[0] ?? null
  const focusItem = flow?.items.find(i => i.status === 'active' && !i.sessionEnded) ?? null
  const inToday = (s: string | null) => (s === null ? openItems.length : openItems.filter(i => same(i.subjectName, s)).length)
  // What is in the chosen subject and not in today yet: to discover, not to schedule.
  const shelf = subject && flow ? flow.candidates.filter(c => same(c.subjectName, subject)).slice(0, 8) : []
  const progress = view.subjectProgress?.find(p => same(p.subjectName, subject)) ?? null

  const ops = useCallback((list: FlowOp[]) => day.ops(list), [day])
  const startItem = useCallback(async (item: FlowItemView, minutes: number) => {
    setStartingItem(item.id)
    const res = await day.act({ action: 'start', itemId: item.id, minutes }, { quiet: true })
    setStartingItem(null)
    if (res.ok) { await live.retry(); window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
  }, [day, live])
  const askNova = useCallback((m?: CopilotMode) => {
    if (m) setMode(m)
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
  const subjectsOnPage = [...new Set(openItems.map(i => i.subjectName).filter(Boolean))]
  const BTN = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3.5 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5 disabled:opacity-50'

  return (
    <div className="-mx-6 -mb-6 flex min-h-[calc(100vh-1rem)] lg:-mt-6" data-today-workspace>
      <div className="min-w-0 flex-1 px-4 pb-20 pt-14 sm:px-6 lg:px-8 lg:pt-7 xl:px-10">
        <div className="mx-auto w-full max-w-[74rem]">
          {/* ── The day: its date, a greeting, what it is for ──────────────── */}
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4" data-today-header>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">{date}</p>
              <h1 className="mt-1.5 text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[2rem]">
                {greetingFor(view.language, new Date().getHours())}{name ? <span className="text-foreground/45">, {name}</span> : ''}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href="/planner" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground" title="The full planner"><Columns2 className="size-4" /> <span className="max-sm:hidden">Planner</span></Link>
              <Link href="/planner?view=board" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground" title="Your task board"><KanbanSquare className="size-4" /> <span className="max-sm:hidden">Board</span></Link>
              <button type="button" disabled={!flow} onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-action-hover disabled:opacity-50" data-today-add>
                <Plus className="size-4" /> Add to today
              </button>
              {!novaOpen && <button type="button" onClick={() => showNova(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/35 bg-nova/[0.06] px-3 text-sm font-semibold text-nova-ink hover:bg-nova/12 max-lg:hidden" data-today-nova-show><Sparkles className="size-4" /> Nova</button>}
              <button type="button" onClick={() => setNovaOnPhone(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/35 bg-nova/[0.06] px-3 text-sm font-semibold text-nova-ink hover:bg-nova/12 lg:hidden"><Sparkles className="size-4" /> Nova</button>
            </div>
          </header>

          {flow && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-today-intention>
              <label className="group flex min-w-0 flex-1 basis-full items-center gap-2 rounded-xl border border-white/8 bg-card/40 px-3 transition-colors focus-within:border-nova/50 hover:border-white/14 sm:basis-auto">
                <Target aria-hidden className="size-4 shrink-0 text-nova-ink/80" />
                <span className="sr-only">What today is for</span>
                <input value={intention ?? flow.intention ?? ''} maxLength={280} placeholder="What do you want today to be about?"
                  onChange={e => setIntention(e.target.value)}
                  onBlur={() => { if (intention !== null && intention.trim() !== (flow.intention ?? '')) void day.ops([{ op: 'set_intention', text: intention.trim() || null }]).then(() => setIntention(null)); else setIntention(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setIntention(null); e.currentTarget.blur() } }}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-foreground/90 placeholder:text-foreground/40 focus:outline-none" data-intention-input />
              </label>
              {flow.budgetMinutes ? (
                <span className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/8 px-3 text-xs text-foreground/65" title="How long your planner gives today" data-today-time>
                  <Sun aria-hidden className="size-3.5 text-foreground/50" /> {minutesLabel(flow.budgetMinutes)} today
                </span>
              ) : null}
            </div>
          )}

          {/* ── Subjects: colour, progress, and what is in each ────────────── */}
          {view.subjectProgress && (
            <SubjectSwitcher progress={view.subjectProgress} focus={subject ?? null} onChoose={onSubject} busy={refreshing && subject !== (view.focusSubject ?? null)} inToday={flow ? inToday : undefined} />
          )}
          {subject && flow && (
            <section className="subject-tone nova-rise -mt-1 mb-2 rounded-2xl border border-[var(--sc-edge)] bg-[var(--sc-faint)] px-4 py-3.5" style={toneStyle(subject)} aria-label={`In ${subject}`} data-subject-shelf>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-foreground/85">
                  <span className="font-semibold text-[var(--sc-ink)]">{subject}</span>
                  {progress?.lastTopic ? <span className="text-foreground/60"> · last time: {progress.lastTopic}</span> : null}
                  {progress?.nextTopic ? <span className="text-foreground/60"> · next new topic: {progress.nextTopic}</span> : null}
                </p>
                <span className="flex gap-3 text-xs">
                  <Link href="/knowledge" className="text-foreground/60 hover:text-foreground">Knowledge</Link>
                  <button type="button" onClick={() => onSubject(null)} className="text-foreground/60 hover:text-foreground">All subjects</button>
                </span>
              </div>
              {shelf.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {shelf.map(c => (
                    <button key={`${c.kind}:${c.id}`} type="button" disabled={day.busy}
                      onClick={() => void day.ops([{ op: 'add', item: c.kind === 'task' ? { kind: 'task', taskId: c.id } : { kind: 'topic', topicId: c.id } }])}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--sc-edge)] bg-background/40 py-1 pl-2 pr-3 text-xs text-foreground/85 transition-colors hover:bg-[var(--sc-soft)] disabled:opacity-50"
                      title={`Add ${c.title} to today${c.why ? ` (${c.why})` : ''}`} data-shelf-add={c.id}>
                      <Plus aria-hidden className="size-3 text-[var(--sc-ink)]" /><span className="truncate">{c.title}</span>
                      {c.why && <span className="shrink-0 text-foreground/45">{c.why.startsWith('planned') ? 'planned' : c.why}</span>}
                    </button>
                  ))}
                </div>
              ) : <p className="mt-1.5 text-xs text-foreground/55">Everything open in {subject} is already in today.</p>}
            </section>
          )}

          {/* ── Now: the next thing, beside the day at a glance ───────────── */}
          <section aria-label="What's next" className="nova-hero relative isolate mt-6 overflow-hidden rounded-[1.75rem] border border-white/8 bg-card/50" style={heroStyle(subjectsOnPage)} data-today-now>
            <div aria-hidden className="nova-canvas pointer-events-none absolute inset-0 -z-10 opacity-60 [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
            <div className={cn('grid gap-6 p-4 sm:p-6 lg:gap-8 lg:p-7', flow && flow.items.length > 0 && 'xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]')}>
              <div className="min-w-0 space-y-4">
                {live.session && <FocusNow live={live} onAskNova={() => askNova('focus')} links={focusItem ? { notes: noteHref(focusItem), map: mapHref(focusItem) } : null} />}
                {!live.session && ended && (
                  <section className="rounded-2xl border border-nova/25 bg-nova/[0.05] px-4 py-3.5" role="status" data-session-ended={ended.id}>
                    <p className="text-sm text-foreground">You focused on <span className="font-medium">{ended.title}</span>{ended.spentMinutes ? ` for ${minutesLabel(ended.spentMinutes)}` : ''}. What next?</p>
                    <div className="mt-2.5 flex flex-wrap gap-2 text-sm">
                      <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'done' }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5" data-ended-done>Done for today</button>
                      <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5" data-ended-keep>Keep it in today</button>
                      {next && next.id !== ended.id && <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }, { op: 'move', id: next.id, to: 0 }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5">Next: {next.title}</button>}
                      <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }]).then(() => day.setNotice({ text: 'That’s it for today. Your flow is saved as it is.', tone: 'info', undo: false, at: Date.now() }))} className="rounded-lg px-3 py-1.5 text-subtle hover:text-foreground">Stop for today</button>
                    </div>
                  </section>
                )}

                {!flow ? (
                  day.loadError ? (
                    <div role="alert" className="rounded-xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">{day.loadError} <button type="button" onClick={() => void day.load()} className="ml-2 underline">Try again</button></div>
                  ) : <div aria-busy="true" className="h-56 animate-pulse rounded-2xl bg-white/4" />
                ) : !live.session && !ended && next ? (
                  <NextFocus item={next} place={openItems.indexOf(next)} then={planned[1] ?? null} disabled={day.busy || sessionRunning} starting={startingItem === next.id}
                    onStart={m => void startItem(next, m)} onAskNova={() => askNova('focus')} onLater={() => void day.ops([{ op: 'set_status', id: next.id, status: 'later' }])} />
                ) : !live.session && !ended && flow.draft && !flow.saved && !hideDraft ? (
                  <div className="rounded-2xl border border-dashed border-nova/40 bg-card/70 px-5 py-5" data-flow-draft>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-nova-ink">A suggested start · not saved</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">What’s due, and what your planner would pick</h2>
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {flow.draft.items.map(i => (
                        <li key={i.id} className={cn('subject-tone flex items-center justify-between gap-3', i.status === 'later' && 'text-subtle')} style={toneStyle(i.subjectName)}>
                          <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--sc)]" /><span className="truncate">{i.status === 'later' ? 'If there’s time: ' : ''}{i.title}</span><span className="shrink-0 text-xs text-subtle">{i.kind === 'task' ? 'task' : 'topic'}{i.subjectName ? ` · ${i.subjectName}` : ''}</span></span>
                          {i.minutes && <span className="shrink-0 text-xs tabular-nums text-subtle">{minutesLabel(i.minutes)}</span>}
                        </li>
                      ))}
                    </ul>
                    {flow.draft.reasons.length > 0 && <ul className="mt-3 space-y-0.5 text-xs leading-relaxed text-foreground/65">{flow.draft.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" disabled={day.busy} onClick={() => void day.act({ action: 'accept', draftId: flow.draft?.id })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover" data-draft-accept>
                        {day.busy && <Loader2 className="size-4 animate-spin" />} Use this for today
                      </button>
                      <button type="button" onClick={() => { setHideDraft(true); setAdding(true) }} className={BTN} data-draft-manual>Choose my own</button>
                      <button type="button" onClick={() => askNova('plan')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-nova-ink hover:bg-nova/10"><Sparkles className="size-4" /> Plan it with Nova</button>
                    </div>
                    <p className="mt-2 text-[11px] text-subtle">Nothing is saved until you choose. You can change anything after.</p>
                  </div>
                ) : !live.session && !ended ? (
                  <div className="rounded-2xl border border-white/8 bg-card/70 px-5 py-6" data-flow-empty>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-nova-ink">{flow.items.length ? 'Nothing left in the main flow' : 'A fresh day'}</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{flow.items.length ? 'Nicely done. Anything else today?' : 'What do you want today to be about?'}</h2>
                    <p className="mt-1.5 max-w-prose text-sm text-foreground/65">Pick your own work, or talk it through with Nova: it asks what matters, suggests something concrete, and changes nothing until you say yes.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover"><Plus className="size-4" /> Choose work</button>
                      <button type="button" onClick={() => askNova('plan')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/35 px-3.5 text-sm font-medium text-nova-ink hover:bg-nova/10"><Sparkles className="size-4" /> Plan with Nova</button>
                      {flow.draft && hideDraft && <button type="button" onClick={() => setHideDraft(false)} className={BTN}>See the suggested start</button>}
                    </div>
                  </div>
                ) : null}
              </div>
              {flow && flow.items.length > 0 && (
                <div className="min-w-0 rounded-2xl border border-white/8 bg-background/40 p-4 backdrop-blur-sm sm:p-5 xl:self-start">
                  <DayGlance flow={flow} busy={day.busy} onOps={l => void ops(l)} onAskNova={() => askNova('plan')} />
                </div>
              )}
            </div>
          </section>

          {/* ── Today's flow ─────────────────────────────────────────────── */}
          {flow && flow.items.length > 0 && (
            <section aria-labelledby="flow-heading" className="mt-6 rounded-[1.5rem] border border-white/8 bg-card/50 p-2 sm:p-3" data-today-flow>
              <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-2 pt-1.5 sm:px-3">
                <h2 id="flow-heading" className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-foreground">Today’s flow <span className="text-xs font-normal text-subtle">{openItems.length} open · drag to reorder</span></h2>
                <div className="flex items-center gap-2">
                  <div role="radiogroup" aria-label="Show today as" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                    {([['list', LayoutList, 'List'], ['schedule', CalendarDays, 'Schedule']] as const).map(([v, Icon, label]) => (
                      <button key={v} type="button" role="radio" aria-checked={flow.view === v} disabled={day.busy} onClick={() => void day.act({ action: 'view', view: v }, { quiet: true })}
                        className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1', flow.view === v ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground')} data-today-view={v}>
                        <Icon className="size-3.5" aria-hidden /> {label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setAdding(true)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-foreground/75 hover:bg-white/6 hover:text-foreground"><Plus className="size-3.5" /> Add</button>
                </div>
              </div>
              {flow.view === 'schedule'
                ? <div className="px-3 pb-2"><FlowSchedule flow={flow} busy={day.busy} onOps={l => void ops(l)} touched={day.touched} /></div>
                : <FlowList flow={flow} busy={day.busy} touched={day.touched} onOps={l => void ops(l)} onStart={(i, m) => void startItem(i, m)} starting={startingItem} sessionRunning={sessionRunning} subject={subject} />}
            </section>
          )}

          {/* ── Everything else, a step away ──────────────────────────────── */}
          <div className="mt-10" data-today-more>
            <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-subtle">More for today</h2>
            <div className="grid gap-2.5 lg:grid-cols-2 lg:items-start">
              <div className="space-y-2.5">
                <Disclosure id="deadlines" icon={Flag} title="Coming up" count={view.upcoming.length || null}>
                  <Deadlines exams={view.upcoming} tasks={tasks ?? []} />
                </Disclosure>
                <Disclosure id="recovery" icon={CalendarCheck} title="Overdue and catching up">
                  <RecoveryCard onChanged={() => { void board.refresh(); void day.load() }} />
                </Disclosure>
                <Disclosure id="tasks" icon={ListChecks} title="All open tasks" count={tasks ? tasks.filter(t => t.status !== 'done').length : null}>
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
                <Disclosure id="planner" icon={Columns2} title="Your planner’s view of today">
                  {view.plan.shortfall && <ShortfallNote shortfall={view.plan.shortfall} timeHref="/planner" />}
                  <p className="text-sm text-foreground/70">The planner works out what is most worth studying today from your record. Its blocks appear in Add to today as suggestions; it never fills your flow by itself.</p>
                  <AccountingFor constraints={view.constraints} />
                </Disclosure>
              </div>
              <div className="space-y-2.5">
                <Disclosure id="week" icon={TrendingUp} title="This week">
                  <WeekSoFar view={view} weeks={progressView} />
                  <div className="mt-6"><ContinueLearning view={view} busy={starting !== null} onResume={() => setAdding(true)} /></div>
                </Disclosure>
                <Disclosure id="knowledge" icon={Network} title="Your knowledge and recent notes">
                  <div className="space-y-12"><KnowledgeBoard map={map} reviewDue={view.reviewDue} /><RecentlyCaptured notes={notes} map={map} /></div>
                </Disclosure>
                <Disclosure id="you" icon={BookOpen} title="Goals, companion and Telegram">
                  <WorkingToward goals={view.goals} />
                  <div className="mt-6 space-y-3"><CompanionCard creature={creature.view} name={null} /><TelegramCard /></div>
                </Disclosure>
              </div>
            </div>
          </div>
          {refreshing && <p className="mt-2 text-xs text-subtle">Refreshing…</p>}
        </div>
      </div>

      {/* ── Nova beside the day: one panel, docked on a wide screen and a
          drawer on a narrow one; hidden, never unmounted, so its
          conversation and proposals survive closing it ─────────────────── */}
      {flow && novaOnPhone && <button type="button" className="fixed inset-0 z-40 bg-black/50 lg:hidden" aria-label="Close Nova" onClick={() => setNovaOnPhone(false)} />}
      {flow && (
        <aside
          className={cn(
            'flex-col overflow-hidden bg-background',
            novaOnPhone ? 'fixed inset-x-0 bottom-0 top-[8vh] z-50 flex rounded-t-2xl border-t border-white/10 shadow-float sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[min(26rem,92vw)] sm:rounded-none sm:border-l' : 'hidden',
            'lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[380px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:border-white/8 lg:shadow-none',
            novaOpen ? 'lg:flex' : 'lg:hidden',
          )}
          role={novaOnPhone ? 'dialog' : undefined} aria-modal={novaOnPhone ? true : undefined} aria-label="Nova" data-today-nova>
          <CopilotPanel flow={flow} mode={mode} onMode={setMode} inputRef={copilotInput} focusItem={focusItem ?? next}
            onAdopt={day.adopt} onApprove={day.approve} onUndo={() => void day.undo()} onReload={() => { void day.load(); void board.refresh() }}
            onClose={() => { if (novaOnPhone) setNovaOnPhone(false); else showNova(false) }} />
        </aside>
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

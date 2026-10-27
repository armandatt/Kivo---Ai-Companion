'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, KanbanSquare, Plus, Sparkles, Target, Undo2, X } from 'lucide-react'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import type { FlowItemView, FlowOp } from '@repo/api/nova/product/day-flow.types'
import { greetingFor } from '@repo/api/nova/product/greetings'
import { ShortfallNote } from './shortfall-note'
import { RecoveryCard } from './recovery-card'
import { AccountingFor } from './today-sections'
import { Deadlines } from './home-panels'
import { useTasks } from './tasks/use-tasks'
import { firstName } from './format'
import { useNovaSession } from './use-nova-session'
import { SubjectSwitcher } from './subject-switcher'
import { useDayFlow } from './today/use-day-flow'
import { mapHref, noteHref } from './today/flow-list'
import { AddToToday } from './today/add-to-today'
import { FocusNow } from './today/focus-now'
import { Playground, type OpenProposal } from './today/playground'
import { CopilotPanel, type CopilotHandle } from './today/copilot-panel'
import { BOARD_ID, TodayBoard } from './today/today-board'
import { PlannerLook } from './today/planner-look'
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

const LAYOUT = 'kivo-today-layout'
const SUBJECT = (day: string) => `kivo-today-subject:${day}`
const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

// Today, for a Nova learner: a planning studio. The learner designs their own
// day with Nova: the playground in the centre shows the flow they have saved
// (today/use-day-flow.ts → /api/nova/day), or Nova's proposal as it would
// stand, or an invitation to plan; nothing is put in the day before they
// choose it. Nova (today/copilot-panel.tsx) asks and proposes; only what the
// learner approves is written. The subject cards are top-level subjects only
// and choosing one is context for Nova, nothing more. The task board opens
// under the planning area (?board=open keeps it open across a reload, and is
// where old Planner links land); dates, overdue work and the week ahead are a
// step away in "More for today".
export function NovaHome({ view, refreshing }: Props) {
  const board = useTasks()
  const day = useDayFlow()
  const live = useNovaSession()
  const nova = useRef<CopilotHandle>(null)
  const copilotInput = useRef<HTMLTextAreaElement>(null)

  const [adding, setAdding] = useState(false)
  const [startingItem, setStartingItem] = useState<string | null>(null)
  const [novaOpen, setNovaOpen] = useState(true)
  const [novaOnPhone, setNovaOnPhone] = useState(false)
  const [intention, setIntention] = useState<string | null>(null)
  const [studio, setStudio] = useState<{ thinking: boolean; proposal: OpenProposal | null }>({ thinking: false, proposal: null })
  const [chosen, setChosen] = useState<string | null>(null)
  const [boardOpen, setBoardOpen] = useState(false)
  const [boardTask, setBoardTask] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const boardToggle = useRef<HTMLButtonElement>(null)

  const flow = day.flow
  useEffect(() => { try { setNovaOpen(localStorage.getItem(LAYOUT) !== 'nova-hidden') } catch { /* storage off */ } }, [])
  useEffect(() => { if (!flow) return; try { setChosen(sessionStorage.getItem(SUBJECT(flow.day))) } catch { /* storage off */ } }, [flow?.day]) // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (name: string | null) => { setChosen(name); try { if (flow) { if (name) sessionStorage.setItem(SUBJECT(flow.day), name); else sessionStorage.removeItem(SUBJECT(flow.day)) } } catch { /* storage off */ } }
  // The board's state is in the address, so a reload or a link keeps it.
  useEffect(() => {
    const at = new URLSearchParams(window.location.search)
    if (at.get('board') === 'open') { setBoardOpen(true); setBoardTask(at.get('task')) }
  }, [])
  const motion = (): ScrollBehavior => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
  const toggleBoard = (open: boolean, from: 'header' | 'board' = 'header') => {
    setBoardOpen(open)
    const url = new URL(window.location.href)
    if (open) url.searchParams.set('board', 'open'); else { url.searchParams.delete('board'); url.searchParams.delete('task') }
    window.history.replaceState(null, '', url)
    if (!open) setBoardTask(null)
    // Opening brings the board into view; closing from inside it goes back to
    // the button that opens it, so the page is not left scrolled past its end.
    if (open) window.setTimeout(() => document.getElementById(BOARD_ID)?.scrollIntoView({ block: 'start', behavior: motion() }), 0)
    else if (from === 'board') { boardToggle.current?.scrollIntoView({ block: 'nearest', behavior: motion() }); boardToggle.current?.focus({ preventScroll: true }) }
  }
  const showNova = (open: boolean) => { setNovaOpen(open); try { localStorage.setItem(LAYOUT, open ? 'nova-shown' : 'nova-hidden') } catch { /* storage off */ } }
  // A session ending (here or on the focus screen) brings the flow up to date.
  useEffect(() => { if (live.ended) void day.load() }, [live.ended]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!novaOnPhone) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNovaOnPhone(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [novaOnPhone])

  const name = firstName(view.learnerName)
  const sessionRunning = live.session !== null
  const ended = flow?.items.find(i => i.sessionEnded) ?? null
  const next = flow?.items.find(i => i.status === 'planned') ?? null
  const focusItem = flow?.items.find(i => i.status === 'active' && !i.sessionEnded) ?? null
  const subject = view.subjectProgress?.find(p => p.subjectName === chosen) ?? null

  const startItem = useCallback(async (item: FlowItemView, minutes: number) => {
    setStartingItem(item.id)
    const res = await day.act({ action: 'start', itemId: item.id, minutes }, { quiet: true })
    setStartingItem(null)
    if (res.ok) { await live.retry(); window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
  }, [day, live])
  const openNova = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) showNova(true); else setNovaOnPhone(true)
  }, [])
  const ask = useCallback((text: string) => { openNova(); nova.current?.send(text, { draftNow: text.toLowerCase().startsWith('just draft') }) }, [openNova])
  const createTask = useCallback(async (title: string) => {
    const ok = await board.create({ title })
    if (!ok) return null
    const made = (await fetch('/api/nova/tasks', { cache: 'no-store' }).then(r => r.json()).catch(() => null)) as { tasks?: Array<{ id: string; title: string; createdAt: string }> } | null
    const mine = made?.tasks?.filter(t => t.title === title).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    await day.load()
    return mine?.id ?? null
  }, [board, day])

  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const starters = subject ? [`Plan time for ${subject.subjectName}`, 'Plan my day', 'Just draft something'] : ['Plan my day with Nova', 'I want to learn something new', 'I have about an hour']

  return (
    <div className="-mx-6 -mb-6 flex min-h-[calc(100vh-1rem)] lg:-mt-6" data-today-workspace>
      <div className="min-w-0 flex-1 px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pt-7 xl:px-10">
        <div className="mx-auto w-full max-w-[72rem]">
          {/* ── The day ─────────────────────────────────────────────────── */}
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3" data-today-header>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">{date}</p>
              <h1 className="mt-1.5 text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
                {greetingFor(view.language, new Date().getHours())}{name ? <span className="text-foreground/45">, {name}</span> : ''}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" ref={boardToggle} onClick={() => toggleBoard(!boardOpen)} aria-expanded={boardOpen} aria-controls={BOARD_ID}
                className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm hover:bg-white/5 hover:text-foreground', boardOpen ? 'bg-white/6 text-foreground' : 'text-foreground/70')}
                aria-label="Board" title={boardOpen ? 'Close your task board' : 'Open your task board below'} data-today-board-toggle>
                <KanbanSquare className="size-4" /> <span className="max-sm:hidden">Board</span>
              </button>
              <button type="button" disabled={!flow} onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-sm font-medium text-foreground/85 hover:bg-white/5 disabled:opacity-50" data-today-add>
                <Plus className="size-4" /> Add myself
              </button>
              {!novaOpen && <button type="button" onClick={() => showNova(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/35 bg-nova/[0.06] px-3 text-sm font-semibold text-nova-ink hover:bg-nova/12 max-lg:hidden" data-today-nova-show><Sparkles className="size-4" /> Nova</button>}
              <button type="button" onClick={() => setNovaOnPhone(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-nova/35 bg-nova/[0.06] px-3 text-sm font-semibold text-nova-ink hover:bg-nova/12 lg:hidden" data-today-nova-phone><Sparkles className="size-4" /> Nova</button>
            </div>
          </header>

          {/* ── Subjects: top-level only; choosing one is context ───────── */}
          {view.subjectProgress && view.subjectProgress.length > 0 && (
            <SubjectSwitcher progress={view.subjectProgress} focus={chosen} onChoose={choose} busy={false} />
          )}

          {/* ── A session running, or one that just ended ──────────────── */}
          {(live.session || ended) && (
            <div className="mt-5 space-y-4">
              {live.session && <FocusNow live={live} onAskNova={openNova} links={focusItem ? { notes: noteHref(focusItem), map: mapHref(focusItem) } : null} />}
              {!live.session && ended && (
                <section className="rounded-2xl border border-nova/25 bg-nova/[0.05] px-4 py-3.5" role="status" data-session-ended={ended.id}>
                  <p className="text-sm text-foreground">You focused on <span className="font-medium">{ended.title}</span>{ended.spentMinutes ? ` for ${minutesLabel(ended.spentMinutes)}` : ''}. What next?</p>
                  <div className="mt-2.5 flex flex-wrap gap-2 text-sm">
                    <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'done' }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5" data-ended-done>Done for today</button>
                    <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5" data-ended-keep>Keep it in today</button>
                    {next && next.id !== ended.id && <button type="button" disabled={day.busy} onClick={() => void day.ops([{ op: 'set_status', id: ended.id, status: 'planned' }, { op: 'move', id: next.id, to: 0 }])} className="rounded-lg border border-white/12 px-3 py-1.5 hover:bg-white/5">Next: {next.title}</button>}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── The playground ──────────────────────────────────────────── */}
          <div className="mt-5">
            {day.loadError && !flow ? (
              <div role="alert" className="rounded-2xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">{day.loadError} <button type="button" onClick={() => void day.load()} className="ml-2 underline">Try again</button></div>
            ) : (
              <Playground flow={flow} proposal={studio.proposal} thinking={studio.thinking} busy={day.busy} touched={day.touched}
                sessionRunning={sessionRunning} starting={startingItem} starters={starters}
                onOps={(l: FlowOp[]) => void day.ops(l)} onStart={(i, m) => void startItem(i, m)}
                onView={v => void day.act({ action: 'view', view: v }, { quiet: true })}
                onApply={keep => nova.current?.apply(keep)} onDiscard={() => nova.current?.discard()}
                onChange={() => { openNova(); nova.current?.fill('Change something: ') }}
                onAsk={ask} onAdd={() => setAdding(true)} />
            )}
          </div>

          {flow && flow.saved && flow.items.length > 0 && (
            <label className="mt-4 flex items-center gap-2 rounded-xl border border-white/8 bg-card/40 px-3 transition-colors focus-within:border-nova/50" data-today-intention>
              <Target aria-hidden className="size-4 shrink-0 text-nova-ink/80" />
              <span className="sr-only">What today is for</span>
              <input value={intention ?? flow.intention ?? ''} maxLength={280} placeholder="What is today for? (optional)"
                onChange={e => setIntention(e.target.value)}
                onBlur={() => { if (intention !== null && intention.trim() !== (flow.intention ?? '')) void day.ops([{ op: 'set_intention', text: intention.trim() || null }]).then(() => setIntention(null)); else setIntention(null) }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setIntention(null); e.currentTarget.blur() } }}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground/90 placeholder:text-foreground/40 focus:outline-none" data-intention-input />
            </label>
          )}

          {/* ── The task board, when the learner opens it ───────────────── */}
          {boardOpen && <TodayBoard board={board} task={boardTask} onChanged={() => void day.load()} onClose={() => toggleBoard(false, 'board')} />}

          {/* ── A step away: dates, overdue work, the week ahead ────────── */}
          <details onToggle={e => setMoreOpen(e.currentTarget.open)} className="group rounded-2xl mt-8 border border-white/8 bg-card/30 transition-colors open:bg-card/60" data-today-more>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground/75 hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="flex-1">More for today <span className="font-normal text-foreground/50">· coming up, overdue work, the week ahead</span></span>
              <ChevronRight aria-hidden className="size-4 text-subtle transition-transform group-open:rotate-90" />
            </summary>
            <div className="grid gap-8 border-t border-white/6 px-4 pb-6 pt-5 lg:grid-cols-2">
              <div className="space-y-8">
                <Deadlines exams={view.upcoming} tasks={board.view?.status === 'ready' ? board.tasks : []} />
                <RecoveryCard onChanged={() => { void board.refresh(); void day.load() }} />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-foreground/70">Your planner’s view of today</h3>
                {view.plan.shortfall && <div className="mt-3"><ShortfallNote shortfall={view.plan.shortfall} /></div>}
                <p className="mt-2 text-sm text-foreground/70">The planner works out what is most worth studying today from your record. Its blocks appear in Add to today as suggestions; it never fills your flow by itself.</p>
                <AccountingFor constraints={view.constraints} />
                <p className="mt-4 text-xs text-foreground/55">How you are doing and what you know are on <Link href="/progress" className="underline">Progress</Link> and <Link href="/knowledge" className="underline">Knowledge</Link>.</p>
              </div>
              {moreOpen && <div className="border-t border-white/6 pt-6 lg:col-span-2"><PlannerLook /></div>}
            </div>
          </details>
          {refreshing && <p className="mt-2 text-xs text-subtle">Refreshing…</p>}
        </div>
      </div>

      {/* ── Nova: one panel, docked on a wide screen (about a third of it)
          and a drawer on a narrow one; hidden, never unmounted ──────────── */}
      {flow && novaOnPhone && <button type="button" className="fixed inset-0 z-40 bg-black/50 lg:hidden" aria-label="Close Nova" onClick={() => setNovaOnPhone(false)} />}
      {flow && (
        <aside
          className={cn(
            'flex-col overflow-hidden bg-background',
            novaOnPhone ? 'fixed inset-x-0 bottom-0 top-[8vh] z-50 flex rounded-t-2xl border-t border-white/10 shadow-float sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[min(28rem,92vw)] sm:rounded-none sm:border-l' : 'hidden',
            'lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[32%] lg:min-w-[340px] lg:max-w-[500px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:border-white/8 lg:bg-gradient-to-b lg:from-nova/[0.05] lg:to-background lg:shadow-none',
            novaOpen ? 'lg:flex' : 'lg:hidden',
          )}
          role={novaOnPhone ? 'dialog' : undefined} aria-modal={novaOnPhone ? true : undefined} aria-label="Nova" data-today-nova>
          <CopilotPanel ref={nova} flow={flow} inputRef={copilotInput}
            subject={subject ? { id: subject.subjectId ?? null, name: subject.subjectName } : null}
            onAdopt={day.adopt} onApprove={day.approve} onUndo={() => void day.undo()}
            onState={setStudio}
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

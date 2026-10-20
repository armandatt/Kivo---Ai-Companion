'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, Flag, Plus, Repeat } from 'lucide-react'
import type {
  CalendarDeadlineItem, CalendarEventInput, CalendarEventItem, CalendarTaskItem, EventCategory, NovaCalendarReady,
} from '@repo/api/nova/product/calendar.types'
import { EVENT_CATEGORY_LABEL } from '@repo/api/nova/product/calendar.types'
import type { NovaTaskItem, TaskInput } from '@repo/api/nova/product/tasks.types'
import { EmptyState, PageAction, PageHeader, PageNotice } from '@/components/dashboard/page-states'
import { BUTTON_PRIMARY, BUTTON_QUIET, LoadFailed, Skeleton } from '@/components/nova/workspace/ui'
import { TaskEditor } from '@/components/nova/tasks/task-editor'
import { useTasks } from '@/components/nova/tasks/use-tasks'
import { cn } from '@/lib/utils'
import {
  CALENDAR_MODES, WEEKDAYS, countOf, dayTitle, daysOf, emptyDay, itemsByDay, periodTitle, placeTimed, rangeFor, shift, shortDay,
  timeLabel, type CalendarMode, type DayItems,
} from './calendar-grid'
import { DeadlineDetail, DeadlineEditor, EventEditor, Modal, ReminderBadge, channelNote, repeatSummary } from './calendar-dialogs'
import { addDeadline, useCalendar } from './use-calendar'

// The learner's calendar: their events, their tasks on the day they are due,
// and their dated deadlines, in one place. The page draws what the server
// returns for the days on screen and keeps nothing of its own: every change is
// sent and the range read back. Tasks open the board's own editor and dates
// their own page, so each record keeps one place it is changed.

const MODE_KEY = 'kivo-calendar-view'
const MODE_LABEL: Record<CalendarMode, string> = { month: 'Month', week: 'Week', agenda: 'Agenda' }

// One restrained colour per kind of event: a thin bar and a dot, never a fill.
const CATEGORY_TONE: Record<EventCategory, string> = {
  class:    'bg-sky-500',
  meeting:  'bg-amber-500',
  study:    'bg-action',
  personal: 'bg-rose-500',
  other:    'bg-foreground/35',
}

type Dialog =
  | { kind: 'event'; event: CalendarEventItem | null; initial?: Partial<CalendarEventInput> }
  | { kind: 'task'; task: NovaTaskItem | null; day?: string }
  | { kind: 'deadline-new'; day: string }
  | { kind: 'deadline'; deadline: CalendarDeadlineItem }
  | { kind: 'choose'; day: string }

function readMode(): CalendarMode | null {
  try { const v = window.localStorage.getItem(MODE_KEY); return CALENDAR_MODES.includes(v as CalendarMode) ? v as CalendarMode : null } catch { return null }
}

export function NovaCalendar({ initialToday }: { initialToday: string }) {
  const [mode, setMode] = useState<CalendarMode>('month')
  const [anchor, setAnchor] = useState(initialToday)
  const [selected, setSelected] = useState(initialToday)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const range = rangeFor(mode, anchor)
  const cal = useCalendar(range)
  const tasks = useTasks()

  useEffect(() => {
    const stored = readMode()
    if (stored) setMode(stored)
    else if (window.matchMedia('(max-width: 639px)').matches) setMode('agenda')
  }, [])
  const choose = (next: CalendarMode) => { setMode(next); try { window.localStorage.setItem(MODE_KEY, next) } catch { /* storage unavailable */ } }

  const view = cal.view?.status === 'ready' ? cal.view : null
  const today = view?.today ?? initialToday
  const byDay = useMemo(() => (view ? itemsByDay(view, range.from, range.to, view.timezone) : new Map<string, DayItems>()), [view, range.from, range.to])
  const total = useMemo(() => [...byDay.values()].reduce((n, d) => n + countOf(d), 0), [byDay])

  const goToday = () => { setAnchor(today); setSelected(today) }
  const go = (by: -1 | 1) => setAnchor(a => shift(mode, a, by))

  // An account that is not a set-up Nova learner is told so, not shown an empty grid.
  if (cal.view && cal.view.status !== 'ready') {
    return (
      <PageNotice title="Your calendar opens once Nova is set up" action={<PageAction href="/home">Go to Today</PageAction>}>
        Tell Nova what you are studying from Today. Your events, tasks and dates then live here together.
      </PageNotice>
    )
  }

  const openTask = (id: string) => {
    const task = tasks.tasks.find(t => t.id === id) ?? null
    if (task) setDialog({ kind: 'task', task })
  }

  const refreshBoth = async () => { await Promise.all([cal.refresh(), tasks.refresh()]) }

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Your events, the tasks due each day and your exam and deadline dates, together."
        actions={
          <button type="button" onClick={() => setDialog({ kind: 'choose', day: selected < today && mode !== 'agenda' ? today : selected })} className={BUTTON_PRIMARY}>
            <Plus aria-hidden className="size-4" /> New
          </button>
        }
      />

      {/* Toolbar */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goToday} className={cn(BUTTON_QUIET, 'h-9 px-3.5')}>Today</button>
          <div className="flex">
            <button type="button" onClick={() => go(-1)} aria-label={`Previous ${mode === 'agenda' ? 'four weeks' : mode}`} className="grid size-9 place-items-center rounded-lg text-foreground/70 hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <ChevronLeft aria-hidden className="size-4" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={`Next ${mode === 'agenda' ? 'four weeks' : mode}`} className="grid size-9 place-items-center rounded-lg text-foreground/70 hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground" aria-live="polite">{periodTitle(mode, anchor)}</h2>
        </div>
        <div role="group" aria-label="Calendar view" className="flex rounded-lg border border-white/10 p-0.5">
          {CALENDAR_MODES.map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => choose(m)}
              className={cn('h-8 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                mode === m ? 'bg-action-soft text-foreground' : 'text-foreground/60 hover:text-foreground')}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <Legend />

      {cal.error && <p role="alert" className="mt-4 text-sm text-red-500">{cal.error}</p>}

      <div className="mt-4" aria-busy={cal.loading || cal.refreshing}>
        {cal.loading && !view ? <CalendarSkeleton mode={mode} />
          : cal.loadError && !view ? <LoadFailed what="Your calendar" onRetry={() => void cal.refresh()} className="py-10" />
          : view ? (
            <>
              {total === 0 && (
                <EmptyState icon={CalendarDays} title="Nothing on your calendar here yet" className="mb-4"
                  action={<button type="button" onClick={() => setDialog({ kind: 'choose', day: selected < today ? today : selected })} className={BUTTON_PRIMARY}><Plus aria-hidden className="size-4" /> Add something</button>}>
                  Add a class, a study block or a deadline. Tasks with a due day and your exam dates appear here on their own.
                </EmptyState>
              )}
              {mode === 'month' && (
                <MonthView view={view} anchor={anchor} byDay={byDay} selected={selected}
                  onSelect={setSelected} onAdd={day => setDialog({ kind: 'choose', day })}
                  onEvent={e => setDialog({ kind: 'event', event: e })} onTask={openTask} onDeadline={d => setDialog({ kind: 'deadline', deadline: d })} />
              )}
              {mode === 'week' && (
                <WeekView view={view} from={range.from} byDay={byDay}
                  onAdd={(day, startTime) => setDialog(startTime ? { kind: 'event', event: null, initial: { startDay: day, startTime, endTime: endOf(startTime) } } : { kind: 'choose', day })}
                  onEvent={e => setDialog({ kind: 'event', event: e })} onTask={openTask} onDeadline={d => setDialog({ kind: 'deadline', deadline: d })} />
              )}
              {mode === 'agenda' && (
                <AgendaView view={view} from={range.from} to={range.to} byDay={byDay}
                  onEvent={e => setDialog({ kind: 'event', event: e })} onTask={openTask} onDeadline={d => setDialog({ kind: 'deadline', deadline: d })} />
              )}
            </>
          ) : null}
      </div>

      {/* Dialogs */}
      {dialog?.kind === 'choose' && view && (
        <ChooseKind day={dialog.day} reminderNote={view.reminders.channel === 'telegram' ? null : channelNote(view.reminders)}
          onClose={() => setDialog(null)}
          onPick={kind => setDialog(kind === 'event' ? { kind: 'event', event: null, initial: { startDay: dialog.day } }
            : kind === 'task' ? { kind: 'task', task: null, day: dialog.day } : { kind: 'deadline-new', day: dialog.day })} />
      )}
      {dialog?.kind === 'event' && view && (
        <EventEditor event={dialog.event} initial={dialog.initial} view={view} error={cal.error}
          onClose={() => { cal.clearError(); setDialog(null) }}
          onSave={input => dialog.event ? cal.update(dialog.event.id, input) : cal.create(input)}
          onDelete={dialog.event ? () => cal.remove(dialog.event!.id) : undefined}
          onDeleteOccurrence={dialog.event?.repeat ? () => cal.removeOccurrence(dialog.event!.id, dialog.event!.startDay) : undefined} />
      )}
      {dialog?.kind === 'task' && (
        <TaskEditor task={dialog.task} subjects={tasks.view?.status === 'ready' ? tasks.view.subjects : []} initialDueDay={dialog.day} error={tasks.error}
          onClose={() => { tasks.clearError(); setDialog(null) }}
          onSave={async (input: TaskInput) => { const ok = dialog.task ? await tasks.update(dialog.task.id, input) : await tasks.create(input); await cal.refresh(); return ok }}
          onDelete={dialog.task ? async () => { const ok = await tasks.remove(dialog.task!.id); await cal.refresh(); return ok } : undefined}
          extra={dialog.task && dialog.task.status !== 'done' ? (
            // Time set aside for the task points at it; the task is not copied.
            <button type="button" className={cn(BUTTON_QUIET, 'h-9')}
              onClick={() => { const t = dialog.task!; setDialog({ kind: 'event', event: null, initial: { title: t.title, category: 'study', taskId: t.id, startDay: t.dueDay && t.dueDay >= today ? t.dueDay : today } }) }}>
              <CalendarDays aria-hidden className="size-4" /> Set aside time on the calendar
            </button>
          ) : undefined} />
      )}
      {dialog?.kind === 'deadline-new' && view && (
        <DeadlineEditor day={dialog.day} view={view} onClose={() => setDialog(null)}
          onSave={async input => {
            const result = await addDeadline(input)
            if (!result.ok) return result.message
            // "exists": that date was already on record and shows as it is.
            await refreshBoth()
            return null
          }} />
      )}
      {dialog?.kind === 'deadline' && <DeadlineDetail deadline={dialog.deadline} onClose={() => setDialog(null)} />}
    </div>
  )
}

const endOf = (start: string): string => {
  const [h, m] = start.split(':').map(Number) as [number, number]
  const end = Math.min(23 * 60 + 59, h * 60 + m + 60)
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

function Legend() {
  return (
    <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-foreground/60" aria-label="What the marks mean">
      <li className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-1 rounded-full bg-action" />Event (colour is its kind)</li>
      <li className="flex items-center gap-1.5"><Circle aria-hidden className="size-3" />Task due</li>
      <li className="flex items-center gap-1.5"><Flag aria-hidden className="size-3" />Exam or deadline</li>
    </ul>
  )
}

function CalendarSkeleton({ mode }: { mode: CalendarMode }) {
  if (mode === 'agenda') return <div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
  return (
    <div aria-label="Loading your calendar" className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-white/8">
      {Array.from({ length: mode === 'week' ? 7 : 35 }, (_, i) => <Skeleton key={i} className={cn('rounded-none', mode === 'week' ? 'h-96' : 'h-24')} />)}
    </div>
  )
}

// ── Items ─────────────────────────────────────────────────────────────────────

type ItemHandlers = { onEvent: (e: CalendarEventItem) => void; onTask: (id: string) => void; onDeadline: (d: CalendarDeadlineItem) => void }

function EventChip({ event, timezone, onEvent, compact }: { event: CalendarEventItem; timezone: string; onEvent: ItemHandlers['onEvent']; compact?: boolean }) {
  const time = !event.allDay && event.startAt ? timeLabel(event.startAt, timezone) : null
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onEvent(event) }}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-foreground/85 transition-colors hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${EVENT_CATEGORY_LABEL[event.category]}: ${event.title}${time ? ` at ${time}` : ', all day'}${event.repeat ? ', repeats' : ''}`}>
      <span aria-hidden className={cn('h-3 w-1 shrink-0 rounded-full', CATEGORY_TONE[event.category])} />
      {time && !compact && <span className="shrink-0 tabular-nums text-foreground/55">{time}</span>}
      <span className="truncate">{event.title}</span>
      {event.repeat && <Repeat aria-hidden className="size-3 shrink-0 text-foreground/45" />}
    </button>
  )
}

function TaskChip({ task, onTask }: { task: CalendarTaskItem; onTask: ItemHandlers['onTask'] }) {
  const Icon = task.status === 'done' ? CheckCircle2 : Circle
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onTask(task.id) }}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Task due: ${task.title}${task.status === 'done' ? ', done' : task.overdue ? ', overdue' : ''}`}>
      <Icon aria-hidden className={cn('size-3 shrink-0', task.status === 'done' ? 'text-action-ink' : task.overdue ? 'text-red-500' : 'text-foreground/50')} />
      <span className={cn('truncate', task.status === 'done' ? 'text-foreground/45 line-through' : 'text-foreground/80')}>{task.title}</span>
    </button>
  )
}

function DeadlineChip({ deadline, onDeadline }: { deadline: CalendarDeadlineItem; onDeadline: ItemHandlers['onDeadline'] }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onDeadline(deadline) }}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs font-semibold text-foreground transition-colors hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${deadline.kindLabel}: ${deadline.title}`}>
      <Flag aria-hidden className="size-3 shrink-0 text-red-500" />
      <span className="truncate">{deadline.title}</span>
    </button>
  )
}

function DayList({ items, timezone, handlers }: { items: DayItems; timezone: string; handlers: ItemHandlers }) {
  return (
    <div className="space-y-0.5">
      {items.deadlines.map(d => <DeadlineChip key={`d${d.id}`} deadline={d} onDeadline={handlers.onDeadline} />)}
      {items.allDay.map(e => <EventChip key={`a${e.key ?? e.id}`} event={e} timezone={timezone} onEvent={handlers.onEvent} />)}
      {items.timed.map(e => <EventChip key={`t${e.key ?? e.id}`} event={e} timezone={timezone} onEvent={handlers.onEvent} />)}
      {items.tasks.map(t => <TaskChip key={`k${t.id}`} task={t} onTask={handlers.onTask} />)}
    </div>
  )
}

// ── Month ─────────────────────────────────────────────────────────────────────

const CELL_ITEMS = 3

function MonthView({ view, anchor, byDay, selected, onSelect, onAdd, ...handlers }: ItemHandlers & {
  view: NovaCalendarReady; anchor: string; byDay: Map<string, DayItems>; selected: string
  onSelect: (day: string) => void; onAdd: (day: string) => void
}) {
  const { from, to } = rangeFor('month', anchor)
  const month = anchor.slice(0, 7)
  const chosen = byDay.get(selected) ?? emptyDay()
  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-card/40">
        <div className="grid grid-cols-7 border-b border-white/8 text-center text-[11px] font-medium uppercase tracking-wider text-subtle">
          {WEEKDAYS.map(d => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {daysOf(from, to).map((day, i) => {
            const items = byDay.get(day)
            const n = countOf(items)
            const inMonth = day.slice(0, 7) === month
            const isToday = day === view.today
            const flat = items ? [
              ...items.deadlines.map(d => ({ key: `d${d.id}`, node: <DeadlineChip deadline={d} onDeadline={handlers.onDeadline} /> })),
              ...items.allDay.map(e => ({ key: `a${e.key ?? e.id}`, node: <EventChip event={e} timezone={view.timezone} onEvent={handlers.onEvent} compact /> })),
              ...items.timed.map(e => ({ key: `t${e.key ?? e.id}`, node: <EventChip event={e} timezone={view.timezone} onEvent={handlers.onEvent} /> })),
              ...items.tasks.map(t => ({ key: `k${t.id}`, node: <TaskChip task={t} onTask={handlers.onTask} /> })),
            ] : []
            return (
              <div key={day}
                className={cn('group relative min-h-[5.5rem] border-white/8 p-1 sm:min-h-28', i % 7 !== 6 && 'border-r', i < 35 && 'border-b',
                  !inMonth && 'bg-white/2', selected === day && 'bg-action-soft/60')}>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => onSelect(day)} aria-pressed={selected === day}
                    aria-label={`${dayTitle(day)}${isToday ? ', today' : ''}${n ? `, ${n} item${n === 1 ? '' : 's'}` : ''}`}
                    className={cn('grid size-7 place-items-center rounded-full text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-ring',
                      isToday ? 'bg-action text-action-foreground' : inMonth ? 'text-foreground/85 hover:bg-white/6' : 'text-foreground/40 hover:bg-white/6')}>
                    {Number(day.slice(8))}
                  </button>
                  <button type="button" onClick={() => onAdd(day)} aria-label={`Add on ${dayTitle(day)}`}
                    className="grid size-6 place-items-center rounded-md text-foreground/45 opacity-0 transition-opacity hover:bg-white/6 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100">
                    <Plus aria-hidden className="size-3.5" />
                  </button>
                </div>
                {/* Wider screens list a few; a phone shows dots and the day below. */}
                <div className="mt-0.5 hidden space-y-0.5 sm:block">
                  {flat.slice(0, CELL_ITEMS).map(x => <div key={x.key}>{x.node}</div>)}
                  {flat.length > CELL_ITEMS && (
                    <button type="button" onClick={() => onSelect(day)} className="px-1.5 text-xs font-medium text-foreground/60 hover:text-foreground">+{flat.length - CELL_ITEMS} more</button>
                  )}
                </div>
                {n > 0 && (
                  <div aria-hidden className="mt-1 flex flex-wrap gap-0.5 px-1 sm:hidden">
                    {items!.deadlines.length > 0 && <span className="size-1.5 rounded-full bg-red-500" />}
                    {[...items!.allDay, ...items!.timed].slice(0, 3).map(e => <span key={e.key ?? e.id} className={cn('size-1.5 rounded-full', CATEGORY_TONE[e.category])} />)}
                    {items!.tasks.length > 0 && <span className="size-1.5 rounded-full bg-foreground/40" />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* The chosen day, in full. */}
      <section className="mt-6" aria-labelledby="day-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="day-title" className="text-sm font-semibold text-foreground">{dayTitle(selected)}{selected === view.today ? ' · Today' : ''}</h3>
          <button type="button" onClick={() => onAdd(selected)} className={cn(BUTTON_QUIET, 'h-8')}><Plus aria-hidden className="size-3.5" /> Add</button>
        </div>
        {countOf(chosen) === 0
          ? <p className="mt-2 text-sm text-foreground/55">Nothing on this day.</p>
          : <div className="mt-2 max-w-xl"><DayDetail items={chosen} timezone={view.timezone} handlers={handlers} /></div>}
      </section>
    </div>
  )
}

// A day's items as rows, with times and reminder state.
function DayDetail({ items, timezone, handlers }: { items: DayItems; timezone: string; handlers: ItemHandlers }) {
  const row = 'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-ring'
  return (
    <ul className="divide-y divide-white/6 rounded-2xl border border-white/8">
      {items.deadlines.map(d => (
        <li key={`d${d.id}`}><button type="button" onClick={() => handlers.onDeadline(d)} className={row}>
          <Flag aria-hidden className="mt-0.5 size-4 shrink-0 text-red-500" />
          <span className="min-w-0"><span className="block text-sm font-semibold text-foreground">{d.title}</span>
            <span className="block text-xs text-foreground/60">{d.kindLabel}{d.subjectName ? ` · ${d.subjectName}` : ''}</span></span>
        </button></li>
      ))}
      {[...items.allDay, ...items.timed].map(e => (
        <li key={`e${e.key ?? e.id}`}><button type="button" onClick={() => handlers.onEvent(e)} className={row}>
          <span aria-hidden className={cn('mt-1 h-4 w-1 shrink-0 rounded-full', CATEGORY_TONE[e.category])} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">{e.title}{e.repeat && <span className="inline-flex items-center gap-1 text-xs font-normal text-foreground/55"><Repeat aria-hidden className="size-3" />{repeatSummary(e.repeat, e.seriesStartDay ?? e.startDay)}</span>}</span>
            <span className="block text-xs text-foreground/60">
              {e.allDay || !e.startAt ? 'All day' : `${timeLabel(e.startAt, timezone)}${e.endAt ? `–${timeLabel(e.endAt, timezone)}` : ''}`}
              {' · '}{EVENT_CATEGORY_LABEL[e.category]}{e.task ? ` · for “${e.task.title}”` : ''}{e.subject ? ` · ${e.subject.name}` : ''}
            </span>
            {e.reminder && <span className="mt-0.5 block"><ReminderBadge status={e.reminder.status} /></span>}
          </span>
        </button></li>
      ))}
      {items.tasks.map(t => (
        <li key={`k${t.id}`}><button type="button" onClick={() => handlers.onTask(t.id)} className={row}>
          {t.status === 'done' ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-action-ink" /> : <Circle aria-hidden className={cn('mt-0.5 size-4 shrink-0', t.overdue ? 'text-red-500' : 'text-foreground/50')} />}
          <span className="min-w-0"><span className={cn('block text-sm', t.status === 'done' ? 'text-foreground/50 line-through' : 'text-foreground')}>{t.title}</span>
            <span className="block text-xs text-foreground/60">Task due{t.overdue ? ' · overdue' : ''}{t.subjectName ? ` · ${t.subjectName}` : ''}</span></span>
        </button></li>
      ))}
    </ul>
  )
}

// ── Week ──────────────────────────────────────────────────────────────────────

const HOUR_PX = 44

function WeekView({ view, from, byDay, onAdd, ...handlers }: ItemHandlers & {
  view: NovaCalendarReady; from: string; byDay: Map<string, DayItems>; onAdd: (day: string, startTime?: string) => void
}) {
  const days = daysOf(from, rangeFor('week', from).to)
  const scroller = useRef<HTMLDivElement>(null)
  // Opens on the working day, not at midnight.
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX }, [])
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 bg-card/40">
      <div className="min-w-[44rem]">
        {/* Day heads */}
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-white/8">
          <div />
          {days.map(day => (
            <div key={day} className="border-l border-white/8 px-2 py-2 text-center">
              <span className={cn('inline-grid min-w-8 place-items-center rounded-full px-2 py-0.5 text-sm font-medium',
                day === view.today ? 'bg-action text-action-foreground' : 'text-foreground/80')}>{shortDay(day)}</span>
            </div>
          ))}
        </div>
        {/* All-day, tasks and deadlines */}
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-white/8">
          <div className="px-1 py-2 text-right text-[10px] uppercase tracking-wider text-subtle">All day</div>
          {days.map(day => {
            const items = byDay.get(day) ?? emptyDay()
            return (
              <div key={day} className="min-h-10 border-l border-white/8 p-1">
                <DayList items={{ ...items, timed: [] }} timezone={view.timezone} handlers={handlers} />
              </div>
            )
          })}
        </div>
        {/* Hours */}
        <div ref={scroller} className="max-h-[36rem] overflow-y-auto">
          <div className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-subtle" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span>
              ))}
            </div>
            {days.map(day => (
              <div key={day} className="relative border-l border-white/8">
                {Array.from({ length: 24 }, (_, h) => (
                  <button key={h} type="button" onClick={() => onAdd(day, `${String(h).padStart(2, '0')}:00`)}
                    aria-label={`Add an event on ${dayTitle(day)} at ${String(h).padStart(2, '0')}:00`}
                    className="absolute inset-x-0 border-t border-white/6 hover:bg-white/3 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring"
                    style={{ top: h * HOUR_PX, height: HOUR_PX }} />
                ))}
                {placeTimed((byDay.get(day) ?? emptyDay()).timed, day, view.timezone).map(p => (
                  <button key={p.event.key ?? p.event.id} type="button" onClick={() => handlers.onEvent(p.event)}
                    className="absolute z-10 overflow-hidden rounded-lg border border-white/10 bg-card px-1.5 py-1 text-left text-xs shadow-soft transition-colors hover:border-white/25 focus-visible:outline-2 focus-visible:outline-ring"
                    style={{ top: (p.top / 60) * HOUR_PX, height: Math.max(22, (p.height / 60) * HOUR_PX - 2), left: `calc(${(p.column / p.columns) * 100}% + 2px)`, width: `calc(${100 / p.columns}% - 4px)` }}
                    aria-label={`${EVENT_CATEGORY_LABEL[p.event.category]}: ${p.event.title} at ${timeLabel(p.event.startAt!, view.timezone)}${p.event.repeat ? ', repeats' : ''}`}>
                    <span aria-hidden className={cn('absolute inset-y-1 left-0.5 w-1 rounded-full', CATEGORY_TONE[p.event.category])} />
                    <span className="block truncate pl-1.5 font-medium text-foreground">{p.event.title}</span>
                    <span className="block truncate pl-1.5 tabular-nums text-foreground/60">{timeLabel(p.event.startAt!, view.timezone)}{p.event.endAt ? `–${timeLabel(p.event.endAt, view.timezone)}` : ''}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Agenda ────────────────────────────────────────────────────────────────────

function AgendaView({ view, from, to, byDay, ...handlers }: ItemHandlers & { view: NovaCalendarReady; from: string; to: string; byDay: Map<string, DayItems> }) {
  const days = daysOf(from, to).filter(d => countOf(byDay.get(d)) > 0)
  if (days.length === 0) return <p className="py-6 text-sm text-foreground/60">Nothing in these four weeks.</p>
  return (
    <ol className="space-y-6">
      {days.map(day => (
        <li key={day} className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <h3 className={cn('text-sm font-semibold', day === view.today ? 'text-action-ink' : 'text-foreground/85')}>
            {dayTitle(day)}{day === view.today ? ' · Today' : ''}
          </h3>
          <DayDetail items={byDay.get(day)!} timezone={view.timezone} handlers={handlers} />
        </li>
      ))}
    </ol>
  )
}

// ── Creating ──────────────────────────────────────────────────────────────────

function ChooseKind({ day, reminderNote, onPick, onClose }: { day: string; reminderNote: string | null; onPick: (kind: 'event' | 'task' | 'deadline') => void; onClose: () => void }) {
  const option = 'flex w-full items-start gap-3 rounded-2xl border border-white/10 px-4 py-3 text-left transition-colors hover:border-white/25 hover:bg-white/3 focus-visible:outline-2 focus-visible:outline-ring'
  return (
    <Modal label={`Add on ${dayTitle(day)}`} onClose={onClose}>
      <div className="mt-4 space-y-2">
        <button type="button" data-autofocus onClick={() => onPick('event')} className={option}>
          <span aria-hidden className="mt-1 h-4 w-1 rounded-full bg-action" />
          <span><span className="block text-sm font-semibold text-foreground">Event</span><span className="block text-sm text-foreground/60">A class, meeting, study block or anything at a time. Can remind you.</span></span>
        </button>
        <button type="button" onClick={() => onPick('task')} className={option}>
          <Circle aria-hidden className="mt-0.5 size-4 text-foreground/55" />
          <span><span className="block text-sm font-semibold text-foreground">Task due this day</span><span className="block text-sm text-foreground/60">Goes on your Planner board too.</span></span>
        </button>
        <button type="button" onClick={() => onPick('deadline')} className={option}>
          <Flag aria-hidden className="mt-0.5 size-4 text-red-500" />
          <span><span className="block text-sm font-semibold text-foreground">Exam or deadline</span><span className="block text-sm text-foreground/60">Saved with your dates, so Nova plans around it.</span></span>
        </button>
      </div>
      {reminderNote && <p className="mt-4 text-xs text-foreground/60">{reminderNote}</p>}
    </Modal>
  )
}

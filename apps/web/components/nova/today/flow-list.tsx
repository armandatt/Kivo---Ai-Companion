'use client'

// Today's flow, drawn two ways from the one saved list: as a list in the
// learner's order (the default), or as time blocks from now (the schedule
// view). Every control is one change sent to the server (use-day-flow.ts):
// moving, a time for today, done for today, "if there's time", out of
// today. Nothing here changes a task: the task's own status, estimate and
// due day are the board's.

import { useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronUp, Clock, GripVertical, Map as MapIcon, MoreHorizontal, NotebookPen, Scissors, X } from 'lucide-react'
import type { FlowItemView, FlowOp, NovaDayView } from '@repo/api/nova/product/day-flow.types'
import { clockLabel, scheduleOf } from '@repo/api/nova/product/day-flow-rules'
import { cn } from '@/lib/utils'
import { toneStyle } from '../subject-color'
import { StartControl } from './start-control'

const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)
const KIND_WORD = { task: 'Task', topic: 'Topic', focus: 'Focus' } as const

function dueWord(d: number | null | undefined): { text: string; urgent: boolean } | null {
  if (d === null || d === undefined) return null
  return d < 0 ? { text: `${-d}d overdue`, urgent: true } : d === 0 ? { text: 'Due today', urgent: true } : d === 1 ? { text: 'Due tomorrow', urgent: false } : null
}

export function noteHref(item: FlowItemView) {
  return `/notes?q=${encodeURIComponent(item.topicName ?? item.title)}`
}
export function mapHref(item: FlowItemView) {
  return item.topicId ? `/map?focus=${encodeURIComponent(`topic:${item.topicId}`)}` : '/map'
}

function Minutes({ item, onSet, disabled }: { item: FlowItemView; onSet: (m: number | null) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  if (editing) {
    return (
      <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); const n = Number(value); setEditing(false); if (!value.trim()) onSet(null); else if (Number.isInteger(n) && n >= 5 && n <= 480) onSet(n) }}>
        <label className="sr-only" htmlFor={`m-${item.id}`}>Minutes today for {item.title}</label>
        <input id={`m-${item.id}`} autoFocus inputMode="numeric" value={value} onChange={e => setValue(e.target.value.slice(0, 3))}
          onBlur={e => e.currentTarget.form?.requestSubmit()} onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
          className="h-7 w-14 rounded-md border border-white/12 bg-transparent px-1.5 text-xs text-foreground focus:border-nova/60 focus:outline-none" />
        <span className="text-[11px] text-subtle">min</span>
      </form>
    )
  }
  return (
    <button type="button" disabled={disabled} onClick={() => { setValue(item.minutes ? String(item.minutes) : ''); setEditing(true) }}
      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-foreground/70 hover:bg-white/5 hover:text-foreground disabled:opacity-50"
      title="Today’s time for it (the task’s own estimate is unchanged)" data-item-minutes>
      <Clock className="size-3" aria-hidden /> {item.minutes ? minutesLabel(item.minutes) : 'Add time'}
    </button>
  )
}

type MenuAction = { icon: typeof X; label: string; run?: () => void; href?: string }

function Row({ item, index, count, active, busy, touched, dim, onOps, onStart, startBusy, dragging, onDrag }: {
  item: FlowItemView; index: number; count: number; active: boolean; busy: boolean; touched: boolean
  // Another subject is chosen above: this row stays, quieter.
  dim: boolean
  onOps: (ops: FlowOp[]) => void; onStart: (minutes: number) => void; startBusy: boolean
  dragging: { id: string | null; set: (id: string | null) => void }; onDrag: (to: number) => void
}) {
  const [menu, setMenu] = useState(false)
  const due = item.ref && 'dueInDays' in item.ref ? dueWord(item.ref.dueInDays) : null
  const done = item.status === 'done'
  const running = item.status === 'active' && !item.sessionEnded
  const context = item.kind === 'task' && item.topicName ? item.topicName : null
  return (
    <li draggable={!busy} onDragStart={e => { dragging.set(item.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => dragging.set(null)}
      onDragOver={e => { if (dragging.id && dragging.id !== item.id) e.preventDefault() }} onDrop={e => { e.preventDefault(); onDrag(index) }}
      onKeyDown={e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const to = index + (e.key === 'ArrowUp' ? -1 : 1); if (to >= 0 && to < count) onOps([{ op: 'move', id: item.id, to }]) } }}
      style={toneStyle(item.subjectName)}
      className={cn('subject-tone group relative flex flex-wrap items-center gap-2 rounded-xl py-2.5 pl-3 pr-1.5 transition-[background-color,opacity] hover:bg-white/[0.03] sm:flex-nowrap', touched && 'nova-changed', running && 'bg-[var(--sc-faint)]', dragging.id === item.id && 'opacity-50', dim && !touched && 'opacity-45 hover:opacity-100')}
      data-flow-item={item.id} data-flow-status={item.status} data-flow-kind={item.kind}>
      <span aria-hidden className={cn('absolute inset-y-2 left-0 w-1 rounded-full bg-[var(--sc)]', done || item.status === 'later' ? 'opacity-35' : 'opacity-85')} />
      <span aria-hidden className="hidden w-4 cursor-grab text-foreground/20 group-hover:text-foreground/50 sm:inline"><GripVertical className="size-4" /></span>
      <button type="button" disabled={busy} onClick={() => onOps([{ op: 'set_status', id: item.id, status: done ? 'planned' : 'done' }])}
        aria-pressed={done} aria-label={done ? `${item.title}: back to today's flow` : `${item.title}: done for today`}
        title={done ? 'Back to today’s flow' : item.kind === 'task' ? 'Done for today (the task itself stays as it is on your board)' : 'Done for today'}
        className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors', done ? 'border-[var(--sc)] bg-[var(--sc)] text-[oklch(20%_0.03_var(--sh))]' : 'border-[var(--sc-edge)] hover:border-[var(--sc)] hover:bg-[var(--sc-soft)]')} data-item-done>
        {done && <Check className="size-3" strokeWidth={3} />}
      </button>
      {/* On a phone the title has the row; the controls go under it. */}
      <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-auto">
        <p className={cn('truncate text-[15px] leading-snug', done ? 'text-foreground/45 line-through decoration-foreground/30' : 'text-foreground')}>
          {item.title}
          {item.ref?.gone && <span className="ml-2 text-xs text-amber-200">{item.kind === 'task' ? 'task deleted' : 'topic archived'}</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
          {item.subjectName && <span className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full bg-[var(--sc-soft)] px-2 py-px font-medium text-[var(--sc-ink)]">{item.subjectName}</span>}
          <span>{KIND_WORD[item.kind]}</span>
          {context && <span className="truncate">{context}</span>}
          {due && <span className={due.urgent ? 'font-medium text-[color:var(--sem-warning-ink,#f5c26b)]' : ''}>{due.text}</span>}
          {item.ref?.status === 'done' && <span>task done on your board</span>}
          {item.spentMinutes !== null && item.spentMinutes > 0 && <span>{minutesLabel(item.spentMinutes)} focused today</span>}
          {running && <span className="font-medium text-nova-ink">Focusing now</span>}
          {item.addedBy === 'nova' && <span title="Nova put this in the flow">· by Nova</span>}
        </p>
      </div>
      <span aria-hidden className="w-7 sm:hidden" />
      <Minutes item={item} disabled={busy} onSet={m => onOps([{ op: 'set_minutes', id: item.id, minutes: m }])} />
      {!done && !running && <StartControl item={item} disabled={busy || active} busy={startBusy} onStart={onStart} />}
      <div className="relative">
        <button type="button" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={`More for ${item.title}`}
          className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" data-item-menu>
          <MoreHorizontal className="size-4" />
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-white/10 bg-card p-1 text-sm shadow-float" onKeyDown={e => { if (e.key === 'Escape') setMenu(false) }}>
            {([
              index > 0 && { icon: ChevronUp, label: 'Move up', run: () => onOps([{ op: 'move', id: item.id, to: index - 1 }]) },
              index > 0 && { icon: ChevronUp, label: 'Move to first', run: () => onOps([{ op: 'move', id: item.id, to: 0 }]) },
              index < count - 1 && { icon: ChevronDown, label: 'Move down', run: () => onOps([{ op: 'move', id: item.id, to: index + 1 }]) },
              (item.minutes ?? 0) >= 20 && { icon: Scissors, label: 'Split into two blocks', run: () => { const a = Math.ceil((item.minutes ?? 0) / 2 / 5) * 5; onOps([{ op: 'split', id: item.id, parts: [a, item.minutes! - a] }]) } },
              item.status !== 'later' && { icon: Clock, label: 'Move to If there’s time', run: () => onOps([{ op: 'set_status', id: item.id, status: 'later' }]) },
              item.status === 'later' && { icon: ChevronUp, label: 'Back into the day', run: () => onOps([{ op: 'set_status', id: item.id, status: 'planned' }]) },
              { icon: NotebookPen, label: 'Notes on this', href: noteHref(item) },
              { icon: MapIcon, label: 'See on the map', href: mapHref(item) },
              { icon: X, label: item.kind === 'task' ? 'Take out of today (keeps the task)' : 'Take out of today', run: () => onOps([{ op: 'remove', id: item.id }]) },
            ] as Array<MenuAction | false>).filter((x): x is MenuAction => x !== false).map(x => x.href ? (
              <Link key={x.label} role="menuitem" href={x.href} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-foreground/85 hover:bg-white/6"><x.icon className="size-3.5 text-subtle" />{x.label}</Link>
            ) : (
              <button key={x.label} type="button" role="menuitem" onClick={() => { setMenu(false); x.run!() }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-foreground/85 hover:bg-white/6" data-menu-action={x.label}><x.icon className="size-3.5 text-subtle" />{x.label}</button>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

export function FlowList({ flow, busy, touched, onOps, onStart, starting, sessionRunning, subject = null }: {
  flow: NovaDayView; busy: boolean; touched: string[]
  // A subject chosen above: rows in other subjects are drawn quieter.
  subject?: string | null
  onOps: (ops: FlowOp[]) => void
  onStart: (item: FlowItemView, minutes: number) => void
  starting: string | null
  sessionRunning: boolean
}) {
  const [drag, setDrag] = useState<string | null>(null)
  const open = flow.items.filter(i => i.status === 'planned' || i.status === 'active')
  const later = flow.items.filter(i => i.status === 'later')
  const done = flow.items.filter(i => i.status === 'done')
  const all = [...open, ...later]
  const row = (item: FlowItemView) => {
    const index = flow.items.indexOf(item)
    return (
      <Row key={item.id} item={item} index={index} count={flow.items.length} active={sessionRunning} busy={busy} touched={touched.includes(item.id)}
        dim={subject !== null && (item.subjectName ?? '').toLowerCase() !== subject.toLowerCase()}
        onOps={onOps} onStart={m => onStart(item, m)} startBusy={starting === item.id}
        dragging={{ id: drag, set: setDrag }} onDrag={to => { if (drag) onOps([{ op: 'move', id: drag, to }]); setDrag(null) }} />
    )
  }
  return (
    <div data-flow-list>
      {open.length > 0 && <ol aria-label="Today's flow, in your order" className="space-y-0.5">{open.map(row)}</ol>}
      {open.length === 0 && all.length > 0 && <p className="py-3 text-sm text-subtle">Nothing left in the day’s main flow. Bring something back from below, or add more.</p>}
      {later.length > 0 && (
        <section className="mt-5" aria-label="If there's time" data-flow-later>
          <p className="px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">If there’s time · kept, not dropped</p>
          <ol className="mt-1 space-y-0.5">{later.map(row)}</ol>
        </section>
      )}
      {done.length > 0 && (
        <details className="mt-5" data-flow-done>
          <summary className="cursor-pointer px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">Done today · {done.length}</summary>
          <ol className="mt-1 space-y-0.5">{done.map(row)}</ol>
        </details>
      )}
    </div>
  )
}

// The same flow as time blocks from now. A fixed time is the learner's; the
// rest follow in order. An item with no time is shown at a standard length,
// marked as an estimate. Over the day's time is said, never cut.
export function FlowSchedule({ flow, busy, onOps, touched }: { flow: NovaDayView; busy: boolean; onOps: (ops: FlowOp[]) => void; touched: string[] }) {
  const from = Math.ceil(flow.nowMinutes / 5) * 5
  const blocks = scheduleOf(flow.items, from)
  const byId = new Map(flow.items.map(i => [i.id, i]))
  const end = blocks.at(-1)?.end ?? from
  return (
    <div data-flow-schedule>
      {blocks.length === 0 ? <p className="py-3 text-sm text-subtle">Nothing in the day’s flow to schedule.</p> : (
        <ol className="relative border-l border-white/10 pl-4">
          {blocks.map(b => {
            const item = byId.get(b.id)!
            return (
              <li key={b.id} style={toneStyle(item.subjectName)} className={cn('subject-tone relative py-2.5', touched.includes(b.id) && 'nova-changed rounded-lg')} data-schedule-block={b.id}>
                <span aria-hidden className={cn('absolute -left-[21px] top-4 size-2.5 rounded-full border-2 border-[var(--sc)]', item.status === 'active' ? 'bg-[var(--sc)]' : 'bg-background')} />
                <div className="flex items-baseline gap-3">
                  <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-subtle">{clockLabel(b.start)}–{clockLabel(b.end)}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{item.title}{item.subjectName && <span className="ml-2 text-xs text-[var(--sc-ink)]">{item.subjectName}</span>}</span>
                  <label className="inline-flex items-center gap-1 text-[11px] text-subtle">
                    <span className="sr-only">Fixed time for {item.title}</span>
                    <input type="time" value={item.at ?? ''} disabled={busy} onChange={e => onOps([{ op: 'set_time', id: item.id, at: e.target.value || null }])}
                      className="h-7 rounded-md border border-white/10 bg-transparent px-1 text-xs text-foreground/80 focus:border-nova/60 focus:outline-none" />
                  </label>
                </div>
                <p className="pl-[6.75rem] text-xs text-subtle">{b.estimated ? 'about 25 min (no time set)' : minutesLabel(b.end - b.start)}{b.fixed ? ' · fixed time' : ''}</p>
              </li>
            )
          })}
        </ol>
      )}
      {blocks.length > 0 && <p className="mt-3 text-xs text-subtle">Ends about {clockLabel(end % (24 * 60))}{end >= 24 * 60 ? ' tomorrow' : ''}. {flow.items.some(i => i.at) && <button type="button" disabled={busy} onClick={() => onOps([{ op: 'clear_times' }])} className="underline">Clear fixed times</button>}</p>}
    </div>
  )
}

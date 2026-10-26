'use client'

// The next thing in the learner's own flow, opened out: what it is, where it
// belongs, why it is next, and the one button that starts it (with this
// session's length chosen there: suggested, custom or no time limit). Built
// like Today's earlier NowBlock: a raised card with its subject's colour
// down its edge and a soft wash of it behind the title. It shows only what
// the flow holds; it ranks nothing.

import Link from 'next/link'
import { ArrowRight, CalendarClock, Clock, Map as MapIcon, NotebookPen, Sparkles } from 'lucide-react'
import type { FlowItemView } from '@repo/api/nova/product/day-flow.types'
import { cn } from '@/lib/utils'
import { SURFACE_RAISED } from '../workspace/ui'
import { subjectColor, toneStyle } from '../subject-color'
import { StartControl, suggestedFor } from './start-control'
import { mapHref, noteHref } from './flow-list'

const KIND_WORD = { task: 'Task', topic: 'Topic', focus: 'Focus' } as const
const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

// Why it is the one shown: its place in their order, and a date when the
// task carries one. Never a reason Nova made up.
function whyNext(item: FlowItemView, place: number): string {
  const due = item.ref?.dueInDays
  const dated = due === null || due === undefined ? null : due < 0 ? `${-due} day${due === -1 ? '' : 's'} overdue` : due === 0 ? 'due today' : due === 1 ? 'due tomorrow' : null
  const order = place === 0 ? 'First in your flow' : `Next in your flow`
  return dated ? `${order} · ${dated}` : order
}

export function NextFocus({ item, place, then, onStart, starting, disabled, onAskNova, onLater }: {
  item:      FlowItemView
  // Its index among the open items.
  place:     number
  // What comes after it, for the footer.
  then:      FlowItemView | null
  onStart:   (minutes: number) => void
  starting:  boolean
  disabled:  boolean
  onAskNova: () => void
  onLater:   () => void
}) {
  const s = suggestedFor(item)
  const color = subjectColor(item.subjectName)
  const due = item.ref?.dueInDays
  const context = [item.subjectName, item.kind === 'task' && item.topicName ? item.topicName : null].filter(Boolean)
  return (
    <article className={cn(SURFACE_RAISED, 'subject-tone relative isolate overflow-hidden')} style={toneStyle(item.subjectName)} data-next-focus={item.id} aria-labelledby="next-focus-title">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-[var(--sc)]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 -z-10 size-80 rounded-full bg-[var(--sc-soft)] blur-3xl" />
      <div className="relative p-5 pl-6 sm:p-7 sm:pl-8">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--sc)] opacity-50 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-[var(--sc)]" />
          </span>
          <span className="text-[var(--sc-ink)]">Next up</span>
          <span aria-hidden className="text-foreground/25">·</span>
          <span className="text-foreground/55">{KIND_WORD[item.kind]}</span>
        </p>
        <h2 id="next-focus-title" className="mt-3 text-[1.65rem] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[2rem]">{item.title}</h2>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-foreground/65">
          {context.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sc-soft)] py-0.5 pl-1.5 pr-2.5 font-medium text-[var(--sc-ink)]">
              <span aria-hidden className={cn('size-1.5 rounded-full', color.dot)} />{context.join(' › ')}
            </span>
          )}
          <span className="inline-flex items-center gap-1"><Clock aria-hidden className="size-3" />{item.minutes ? `${minutesLabel(item.minutes)} today` : s.basis === 'estimate' ? `about ${minutesLabel(s.minutes)}` : 'no time set'}</span>
          {due !== null && due !== undefined && due <= 1 && (
            <span className={cn('inline-flex items-center gap-1 font-medium', due <= 0 ? 'text-[color:var(--sem-warning-ink,#f5c26b)]' : 'text-foreground/70')}>
              <CalendarClock aria-hidden className="size-3" />{due < 0 ? `${-due}d overdue` : due === 0 ? 'Due today' : 'Due tomorrow'}
            </span>
          )}
          {item.addedBy === 'nova' && <span className="text-foreground/50">· added with Nova</span>}
        </p>
        <p className="mt-3 text-sm text-foreground/70">{whyNext(item, place)}</p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <StartControl item={item} size="lg" disabled={disabled} busy={starting} onStart={onStart} />
          <button type="button" onClick={onAskNova} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--sc-edge)] px-4 text-sm font-medium text-foreground/90 transition-colors hover:bg-[var(--sc-faint)]" data-next-ask>
            <Sparkles aria-hidden className="size-4 text-[var(--sc-ink)]" /> Talk it through
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-xs text-foreground/60">
          <Link href={noteHref(item)} className="inline-flex items-center gap-1.5 hover:text-foreground"><NotebookPen aria-hidden className="size-3.5" /> Notes</Link>
          <Link href={mapHref(item)} className="inline-flex items-center gap-1.5 hover:text-foreground"><MapIcon aria-hidden className="size-3.5" /> On the map</Link>
          <button type="button" disabled={disabled} onClick={onLater} className="inline-flex items-center gap-1.5 hover:text-foreground disabled:opacity-50" data-next-later>Not now: if there’s time</button>
          {then && (
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-foreground/55" data-next-then>
              Then <ArrowRight aria-hidden className="size-3" />
              <span className="subject-tone inline-flex min-w-0 items-center gap-1.5" style={toneStyle(then.subjectName)}>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--sc)]" /><span className="truncate text-foreground/80">{then.title}</span>
              </span>
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

'use client'

import Link from 'next/link'
import { ArrowRight, CalendarClock, ChevronRight, History, Sparkles, TrendingUp } from 'lucide-react'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import { EXAMS_HREF } from '@repo/api/nova/product/exams.types'
import type { NovaProgressView } from '@repo/api/nova/product/progress.types'
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'
import { cn } from '@/lib/utils'
import { daysAgo, inDays, minutesLabel } from './format'
import { BUTTON_QUIET, SectionHeading, Skeleton, TEXT_LINK } from './workspace/ui'

// The side column's sections: a heading and what is on record, divided by a
// hairline. Not boxes: the column reads as one margin beside the day.
function Rail({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-white/8 pt-5 first:border-t-0 first:pt-0">{children}</div>
}

// The dates Nova has on record (exams, interviews, things due) and tasks with
// a due day, in one list by date. Each is named for the kind of date it is.
// Both are dates the learner gave; nothing is estimated.
export function Deadlines({ exams, tasks }: { exams: NovaTodayReady['upcoming']; tasks: NovaTaskItem[] }) {
  const items = [
    ...exams.map(e => ({ key: `exam:${e.title}:${e.scheduledAt}`, title: e.title, sub: e.subjectName ?? e.kindLabel, days: e.daysUntil, kind: e.kindLabel })),
    ...tasks.filter(t => t.status !== 'done' && t.dueInDays !== null).map(t => ({ key: `task:${t.id}`, title: t.title, sub: t.subjectName ?? 'Task', days: t.dueInDays!, kind: 'Task' })),
  ].sort((a, b) => a.days - b.days).slice(0, 6)

  return (
    <Rail>
      <SectionHeading icon={CalendarClock} aside={exams.length > 0 ? <Link href={EXAMS_HREF} className={TEXT_LINK}>Change a date</Link> : undefined}>
        Deadlines
      </SectionHeading>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-foreground/60">No date on record. Add one in setup, or a due date on a task, and it shows here.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map(item => (
            <li key={item.key} className="flex items-start gap-3">
              {/* How near it is, before what it is */}
              <span className={cn('mt-0.5 w-14 shrink-0 text-xs font-medium tabular-nums',
                item.days < 0 ? 'text-rose-300' : item.days <= 7 ? 'text-amber-300' : 'text-foreground/60')}>
                {item.days < 0 ? `${-item.days}d late` : item.days === 0 ? 'Today' : item.days === 1 ? 'Tomorrow' : `${item.days} days`}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground/90">{item.title}</p>
                <p className="truncate text-xs text-foreground/55">{item.kind}{item.sub && item.sub !== item.kind ? ` · ${item.sub}` : ''}</p>
                <p className="sr-only">{item.days < 0 ? `${-item.days} days overdue` : inDays(item.days)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Rail>
  )
}

// Where you left off: the last session Nova timed, and a way back into it.
// The latest notes are under Recently captured, so they are not listed here
// a second time. Nothing here is a suggestion.
export function ContinueLearning({ view, onResume, busy }: {
  view: NovaTodayReady
  onResume: (topicName: string) => void
  busy: boolean
}) {
  const last = view.progress.lastSession
  const days = view.progress.daysSinceLastSession
  if (!last?.topicName || days === null) return null
  return (
    <Rail>
      <SectionHeading icon={History}>Pick up where you left off</SectionHeading>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground/90">{last.topicName}</p>
          <p className="truncate text-xs text-foreground/55">Last session: {minutesLabel(last.minutes)}, {daysAgo(days)}</p>
        </div>
        {!view.activeSession && (
          <button type="button" disabled={busy} onClick={() => onResume(last.topicName!)} className={cn(BUTTON_QUIET, 'h-8')}>
            Study again
          </button>
        )}
      </div>
    </Rail>
  )
}

type Loaded<T> = { view: T | null; loading: boolean; error: boolean; refresh: () => void }

// "12 Sep" for a YYYY-MM-DD day key the server drew in the learner's zone.
const weekOf = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

// The eight finished weeks before this one, from Progress: days with a
// counted session, out of seven. This week is Today's numbers above, so it is
// not drawn twice. A week before the first session is a dash, never a zero.
function FinishedWeeks({ progress }: { progress: Loaded<NovaProgressView> }) {
  const ready = progress.view?.status === 'ready' ? progress.view : null
  if (!ready && progress.loading) {
    return <div aria-busy="true" aria-label="Loading your last eight weeks" className="mt-4"><Skeleton className="h-14" /></div>
  }
  if (!ready && progress.error) {
    return (
      <p role="status" className="mt-4 text-xs text-foreground/60">
        Your last eight weeks didn&apos;t load.{' '}
        <button type="button" onClick={() => progress.refresh()} className="underline decoration-white/25 underline-offset-4 hover:text-foreground">Try again</button>
      </p>
    )
  }
  // No counted session yet: Progress has nothing to draw.
  if (!ready || !ready.hasEvidence) return null
  const weeks = ready.consistency.weeks.filter(w => !w.current)
  if (weeks.length === 0) return null

  return (
    <div className="mt-4" data-section="finished-weeks">
      <p className="text-xs text-foreground/60">Days studied, the {weeks.length} weeks before this one</p>
      <ol aria-label="Days studied in each finished week" className="mt-2 grid items-end gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map(week => (
          <li key={week.weekStart} data-week={week.weekStart} data-before-start={week.beforeStart} className="min-w-0 text-center">
            <div aria-hidden className="mx-auto flex h-10 w-full max-w-6 items-end overflow-hidden rounded-sm bg-white/5">
              {!week.beforeStart && <div className="w-full bg-keppel-400" style={{ height: `${(week.activeDays / 7) * 100}%` }} />}
            </div>
            <p aria-hidden className={cn('mt-1 text-[10px] tabular-nums', week.beforeStart ? 'text-foreground/30' : 'text-foreground/60')}>
              {week.beforeStart ? '–' : week.activeDays}
            </p>
            <p className="sr-only">
              {week.beforeStart
                ? `Week of ${weekOf(week.weekStart)}: before your first session`
                : `Week of ${weekOf(week.weekStart)}: ${week.activeDays} of 7 days, ${week.sessions} sessions, ${minutesLabel(week.minutes)}`}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] leading-relaxed text-foreground/50">
        Days with a finished session of 10 minutes or more. A dash is a week before your first session.
      </p>
    </div>
  )
}

// Only what was recorded. A learner with no sessions sees no numbers.
export function WeekSoFar({ view, weeks }: { view: NovaTodayReady; weeks: Loaded<NovaProgressView> }) {
  const { progress, reviewDue, weakArea } = view
  const stats: Array<{ label: string; value: string }> = []
  if (progress.sessionsThisWeek > 0) {
    stats.push({ label: progress.sessionsThisWeek === 1 ? 'session' : 'sessions', value: String(progress.sessionsThisWeek) })
    stats.push({ label: 'studied', value: minutesLabel(progress.minutesThisWeek) })
  }
  if (progress.streakDays > 1) stats.push({ label: 'days in a row', value: String(progress.streakDays) })
  if (reviewDue.count > 0) stats.push({ label: reviewDue.count === 1 ? 'review due' : 'reviews due', value: String(reviewDue.count) })

  return (
    <Rail>
      <SectionHeading icon={TrendingUp} aside={<Link href="/progress" className={TEXT_LINK}>Progress <ArrowRight aria-hidden className="size-3" /></Link>}>
        This week
      </SectionHeading>
      {stats.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-foreground/60">No session yet this week. The first one you finish shows up here.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map(s => (
            <div key={s.label} className="flex flex-col-reverse">
              <dt className="text-xs text-foreground/60">{s.label}</dt>
              <dd className="text-lg font-semibold tabular-nums tracking-tight text-foreground">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {weakArea && (
        <p className="mt-3 text-xs leading-relaxed text-foreground/60">
          Weakest by your own account: <span className="text-foreground/85">{weakArea.topicName}</span> ({weakArea.masteryPercent}%).
        </p>
      )}
      <FinishedWeeks progress={weeks} />
    </Rail>
  )
}

const MODE_LABEL: Record<NovaTodayReady['plan']['mode'], string> = {
  standard:    'Standard day',
  exam_crisis: 'Exam prep',
  recovery:    'Recovery',
}

// The day's brief: the facts Today reported, label over value, like a
// ledger. A property with nothing on record is left out, never shown as zero.
export function PageProperties({ view, tasksDueToday = null }: { view: NovaTodayReady; tasksDueToday?: number | null }) {
  const { plan, progress, reviewDue, nextDeadline } = view
  const rows: Array<{ label: string; value: string; tone?: 'warn' }> = []
  if (plan.blockCount > 0) {
    rows.push({ label: 'Planned', value: `${minutesLabel(plan.totalMinutesToday)} · ${plan.blockCount} ${plan.blockCount === 1 ? 'block' : 'blocks'}` })
  }
  rows.push({ label: 'Day', value: MODE_LABEL[plan.mode] })
  if (nextDeadline) {
    rows.push({ label: nextDeadline.kindLabel, value: `${nextDeadline.title}, ${inDays(nextDeadline.daysUntil)}`, tone: nextDeadline.daysUntil <= 7 ? 'warn' : undefined })
  }
  if (tasksDueToday) rows.push({ label: 'Due today', value: `${tasksDueToday} ${tasksDueToday === 1 ? 'task' : 'tasks'}` })
  if (reviewDue.count > 0) rows.push({ label: 'Reviews due', value: String(reviewDue.count) })
  if (progress.streakDays > 1) rows.push({ label: 'In a row', value: `${progress.streakDays} days` })

  return (
    <dl aria-label="Today at a glance" data-section="page-properties" className="flex flex-wrap gap-x-8 gap-y-3">
      {rows.map(row => (
        <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-subtle">{row.label}</dt>
          <dd className={cn('truncate text-[15px] font-medium tabular-nums', row.tone === 'warn' ? 'text-amber-300' : 'text-foreground')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// A way into the Creature world, with the two numbers it grows from.
export function CompanionCard({ creature, name }: { creature: NovaCreatureView | null; name: string | null }) {
  const ready = creature?.status === 'ready' ? creature : null
  return (
    <Link href="/creature" className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-keppel-400/15 text-keppel-300">
        <Sparkles aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground/90">{name ?? 'Your world'}{ready ? ` · level ${ready.level}` : ''}</span>
        <span className="block truncate text-xs text-foreground/55">
          {!ready ? 'It grows as you study.'
            : ready.activeDays === 0 ? 'Quiet for now. Your first full session wakes it up.'
            : `${ready.activeDays} ${ready.activeDays === 1 ? 'day' : 'days'} of study behind it.`}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-foreground/35 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

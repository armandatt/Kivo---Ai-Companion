'use client'

import Link from 'next/link'
import { ArrowRight, Bookmark, CalendarDays, NotebookPen, Sparkles, Timer, Waypoints } from 'lucide-react'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import { EXAMS_HREF } from '@repo/api/nova/product/exams.types'
import type { NovaProgressView } from '@repo/api/nova/product/progress.types'
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'
import { cn } from '@/lib/utils'
import { daysAgo, inDays, minutesLabel } from './format'

const HEADING = 'text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/45'

// The side column's one container: a quiet card with a small heading.
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-card/40 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={HEADING}>{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
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
    <Panel title="Deadlines">
      {items.length === 0 ? (
        <p className="text-sm leading-relaxed text-foreground/50">No date on record. Add one in setup, or a due date on a task, and it shows here.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(item => (
            <li key={item.key} className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground/90">{item.title}</p>
                <p className="truncate text-xs text-foreground/45">{item.kind}{item.sub && item.sub !== item.kind ? ` · ${item.sub}` : ''}</p>
              </div>
              <p className={`shrink-0 text-sm ${item.days < 0 ? 'font-medium text-rose-300' : item.days <= 7 ? 'font-medium text-amber-300' : 'text-foreground/60'}`}>
                {item.days < 0 ? `${-item.days}d overdue` : inDays(item.days)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {exams.length > 0 && (
        <Link href={EXAMS_HREF} className="mt-4 inline-block text-xs text-foreground/50 underline decoration-white/20 underline-offset-4 hover:text-foreground">
          Change or remove a date
        </Link>
      )}
    </Panel>
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
    <Panel title="Pick up where you left off">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground/90">{last.topicName}</p>
          <p className="truncate text-xs text-foreground/45">Last session: {minutesLabel(last.minutes)}, {daysAgo(days)}</p>
        </div>
        {!view.activeSession && (
          <button type="button" disabled={busy} onClick={() => onResume(last.topicName!)}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground/75 transition-colors hover:border-keppel-400/50 hover:text-keppel-200 disabled:opacity-50">
            Study again
          </button>
        )}
      </div>
    </Panel>
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
    return <div aria-busy="true" aria-label="Loading your last eight weeks" className="mt-4 h-16 animate-pulse rounded-lg bg-white/3" />
  }
  if (!ready && progress.error) {
    return (
      <p role="status" className="mt-4 text-xs text-foreground/50">
        Your last eight weeks didn&apos;t load.{' '}
        <button type="button" onClick={() => progress.refresh()} className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Try again</button>
      </p>
    )
  }
  // No counted session yet: Progress has nothing to draw.
  if (!ready || !ready.hasEvidence) return null
  const weeks = ready.consistency.weeks.filter(w => !w.current)
  if (weeks.length === 0) return null

  return (
    <div className="mt-4 border-t border-white/6 pt-3" data-section="finished-weeks">
      <p className="text-xs text-foreground/50">Days studied, the {weeks.length} weeks before this one</p>
      <ol aria-label="Days studied in each finished week" className="mt-2 grid items-end gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map(week => (
          <li key={week.weekStart} data-week={week.weekStart} data-before-start={week.beforeStart} className="min-w-0 text-center">
            <div aria-hidden className="mx-auto flex h-10 w-full max-w-6 items-end overflow-hidden rounded bg-white/4">
              {!week.beforeStart && <div className="w-full rounded bg-keppel-400" style={{ height: `${(week.activeDays / 7) * 100}%` }} />}
            </div>
            <p aria-hidden className={cn('mt-1 text-[10px] tabular-nums', week.beforeStart ? 'text-foreground/25' : 'text-foreground/55')}>
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
      <p className="mt-2 text-[11px] leading-relaxed text-foreground/40">
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
    stats.push({ label: progress.sessionsThisWeek === 1 ? 'session this week' : 'sessions this week', value: String(progress.sessionsThisWeek) })
    stats.push({ label: 'studied this week', value: minutesLabel(progress.minutesThisWeek) })
  }
  if (progress.streakDays > 1) stats.push({ label: 'days in a row', value: String(progress.streakDays) })
  if (reviewDue.count > 0) stats.push({ label: reviewDue.count === 1 ? 'topic due for review' : 'topics due for review', value: String(reviewDue.count) })

  return (
    <Panel title="This week" action={<Link href="/progress" className="inline-flex items-center gap-1 text-xs font-medium text-foreground/55 transition-colors hover:text-foreground">Progress <ArrowRight className="size-3" /></Link>}>
      {stats.length === 0 ? (
        <p className="text-sm leading-relaxed text-foreground/50">No session yet this week. The first one you finish shows up here.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          {stats.map(s => (
            <div key={s.label}>
              <dd className="text-2xl font-semibold tracking-tight text-foreground">{s.value}</dd>
              <dt className="mt-0.5 text-xs text-foreground/50">{s.label}</dt>
            </div>
          ))}
        </dl>
      )}
      {weakArea && (
        <p className="mt-4 border-t border-white/6 pt-3 text-xs leading-relaxed text-foreground/55">
          Weakest by your own account: <span className="text-foreground/85">{weakArea.topicName}</span> ({weakArea.masteryPercent}%).
        </p>
      )}
      <FinishedWeeks progress={weeks} />
    </Panel>
  )
}

const ACTIONS = [
  { href: '/focus', label: 'Focus', icon: Timer },
  { href: '/notes/new', label: 'New note', icon: NotebookPen },
  { href: '/planner?view=board', label: 'Task board', icon: CalendarDays },
  { href: '/map', label: 'Knowledge Map', icon: Waypoints },
  { href: '/saved', label: 'Saved pages', icon: Bookmark },
] as const

// The page's own command bar: the places a learner goes from Today.
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap items-center gap-1 rounded-xl border border-white/8 bg-card/40 p-1">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground">
          <Icon aria-hidden className="size-3.5" />{label}
        </Link>
      ))}
    </nav>
  )
}

const MODE_LABEL: Record<NovaTodayReady['plan']['mode'], string> = {
  standard:    'Standard day',
  exam_crisis: 'Exam prep',
  recovery:    'Recovery',
}

// What set the length of today's plan, in a few words. The Planner explains it
// in full; these only name the rule the server reported.
const BASIS_LABEL: Record<NovaTodayReady['plan']['budgetBasis'], string> = {
  preferred:   'your usual time',
  stated_time: 'the time you gave',
  recovery:    'cut back after missed days',
  reentry:     'first day back',
  no_pressure: 'kept light',
}

// The day's properties, as Today reported them. A property with nothing on
// record is left out, never shown as zero.
export function PageProperties({ view }: { view: NovaTodayReady }) {
  const { plan, progress, reviewDue, nextDeadline } = view
  const rows: Array<{ label: string; value: string; tone?: 'warn' }> = [
    { label: 'Plan', value: MODE_LABEL[plan.mode] },
  ]
  if (plan.blockCount > 0) {
    rows.push({ label: 'Time', value: `${minutesLabel(plan.totalMinutesToday)} planned of ${minutesLabel(plan.budgetMinutes)}, ${BASIS_LABEL[plan.budgetBasis]}` })
  }
  if (nextDeadline) {
    rows.push({ label: nextDeadline.kindLabel, value: `${nextDeadline.title}, ${inDays(nextDeadline.daysUntil)}`, tone: nextDeadline.daysUntil <= 7 ? 'warn' : undefined })
  }
  if (reviewDue.count > 0) rows.push({ label: 'Reviews due', value: String(reviewDue.count) })
  if (progress.streakDays > 1) rows.push({ label: 'In a row', value: `${progress.streakDays} days` })

  return (
    <dl aria-label="Today at a glance" data-section="page-properties" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {rows.map(row => (
        <div key={row.label} className="flex min-w-0 items-baseline gap-2">
          <dt className="shrink-0 text-xs text-foreground/45">{row.label}</dt>
          <dd className={row.tone === 'warn' ? 'truncate font-medium text-amber-300' : 'truncate text-foreground/85'}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// A way into the Creature world, with the two numbers it grows from.
export function CompanionCard({ creature, name }: { creature: NovaCreatureView | null; name: string | null }) {
  const ready = creature?.status === 'ready' ? creature : null
  return (
    <Link href="/creature" className="group block overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-keppel-400/12 via-transparent to-transparent p-4 transition-colors hover:border-keppel-400/30">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={HEADING}>Your world</p>
          <p className="mt-2 truncate text-sm font-medium text-foreground/90">{name ?? 'Kivo'}{ready ? ` · level ${ready.level}` : ''}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground/50">
            {!ready ? 'It grows as you study.'
              : ready.activeDays === 0 ? 'Quiet for now. Your first full session wakes it up.'
              : `${ready.activeDays} ${ready.activeDays === 1 ? 'day' : 'days'} of study behind it.`}
          </p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-keppel-400/15 text-keppel-300 transition-transform group-hover:scale-105">
          <Sparkles className="size-4" />
        </span>
      </div>
    </Link>
  )
}

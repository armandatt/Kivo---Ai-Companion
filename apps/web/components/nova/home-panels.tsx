'use client'

import Link from 'next/link'
import { ArrowRight, Bookmark, CalendarDays, NotebookPen, Sparkles, Timer, Waypoints } from 'lucide-react'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'
import { daysAgo, inDays, minutesLabel, relativeDay } from './format'

const HEADING = 'text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/45'

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={HEADING}>{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

// Exams Nova has on record and tasks with a due day, in one list by date.
// Both are dates the learner gave; nothing is estimated.
export function Deadlines({ exams, tasks }: { exams: NovaTodayReady['upcoming']; tasks: NovaTaskItem[] }) {
  const items = [
    ...exams.map(e => ({ key: `exam:${e.title}:${e.scheduledAt}`, title: e.title, sub: e.subjectName ?? 'Exam', days: e.daysUntil, kind: 'Exam' })),
    ...tasks.filter(t => t.status !== 'done' && t.dueInDays !== null).map(t => ({ key: `task:${t.id}`, title: t.title, sub: t.subjectName ?? 'Task', days: t.dueInDays!, kind: 'Task' })),
  ].sort((a, b) => a.days - b.days).slice(0, 6)

  return (
    <Panel title="Deadlines">
      {items.length === 0 ? (
        <p className="text-sm leading-relaxed text-foreground/50">No exam or due date on record. Add an exam in setup or a due date on a task and it shows here.</p>
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
    </Panel>
  )
}

// Where you left off: the last session Nova timed, and the note you touched
// last. Both are things that exist; neither is a suggestion.
export function ContinueLearning({ view, notes, onResume, busy }: {
  view: NovaTodayReady
  notes: NoteSummary[]
  onResume: (topicName: string) => void
  busy: boolean
}) {
  const last = view.progress.lastSession
  const days = view.progress.daysSinceLastSession
  if (!last?.topicName && notes.length === 0) return null
  return (
    <Panel title="Pick up where you left off">
      <ul className="space-y-2">
        {last?.topicName && days !== null && (
          <li className="flex items-center justify-between gap-3 rounded-xl border border-white/8 px-3.5 py-3">
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
          </li>
        )}
        {notes.slice(0, 2).map(note => (
          <li key={note.id}>
            <Link href={`/notes/${note.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 px-3.5 py-3 transition-colors hover:border-white/16">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground/90">{note.title}</p>
                <p className="truncate text-xs text-foreground/45">Note{note.subjectName ? ` · ${note.subjectName}` : ''} · edited {relativeDay(note.updatedAt)}</p>
              </div>
              <ArrowRight className="size-3.5 shrink-0 text-foreground/40" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// Only what was recorded. A learner with no sessions sees no numbers.
export function WeekSoFar({ view }: { view: NovaTodayReady }) {
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

export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-3.5 text-xs font-medium text-foreground/75 transition-colors hover:border-white/20 hover:bg-white/4 hover:text-foreground">
          <Icon className="size-3.5" />{label}
        </Link>
      ))}
    </nav>
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

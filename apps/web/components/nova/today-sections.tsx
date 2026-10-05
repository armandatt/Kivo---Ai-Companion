'use client'

import type { NovaTodayReady, TodayAction } from '@repo/api/nova/product/today.types'
import { ACTIVITY_LABEL, daysAgo, inDays, minutesLabel } from './format'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/8 pt-5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/40">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

// What can I do next: the rest of today's plan, in the planner's order.
export function UpNext({ actions, onStart, disabled }: {
  actions:  TodayAction[]
  onStart?: (action: TodayAction) => void
  disabled?: boolean
}) {
  if (actions.length === 0) return null
  return (
    <Section title="After that">
      <ul className="divide-y divide-white/6">
        {actions.map(action => (
          <li key={`${action.subjectName}:${action.topicName}`} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground/90">{action.topicName}</p>
              <p className="truncate text-xs text-foreground/45">
                {action.subjectName} · {minutesLabel(action.durationMinutes)} · {ACTIVITY_LABEL[action.activityType]}
              </p>
            </div>
            {onStart && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onStart(action)}
                className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:border-keppel-400/50 hover:text-keppel-200 disabled:opacity-50"
              >
                Start instead
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function Upcoming({ items }: { items: NovaTodayReady['upcoming'] }) {
  if (items.length === 0) return null
  return (
    <Section title="Upcoming">
      <ul className="space-y-3">
        {items.map(item => (
          <li key={`${item.title}:${item.scheduledAt}`} className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground/90">{item.title}</p>
              {item.subjectName && <p className="truncate text-xs text-foreground/45">{item.subjectName}</p>}
            </div>
            <p className={item.daysUntil <= 7 ? 'shrink-0 text-sm font-medium text-amber-300' : 'shrink-0 text-sm text-foreground/60'}>
              {inDays(item.daysUntil)}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function WorkingToward({ goals }: { goals: string[] }) {
  if (goals.length === 0) return null
  return (
    <Section title="Working toward">
      <ul className="space-y-2">
        {goals.map(goal => <li key={goal} className="text-sm leading-relaxed text-foreground/80">{goal}</li>)}
      </ul>
    </Section>
  )
}

// Only what was recorded. A student with no sessions sees no numbers.
export function Recently({ view }: { view: NovaTodayReady }) {
  const { progress, weakArea, reviewDue } = view
  const lines: string[] = []

  if (progress.lastSession && progress.daysSinceLastSession !== null) {
    const on = progress.lastSession.topicName ? ` on ${progress.lastSession.topicName}` : ''
    lines.push(`${minutesLabel(progress.lastSession.minutes)}${on}, ${daysAgo(progress.daysSinceLastSession)}.`)
  }
  if (progress.sessionsThisWeek > 0) {
    const n = progress.sessionsThisWeek
    lines.push(`${n} session${n === 1 ? '' : 's'} this week, ${minutesLabel(progress.minutesThisWeek)} in total.`)
  }
  if (progress.streakDays > 1) lines.push(`${progress.streakDays} days in a row.`)
  if (weakArea) lines.push(`Weakest right now: ${weakArea.topicName} (${weakArea.masteryPercent}%).`)
  if (reviewDue.count > 0) lines.push(`${reviewDue.count} topic${reviewDue.count === 1 ? '' : 's'} due for review.`)

  if (lines.length === 0) return null
  return (
    <Section title="Recently">
      <ul className="space-y-2">
        {lines.map(line => <li key={line} className="text-sm leading-relaxed text-foreground/75">{line}</li>)}
      </ul>
    </Section>
  )
}

export function AccountingFor({ constraints }: { constraints: NovaTodayReady['constraints'] }) {
  if (constraints.length === 0) return null
  return (
    <Section title="Nova is accounting for">
      <ul className="space-y-2">
        {constraints.map(c => (
          <li key={`${c.category}:${c.description}`} className="text-sm leading-relaxed text-foreground/75">{c.description}</li>
        ))}
      </ul>
    </Section>
  )
}

'use client'

import Link from 'next/link'
import type { NovaTodayReady, TodayAction } from '@repo/api/nova/product/today.types'
import { GOALS_HREF } from '@repo/api/nova/product/goals.types'
import { ACTIVITY_LABEL, URGENCY_LABEL, daysAgo, inDays, minutesLabel } from './format'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/8 pt-5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/40">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const URGENT: Partial<Record<TodayAction['urgency'], string>> = {
  critical: 'text-amber-300',
  high:     'text-keppel-300',
}

// Today's plan as the planner ordered it: the recommendation, then the
// blocks after it. Numbered in that order; nothing here reorders, adds or
// drops a block. Today carries the first few blocks of the day; when the day
// has more, the count says so and the Planner has the rest.
export function TodayPlan({ recommendation, alternatives, inFocusAbove, blockCount, onStart, disabled }: {
  recommendation: TodayAction | null
  alternatives:   TodayAction[]
  // The recommendation is the card above the plan (no session is running):
  // its row points there instead of repeating its Start button.
  inFocusAbove:   boolean
  blockCount:     number
  // Absent while a session runs: one session at a time.
  onStart?:       (action: TodayAction) => void
  disabled?:      boolean
}) {
  const blocks = recommendation ? [recommendation, ...alternatives] : alternatives
  // A plan of one block that is already the card above says nothing new.
  if (blocks.length === 0 || (blocks.length === 1 && inFocusAbove)) return null
  const more = blockCount > blocks.length

  return (
    <section aria-labelledby="today-plan" data-section="today-plan">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="today-plan" className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/45">Today&apos;s plan</h2>
        <p className="text-xs text-foreground/45">
          {more ? `${blocks.length} of ${blockCount} blocks · ` : ''}
          <Link href="/planner" className="font-medium text-foreground/55 transition-colors hover:text-foreground">{more ? 'the rest on the Planner' : 'Planner'}</Link>
        </p>
      </div>

      <ol className="mt-3 overflow-hidden rounded-2xl border border-white/8 bg-card/60">
        {blocks.map((action, i) => {
          const first = i === 0 && recommendation !== null
          return (
            <li key={`${action.subjectName}:${action.topicName}`} className="flex gap-4 border-t border-white/6 px-4 py-4 first:border-t-0">
              <span aria-hidden className={first && inFocusAbove
                ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-keppel-400/15 text-xs font-semibold text-keppel-300'
                : 'flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-xs font-medium text-foreground/60'}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground/90">
                      <span className="sr-only">Block {i + 1}: </span>{action.topicName}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground/50">
                      {action.subjectName} · {minutesLabel(action.durationMinutes)} · {ACTIVITY_LABEL[action.activityType]}
                      {URGENT[action.urgency] && <> · <span className={URGENT[action.urgency]}>{URGENCY_LABEL[action.urgency]}</span></>}
                    </p>
                  </div>
                  {first && inFocusAbove ? (
                    <span className="shrink-0 text-xs font-medium text-keppel-300/80">Now, above</span>
                  ) : onStart ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onStart(action)}
                      className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:border-keppel-400/50 hover:text-keppel-200 disabled:opacity-50"
                    >
                      {inFocusAbove ? 'Start instead' : 'Start'}
                    </button>
                  ) : null}
                </div>
                {action.reasons.length > 0 && (
                  <ul aria-label="Why this block" className="mt-2 flex flex-wrap gap-1.5">
                    {action.reasons.map((reason, r) => (
                      <li key={r} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-foreground/60">{reason}</li>
                    ))}
                  </ul>
                )}
                {action.rationale && !(first && inFocusAbove) && (
                  <p className="mt-2 text-xs leading-relaxed text-foreground/50">{action.rationale}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
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

// What the learner said they are working toward. With nothing said, the way
// to say it: no goal is ever shown that they did not give.
export function WorkingToward({ goals }: { goals: string[] }) {
  return (
    <Section title="Working toward">
      {goals.length > 0 ? (
        <ul className="space-y-2">
          {goals.map(goal => <li key={goal} className="text-sm leading-relaxed text-foreground/80">{goal}</li>)}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-foreground/50" data-unknown="no_goals">
          Nothing yet. <Link href={GOALS_HREF} className="font-medium text-keppel-300 hover:text-keppel-200">Add what you&apos;re working toward</Link>
        </p>
      )}
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

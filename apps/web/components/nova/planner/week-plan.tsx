'use client'

import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlannerDay } from '@repo/api/nova/product/planner.types'
import { dayOfMonth, minutesLabel, weekdayOf } from '../format'

function isEmpty(day: PlannerDay): boolean {
  return day.sessions.length === 0 && day.planned.length === 0 && day.reviewsDueCount === 0 && day.exams.length === 0
}

// The week as Nova holds it: records behind, today's plan, and ahead only
// what is already scheduled to fall due. Later days are planned when they
// arrive, from whatever Nova knows by then.
export function WeekPlan({ week }: { week: PlannerDay[] }) {
  return (
    <section aria-labelledby="planner-week">
      <h2 id="planner-week" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">This week</h2>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-foreground/45">
        An adaptive plan, not a timetable. Nova plans each day as it arrives, from what it knows by then. Later days show only what is already scheduled to fall due.
      </p>

      <ol className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40">
        {week.map(day => (
          <li key={day.date} data-day={day.date} data-relation={day.relation} className="flex gap-4 px-4 py-3.5 sm:px-5">
            <div className={cn('w-10 shrink-0 text-center', day.relation === 'past' && 'opacity-55')}>
              <p className={cn('text-[11px] uppercase tracking-[0.14em]', day.relation === 'today' ? 'text-keppel-300' : 'text-foreground/45')}>
                {weekdayOf(day.date)}
              </p>
              <p className={cn('mt-0.5 text-base font-semibold tabular-nums', day.relation === 'today' ? 'text-foreground' : 'text-foreground/70')}>
                {dayOfMonth(day.date)}
              </p>
            </div>

            <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
              {day.exams.map(exam => (
                <p key={exam.title} className="text-sm font-medium text-amber-300">
                  {exam.title}{exam.subjectName ? <span className="font-normal text-amber-300/70"> · {exam.subjectName}</span> : null}
                </p>
              ))}

              {day.sessions.filter(s => s.status === 'completed' || s.status === 'skipped').map(s => (
                <p key={s.id} className="flex items-center gap-2 text-sm text-foreground/65">
                  {s.status === 'completed'
                    ? <Check className="size-3.5 shrink-0 text-keppel-400" aria-label="Completed" />
                    : <Minus className="size-3.5 shrink-0 text-foreground/35" aria-label="Skipped" />}
                  <span className="truncate">{s.status === 'skipped' ? 'Skipped' : (s.topicName ?? 'Study session')}</span>
                  {s.status === 'completed' && <span className="shrink-0 text-xs text-foreground/40">{minutesLabel(s.minutes)}</span>}
                </p>
              ))}

              {day.planned.map((p, i) => (
                <p key={`${p.topicName}:${i}`} className="flex items-center gap-2 text-sm text-foreground/85">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-keppel-400/80" />
                  <span className="truncate">{p.topicName}</span>
                  <span className="shrink-0 text-xs text-foreground/40">{p.subjectName} · {minutesLabel(p.minutes)}</span>
                </p>
              ))}

              {day.reviewsDueCount > 0 && (
                <p className="text-sm text-foreground/60">
                  <span className="text-foreground/40">Review due: </span>
                  {day.reviewsDue.map(r => r.topicName).join(', ')}
                  {day.reviewsDueCount > day.reviewsDue.length && ` and ${day.reviewsDueCount - day.reviewsDue.length} more`}
                </p>
              )}

              {isEmpty(day) && (
                <p className="text-sm text-foreground/30">
                  {day.relation === 'past' ? 'No session recorded' : day.relation === 'today' ? 'Nothing planned' : 'Nothing scheduled yet'}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

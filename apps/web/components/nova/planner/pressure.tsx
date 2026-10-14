'use client'

import Link from 'next/link'
import type { NovaPlannerReady, PlannerPressure } from '@repo/api/nova/product/planner.types'
import { deadlineDate, inDays } from '../format'
import { GOALS_HREF } from '@repo/api/nova/product/goals.types'

function Preparation({ item }: { item: PlannerPressure }) {
  const prep = item.preparation
  // An assignment, a project or a plain date: Nova keeps the date and counts
  // it down. There are no topics to be ready on, so it claims no readiness.
  if (!item.prepares) {
    return <p className="mt-2 text-xs leading-relaxed text-foreground/45">Nova keeps this date and counts it down. Its steps are your tasks; it does not change your study plan.</p>
  }
  if (!prep) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-foreground/45">
        {item.subjectName
          ? `Nova has no topics on record for ${item.subjectName}, so it can't say how ready you are.`
          : "Nova doesn't know which subject this is for, so it can't say how ready you are."}
      </p>
    )
  }
  const tracked = prep.weak.length + prep.developing.length + prep.solid.length
  return (
    <div className="mt-2 space-y-1 text-xs leading-relaxed text-foreground/55">
      <p>
        Of {tracked} tracked topic{tracked === 1 ? '' : 's'}: {prep.weak.length} weak, {prep.developing.length} developing, {prep.solid.length} solid.
      </p>
      {prep.weak.length > 0 && <p><span className="text-foreground/40">Weak: </span>{prep.weak.join(', ')}</p>}
      {prep.focusTopic && (prep.weak.length > 0 || prep.developing.length > 0) && (
        <p><span className="text-foreground/40">Nova would start with: </span><span className="text-foreground/80">{prep.focusTopic}</span></p>
      )}
    </div>
  )
}

// Exams ahead, soonest first. Readiness is stated only where Nova has topic
// mastery to base it on.
export function UpcomingPressure({ pressure, timezone, goals }: {
  pressure: NovaPlannerReady['pressure']
  timezone: string
  goals:    string[]
}) {
  return (
    <section aria-labelledby="planner-pressure" className="rounded-2xl border border-white/8 bg-card/50 p-5">
      <h2 id="planner-pressure" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Upcoming pressure</h2>

      {pressure.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-foreground/55" data-unknown="no_exams">
          Nova has no date on record yet: no exam, interview or deadline. Add one in setup and the plan will start building toward it.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-white/6">
          {pressure.map(item => (
            <li key={`${item.title}:${item.scheduledAt}`} data-exam={item.title} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-foreground/90">{item.title}</p>
                <p className={item.daysUntil <= 7 ? 'shrink-0 text-sm font-medium text-amber-300' : 'shrink-0 text-sm text-foreground/60'}>
                  {inDays(item.daysUntil)}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-foreground/45">
                {[item.kindLabel, item.subjectName, deadlineDate(item.scheduledAt, timezone)].filter(Boolean).join(' · ')}
              </p>
              {item.drivesPlan && (
                <p className="mt-2 inline-block rounded-full border border-keppel-400/30 px-2 py-0.5 text-[11px] text-keppel-200">
                  Today&apos;s plan is built around this
                </p>
              )}
              <Preparation item={item} />
              {item.pace && (
                <details className="mt-3 rounded-xl border border-white/8 px-3 py-2.5" data-pace={item.pace.fits ? 'fits' : 'short'}>
                  <summary className="cursor-pointer text-xs font-medium text-foreground/70">
                    Rough pace: {item.pace.topicsRemaining === 0 ? 'nothing left to pace' : item.pace.fits ? 'there is room' : 'it does not all fit'}
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-foreground/70">{item.pace.summary}</p>
                  <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">This counts on</p>
                  <ul className="mt-1 space-y-1">
                    {item.pace.assumptions.map(a => <li key={a} className="text-xs leading-relaxed text-foreground/50">{a}</li>)}
                  </ul>
                  <p className="mt-2 text-xs leading-relaxed text-foreground/45">A projection from what is on record, not a forecast of how it will go. It does not change your plan.</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-white/8 pt-5" data-section="goals">
        <h3 className="text-xs font-medium text-foreground/55">Working toward</h3>
        {goals.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {goals.map(goal => <li key={goal} className="text-sm leading-relaxed text-foreground/75">{goal}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-foreground/50" data-unknown="no_goals">
            You haven&apos;t told Nova what you&apos;re working toward. <Link href={GOALS_HREF} className="font-medium text-keppel-300 hover:text-keppel-200">Add a goal</Link>
          </p>
        )}
      </div>
    </section>
  )
}

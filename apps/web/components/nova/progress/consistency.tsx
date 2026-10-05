'use client'

import { cn } from '@/lib/utils'
import type { ConsistencyTrend, ProgressConsistency } from '@repo/api/nova/product/progress.types'
import { daysAgo, minutesLabel, sentenceCase } from '../format'

const TREND_LABEL: Record<Exclude<ConsistencyTrend, 'not_enough_history'>, string> = {
  more_consistent: 'More consistent',
  steady:          'Steady',
  less_consistent: 'Less consistent',
}

// "12 Sep" for a YYYY-MM-DD day key the server drew.
function shortDay(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// Days studied in each week, out of seven. The server counted them; the bar
// only draws the count.
export function Consistency({ consistency }: { consistency: ProgressConsistency }) {
  const { weeks, trend, trendBasis } = consistency
  return (
    <section aria-labelledby="progress-consistency" data-section="consistency" data-trend={trend}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="progress-consistency" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Consistency</h2>
        {consistency.daysSinceLastActive !== null && (
          <p className="text-xs text-foreground/50" data-last-active>Last study day: {daysAgo(consistency.daysSinceLastActive)}</p>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-card/40 p-4 sm:p-5">
        <p className="text-sm text-foreground/80" data-trend-text>
          {trend === 'not_enough_history' || !trendBasis
            ? 'Nova compares your last four weeks with the four before. That needs eight finished weeks since your first session.'
            : <>
                <span className="font-medium text-foreground">{TREND_LABEL[trend]}.</span>{' '}
                About {trendBasis.recent} study days a week over the last four weeks, against {trendBasis.earlier} in the four before.
              </>}
        </p>

        <ol className="mt-5 grid grid-cols-9 items-end gap-1.5 sm:gap-3" aria-label="Days studied in each week">
          {weeks.map(week => (
            <li key={week.weekStart} data-week={week.weekStart} data-active-days={week.activeDays} data-before-start={week.beforeStart} className="min-w-0 text-center">
              <p className={cn('text-xs tabular-nums', week.beforeStart ? 'text-foreground/20' : 'text-foreground/70')}>
                {week.beforeStart ? '–' : week.activeDays}
              </p>
              <div className="mx-auto mt-1 flex h-20 w-full max-w-9 items-end overflow-hidden rounded-md bg-white/4" aria-hidden>
                <div
                  className={cn('w-full rounded-md', week.current ? 'bg-keppel-400/50' : 'bg-keppel-400')}
                  style={{ height: `${(week.activeDays / 7) * 100}%` }}
                />
              </div>
              <p className={cn('mt-1.5 truncate text-[10px] leading-tight', week.current ? 'text-keppel-300' : 'text-foreground/40')}>
                {week.current ? 'Now' : shortDay(week.weekStart)}
              </p>
              <p className="sr-only">
                {week.beforeStart
                  ? `Week of ${shortDay(week.weekStart)}: before your first session`
                  : `Week of ${shortDay(week.weekStart)}: ${week.activeDays} of 7 days, ${week.sessions} sessions, ${minutesLabel(week.minutes)}`}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-foreground/40">
          Days with at least one finished session of 10 minutes or more, out of 7. Weeks start on Monday ({consistency.timezone} time). A dash is a week before your first session.
        </p>
      </div>

      {consistency.comebacks.length > 0 && (
        <ul className="mt-4 space-y-1.5" data-comebacks>
          {consistency.comebacks.slice(0, 3).map(c => (
            <li key={c.date} className="text-sm text-foreground/65">
              <span className="text-foreground/85">Came back after {c.gapDays} days away</span>
              <span className="text-foreground/40"> · {sentenceCase(new Date(c.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: consistency.timezone }))}</span>
              {c.topicName && <span className="text-foreground/40"> · {c.topicName}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

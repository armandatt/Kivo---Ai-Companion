'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { TodayActiveSession } from '@repo/api/nova/product/today.types'
import { minutesLabel } from './format'
import { BUTTON_PRIMARY, SURFACE_RAISED } from './workspace/ui'
import { toneStyle } from './subject-color'

// A session is already running: it takes the place of the recommendation.
export function ActiveSessionCard({ session }: { session: TodayActiveSession }) {
  const paused  = session.status === 'paused'
  const planned = session.plannedDurationMinutes
  const left    = planned > 0 ? planned - session.elapsedMinutes : null

  return (
    <section aria-labelledby="nova-current-session" style={toneStyle(session.subjectName)}
      className={`${SURFACE_RAISED} subject-tone relative overflow-hidden`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-[var(--sc-soft)] to-transparent" />
      <div className="relative p-5 sm:p-6">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--sc-ink)]">
          <span className={paused ? 'size-2 rounded-full bg-amber-300' : 'size-2 animate-pulse rounded-full bg-[var(--sc)]'} />
          {paused ? 'Session paused' : 'Session in progress'}
        </p>

        {session.subjectName && <p className="mt-3 text-sm text-foreground/60">{session.subjectName}</p>}
        <h2 id="nova-current-session" className="mt-0.5 text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.75rem]">
          {session.topicName ?? 'Study session'}
        </h2>

        <p className="mt-2 text-sm text-foreground/75">
          {minutesLabel(session.elapsedMinutes)} in
          {left !== null && (left > 0
            ? <span className="text-foreground/60"> · {minutesLabel(left)} left of {minutesLabel(planned)}</span>
            : <span className="text-foreground/60"> · past the {minutesLabel(planned)} you planned</span>)}
        </p>

        <Link
          href="/focus"
          className={`${BUTTON_PRIMARY} mt-4 w-full sm:w-auto`}
        >
          Resume session <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </section>
  )
}

'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { TodayActiveSession } from '@repo/api/nova/product/today.types'
import { minutesLabel } from './format'

// A session is already running: it takes the place of the recommendation.
export function ActiveSessionCard({ session }: { session: TodayActiveSession }) {
  const paused  = session.status === 'paused'
  const planned = session.plannedDurationMinutes
  const left    = planned > 0 ? planned - session.elapsedMinutes : null

  return (
    <section aria-labelledby="nova-current-session" className="relative overflow-hidden rounded-3xl border border-keppel-400/25 bg-card/70 p-6 sm:p-9">
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-keppel-500/15 blur-3xl" />

      <div className="relative">
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/90">
          <span className={paused ? 'size-1.5 rounded-full bg-amber-300' : 'size-1.5 animate-pulse rounded-full bg-keppel-300'} />
          {paused ? 'Session paused' : 'Session in progress'}
        </p>

        {session.subjectName && <p className="mt-6 text-sm text-foreground/55">{session.subjectName}</p>}
        <h2 id="nova-current-session" className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-[2.6rem]">
          {session.topicName ?? 'Study session'}
        </h2>

        <p className="mt-4 text-sm text-foreground/70">
          {minutesLabel(session.elapsedMinutes)} in
          {left !== null && (left > 0
            ? <span className="text-foreground/45"> · {minutesLabel(left)} left of {minutesLabel(planned)}</span>
            : <span className="text-foreground/45"> · past the {minutesLabel(planned)} you planned</span>)}
        </p>

        <Link
          href="/focus"
          className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-300 sm:w-auto"
        >
          Resume session <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  )
}

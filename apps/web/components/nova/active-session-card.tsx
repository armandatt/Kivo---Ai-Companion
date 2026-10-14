'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { TodayActiveSession } from '@repo/api/nova/product/today.types'
import { minutesLabel } from './format'
import { BUTTON_PRIMARY, SURFACE } from './workspace/ui'

// A session is already running: it takes the place of the recommendation.
export function ActiveSessionCard({ session }: { session: TodayActiveSession }) {
  const paused  = session.status === 'paused'
  const planned = session.plannedDurationMinutes
  const left    = planned > 0 ? planned - session.elapsedMinutes : null

  return (
    <section aria-labelledby="nova-current-session" className={`${SURFACE} border-keppel-400/30 p-4 sm:p-5`}>
      <div>
        <p className="flex items-center gap-2 text-xs font-semibold text-keppel-300">
          <span className={paused ? 'size-1.5 rounded-full bg-amber-300' : 'size-1.5 animate-pulse rounded-full bg-keppel-300'} />
          {paused ? 'Session paused' : 'Session in progress'}
        </p>

        {session.subjectName && <p className="mt-3 text-sm text-foreground/60">{session.subjectName}</p>}
        <h2 id="nova-current-session" className="mt-0.5 text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
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

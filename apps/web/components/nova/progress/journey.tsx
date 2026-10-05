'use client'

import { Flag, RotateCcw, Sparkles, Sprout, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JourneyEvent, JourneyEventType } from '@repo/api/nova/product/progress.types'

const ICON: Record<JourneyEventType, typeof Flag> = {
  first_session:     Sprout,
  session_milestone: Flag,
  comeback:          RotateCcw,
  topic_level_up:    TrendingUp,
  breakthrough:      Sparkles,
}

// The moments that mark the learner's path, newest first. Each one names the
// record it rests on.
export function Journey({ events, timezone }: { events: JourneyEvent[]; timezone: string }) {
  return (
    <section aria-labelledby="progress-journey" data-section="journey">
      <h2 id="progress-journey" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Journey</h2>
      {events.length === 0 ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/55" data-empty="journey">
          Nothing to mark in the last year yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {events.map((event, i) => {
            const Icon = ICON[event.type]
            return (
              <li key={event.id} data-event={event.type} data-importance={event.importance} className="relative flex gap-4 pb-6 last:pb-0">
                {i < events.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-white/8" />}
                <span className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border',
                  event.importance === 'major' ? 'border-keppel-400/40 bg-keppel-400/10 text-keppel-300' : 'border-white/10 bg-white/3 text-foreground/55',
                )}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-xs text-foreground/45">
                    {new Date(event.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone })}
                    {event.subjectName && <span> · {event.subjectName}</span>}
                  </p>
                  <p className="mt-0.5 text-[15px] font-medium text-foreground/90" data-event-title>{event.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-foreground/60">{event.description}</p>
                  <p className="mt-1 text-xs text-foreground/35" data-event-evidence>From: {event.evidence}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

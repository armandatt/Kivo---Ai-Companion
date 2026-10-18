'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Today's opening, in two parts. The masthead: the date and the two ways to
// act on anything, the greeting in the editorial serif, a note when the day
// is not an ordinary one, and the day's brief (facts the server reported).
// Under it, the band where today is worked: the one thing to do next (or the
// session that is running) placed like a card on the canvas's dot grid,
// beside the day's flow and how long there is. On a phone it all stacks.
export function TodayHero({ greeting, context, properties, actions, focal, children }: {
  greeting:   ReactNode
  // A line about the day, only when it is not an ordinary one.
  context:    string | null
  // The day's brief.
  properties: ReactNode
  // Search and New.
  actions:    ReactNode
  // The next action or the running session; nothing when there is neither.
  focal:      ReactNode | null
  // The flow and the time control.
  children?:  ReactNode
}) {
  return (
    <header data-section="today-hero">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-subtle">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">{actions}</div>
      </div>

      <h1 className="mt-4 text-[2.1rem] font-semibold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-5xl lg:text-[3.4rem]">
        {greeting}
      </h1>
      {context && (
        <p className="mt-4 flex max-w-prose items-start gap-2.5 text-sm leading-relaxed text-foreground/85">
          <span aria-hidden className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-ember-400" />{context}
        </p>
      )}
      <div className="mt-5">{properties}</div>

      {(focal || children) && (
        <div className="relative isolate mt-8 overflow-hidden rounded-[1.5rem] border border-white/8 bg-card/60" data-section="today-now">
          <div aria-hidden className="nova-canvas pointer-events-none absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
          <div className={cn('grid gap-8 p-4 sm:p-6 lg:p-8', focal && children && 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10')}>
            {focal && <div className="nova-rise min-w-0">{focal}</div>}
            {children && <div className="flex min-w-0 flex-col gap-7">{children}</div>}
          </div>
        </div>
      )}
    </header>
  )
}

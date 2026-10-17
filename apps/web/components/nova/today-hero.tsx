'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { heroStyle } from './subject-color'

// Today's opening: the date and greeting on a surface washed with the
// colours of the day's subjects, what kind of day it is, the day's flow, and,
// floating at the right edge and hanging over the page below, the one thing
// to do next (or the session that is running). On a phone it all stacks.
export function TodayHero({ greeting, context, subjects, properties, actions, focal, children }: {
  greeting:   ReactNode
  // A line about the day, only when it is not an ordinary one.
  context:    string | null
  // The day's subjects, in plan order: their colours wash the surface.
  subjects:   string[]
  properties: ReactNode
  // Search and New.
  actions:    ReactNode
  // The next action or the running session; nothing when there is neither.
  focal:      ReactNode | null
  // The flow and the time control, under the greeting.
  children?:  ReactNode
}) {
  return (
    <header className="relative" data-section="today-hero">
      <div className="nova-hero relative rounded-[1.75rem] border border-white/8 shadow-soft" style={heroStyle(subjects)}>
        <div className={cn('grid gap-8 p-5 sm:p-8 lg:gap-10 lg:p-10', focal && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:pb-12')}>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/55">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">{actions}</div>
            </div>
            <h1 className="mt-4 text-[2.1rem] font-semibold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-5xl lg:text-[3.4rem]">
              {greeting}
            </h1>
            {context && (
              <p className="mt-3 inline-flex max-w-prose items-start gap-2 self-start rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-sm text-amber-200">{context}</p>
            )}
            <div className="mt-5">{properties}</div>
            {children && <div className="mt-auto space-y-5 pt-8">{children}</div>}
          </div>
          {focal && <div className="nova-rise relative z-10 min-w-0 lg:-mb-28 lg:self-end">{focal}</div>}
        </div>
      </div>
    </header>
  )
}

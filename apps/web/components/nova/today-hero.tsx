'use client'

import type { ReactNode } from 'react'
import { heroStyle } from './subject-color'

// Today's opening, as a page title rather than a banner: the date, the
// greeting, what kind of day it is, and the one way to add something. A
// faint wash of the day's subjects' colours sits behind it, nothing more.
// The block to do next is not in here: it leads the page below.
export function TodayHero({ greeting, context, subjects, properties, actions }: {
  greeting:   ReactNode
  // A line about the day, only when it is not an ordinary one.
  context:    string | null
  // The day's subjects, in plan order: their colours wash the background.
  subjects:   string[]
  properties: ReactNode
  // New.
  actions:    ReactNode
}) {
  return (
    <header className="relative isolate" data-section="today-hero">
      <div aria-hidden className="nova-hero pointer-events-none absolute -inset-x-16 -top-10 -z-10 h-72 opacity-60 mask-[radial-gradient(ellipse_70%_100%_at_30%_0%,black,transparent_75%)]" style={heroStyle(subjects)} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="mt-2 text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.4rem]">
            {greeting}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>
      </div>
      <div className="mt-3">{properties}</div>
      {context && (
        <p className="mt-3 inline-flex max-w-prose items-start gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-sm text-amber-200">{context}</p>
      )}
    </header>
  )
}

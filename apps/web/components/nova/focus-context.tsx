'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bookmark, CalendarDays, ListChecks, NotebookPen } from 'lucide-react'
import type { NovaFocusContextReady, NovaFocusContextView } from '@repo/api/nova/product/focus-context.types'
import { cn } from '@/lib/utils'
import { inDays, relativeDay } from './format'

// What the learner has filed under the topic in front of them: their open
// tasks, their saved pages, the subject's next exam and the note they left
// after their last session on it. The server decides what belongs
// (GET /api/nova/focus-context); the page lists it. Nothing here is evidence
// of anything studied, and the page says nothing when there is nothing.

type Where = { subjectName: string | null; topicName: string } | null

// `where` null: the running session's topic. `refresh` changes when the
// answer may have (a new session, a different recommendation).
export function useFocusContext(where: Where, refresh: string | null, enabled = true): NovaFocusContextReady | null {
  const [view, setView] = useState<NovaFocusContextReady | null>(null)
  const subject = where?.subjectName ?? ''
  const topic   = where?.topicName ?? ''

  useEffect(() => {
    if (!enabled) { setView(null); return }
    let live = true
    const query = topic ? `?${new URLSearchParams({ topic, ...(subject ? { subject } : {}) }).toString()}` : ''
    fetch(`/api/nova/focus-context${query}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: NovaFocusContextView | null) => { if (live) setView(data && data.status === 'ready' ? data : null) })
      // Context is an extra. If it does not load, the page works without it.
      .catch(() => { if (live) setView(null) })
    return () => { live = false }
  }, [subject, topic, refresh, enabled])

  return view
}

const dueText = (days: number | null) =>
  days === null ? null : days < 0 ? `${-days}d overdue` : days === 0 ? 'due today' : `due ${inDays(days)}`

export function hasFocusContext(view: NovaFocusContextReady | null): view is NovaFocusContextReady {
  return view !== null && (view.tasks.length > 0 || view.resources.length > 0 || view.deadline !== null || view.lastNote !== null)
}

export function FocusContext({ view, className }: { view: NovaFocusContextReady; className?: string }) {
  const heading = 'flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/40'
  return (
    <section aria-label={`What you have for ${view.topicName ?? 'this session'}`} data-section="focus-context"
      className={cn('space-y-5 rounded-2xl border border-white/8 bg-card/50 p-5 text-left', className)}>
      {view.deadline && (
        <p className="flex items-center gap-2 text-sm text-foreground/75" data-context="deadline">
          <CalendarDays aria-hidden className="size-4 shrink-0 text-foreground/40" />
          {view.deadline.title} is {inDays(view.deadline.daysUntil)}.
        </p>
      )}

      {view.lastNote && (
        <div data-context="last-note">
          <p className={heading}><NotebookPen aria-hidden className="size-3.5" /> Your note from last time <span className="normal-case tracking-normal">· {relativeDay(view.lastNote.date)}</span></p>
          <dl className="mt-2 space-y-1.5 text-sm leading-relaxed">
            {view.lastNote.next && <div><dt className="inline text-foreground/45">Next step: </dt><dd className="inline text-foreground/85">{view.lastNote.next}</dd></div>}
            {view.lastNote.blocked && <div><dt className="inline text-foreground/45">What got in the way: </dt><dd className="inline text-foreground/75">{view.lastNote.blocked}</dd></div>}
            {view.lastNote.did && <div><dt className="inline text-foreground/45">What you did: </dt><dd className="inline text-foreground/75">{view.lastNote.did}</dd></div>}
          </dl>
        </div>
      )}

      {view.tasks.length > 0 && (
        <div data-context="tasks">
          <p className={heading}><ListChecks aria-hidden className="size-3.5" /> Your open tasks here</p>
          <ul className="mt-2 space-y-1.5">
            {view.tasks.map(task => (
              <li key={task.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-foreground/85">{task.title}</span>
                {dueText(task.dueInDays) && (
                  <span className={cn('shrink-0 text-xs', task.dueInDays !== null && task.dueInDays <= 0 ? 'font-medium text-amber-300' : 'text-foreground/45')}>{dueText(task.dueInDays)}</span>
                )}
              </li>
            ))}
          </ul>
          <Link href="/planner?view=board" className="mt-2 inline-block text-xs text-foreground/50 underline decoration-white/20 underline-offset-4 hover:text-foreground">Open the board</Link>
        </div>
      )}

      {view.resources.length > 0 && (
        <div data-context="resources">
          <p className={heading}><Bookmark aria-hidden className="size-3.5" /> Pages you saved for this</p>
          <ul className="mt-2 space-y-1.5">
            {view.resources.map(page => (
              <li key={page.id} className="flex items-baseline justify-between gap-3 text-sm">
                <a href={page.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-foreground/85 underline decoration-white/20 underline-offset-4 hover:decoration-white/60">{page.title}</a>
                <span className="shrink-0 text-xs text-foreground/40">{page.domain}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-foreground/40">Opening a page is not counted as study. Your session and how you say it went are.</p>
        </div>
      )}
    </section>
  )
}

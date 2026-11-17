'use client'

// The nearest dated item, on one line at the top of Today: "OS exam · in 23
// days · 16 of 20 topics to go", and a way to see those topics (the map's
// Gaps lens, inside that subject). Every figure is from the server
// (today.ts: calendar days; planning-engine notYetSolid for the count);
// nothing is shown for a date filed under no subject beyond its date.

import Link from 'next/link'
import { CalendarClock, ChevronRight } from 'lucide-react'
import type { TodayDeadline } from '@repo/api/nova/product/today.types'
import { inDays } from '../format'
import { cn } from '@/lib/utils'

export function examGapsHref(d: Pick<TodayDeadline, 'subjectId'>): string | null {
  return d.subjectId ? `/map?lens=gaps&explore=${encodeURIComponent(`subject:${d.subjectId}`)}` : null
}

export function topicsToGo(d: Pick<TodayDeadline, 'topics'>): string | null {
  const t = d.topics
  if (!t || t.total === 0) return null
  if (t.notSolid === 0) return `all ${t.total} topic${t.total === 1 ? '' : 's'} solid`
  return `${t.notSolid} of ${t.total} topic${t.total === 1 ? '' : 's'} to go`
}

export function ExamLine({ deadline }: { deadline: TodayDeadline }) {
  const soon = deadline.daysUntil <= 7
  const togo = topicsToGo(deadline)
  const gaps = examGapsHref(deadline)
  return (
    <div className={cn('mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3.5 py-2.5 text-sm',
      soon ? 'border-amber-400/30 bg-amber-400/[0.06]' : 'border-white/8 bg-card/40')} data-today-exam>
      <CalendarClock aria-hidden className={cn('size-4 shrink-0', soon ? 'text-amber-300' : 'text-subtle')} />
      <span className="font-medium text-foreground">{deadline.title}</span>
      <span className="text-foreground/60">{deadline.kindLabel.toLowerCase()} {inDays(deadline.daysUntil)}</span>
      {togo && <span className="text-foreground/60">· {togo}</span>}
      {gaps && deadline.topics && deadline.topics.notSolid > 0 && (
        <Link href={gaps} className="ml-auto inline-flex items-center gap-0.5 font-medium text-nova-ink hover:underline" data-today-exam-gaps>
          See what’s left <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  )
}

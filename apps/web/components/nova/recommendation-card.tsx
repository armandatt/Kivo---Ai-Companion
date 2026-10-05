'use client'

import { useState } from 'react'
import { ArrowRight, ChevronDown, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TodayAction } from '@repo/api/nova/product/today.types'
import { ACTIVITY_LABEL, URGENCY_LABEL, minutesLabel, sentenceCase } from './format'

type Props = {
  action:      TodayAction
  // Extra decision factors from Nova's state, shown under "Why this?".
  context?:    string[]
  onStart:     () => void
  starting?:   boolean
  error?:      string | null
  className?:  string
}

const URGENCY_TONE: Record<TodayAction['urgency'], string> = {
  critical: 'text-amber-300',
  high:     'text-keppel-300',
  normal:   'text-foreground/60',
  optional: 'text-foreground/45',
}

// Nova's next best action. Everything shown comes from the Today contract:
// the topic and length from the planning engine, the reasons from the facts
// behind that block.
export function RecommendationCard({ action, context = [], onStart, starting = false, error, className }: Props) {
  const [open, setOpen] = useState(false)
  const hasWhy = action.rationale.length > 0 || context.length > 0

  return (
    <section
      aria-labelledby="nova-next-action"
      className={cn(
        'relative overflow-hidden rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9',
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-keppel-500/12 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-keppel-400/50 to-transparent" />

      <div className="relative">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/80">Your next best action</p>

        <p className="mt-6 text-sm text-foreground/55">{action.subjectName}</p>
        <h2 id="nova-next-action" className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-[2.6rem]">
          {action.topicName}
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 text-foreground/80">
            <Clock className="size-3.5 text-foreground/45" />
            {minutesLabel(action.durationMinutes)}
          </span>
          <span aria-hidden className="text-foreground/20">·</span>
          <span className="text-foreground/60">{ACTIVITY_LABEL[action.activityType]}</span>
          <span aria-hidden className="text-foreground/20">·</span>
          <span className={cn('font-medium', URGENCY_TONE[action.urgency])}>{URGENCY_LABEL[action.urgency]}</span>
        </div>

        {action.trimmedToFit && (
          <p className="mt-2 text-xs text-foreground/45">Shortened to fit the time you have.</p>
        )}

        {action.reasons.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Why Nova chose this">
            {action.reasons.map(reason => (
              <li key={reason} className="rounded-full border border-white/8 bg-white/4 px-3 py-1 text-xs text-foreground/75">
                {sentenceCase(reason)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-300 disabled:opacity-70 sm:w-auto"
          >
            {starting
              ? <><Loader2 className="size-4 animate-spin" /> Starting…</>
              : <>Start {minutesLabel(action.durationMinutes)} session <ArrowRight className="size-4" /></>}
          </button>

          {hasWhy && (
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              aria-expanded={open}
              aria-controls="nova-why"
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-4 text-sm text-foreground/65 transition-colors hover:bg-white/5 hover:text-foreground"
            >
              Why this?
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
            </button>
          )}
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

        {hasWhy && open && (
          <div id="nova-why" className="mt-6 border-t border-white/8 pt-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/40">Why Nova chose this</p>
            {action.rationale && (
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/80">{action.rationale}</p>
            )}
            {(action.reasons.length > 0 || context.length > 0) && (
              <ul className="mt-3 space-y-1.5 text-sm text-foreground/65">
                {[...action.reasons.map(sentenceCase), ...context].map(line => (
                  <li key={line} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-keppel-400/70" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

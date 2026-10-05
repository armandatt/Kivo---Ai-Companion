'use client'

import Link from 'next/link'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NovaPlannerReady, PlannerBlock } from '@repo/api/nova/product/planner.types'
import { ACTIVITY_LABEL, URGENCY_LABEL, minutesLabel, sentenceCase } from '../format'

type Props = {
  today:     NovaPlannerReady['today']
  budget:    NovaPlannerReady['reasoning']['budget']
  onStart:   (block: PlannerBlock) => void
  starting:  string | null
  error:     string | null
}

const URGENCY_TONE: Record<PlannerBlock['urgency'], string> = {
  critical: 'text-amber-300',
  high:     'text-keppel-300',
  normal:   'text-foreground/55',
  optional: 'text-foreground/40',
}

const EMPTY: Record<NonNullable<NovaPlannerReady['today']['emptyReason']>, { title: string; body: string }> = {
  no_topics: {
    title: 'Nova needs a little more learning context before it can build a useful plan',
    body:  'A plan comes from the topics you have studied and how well each one stuck. Nova has none on record yet. Tell it what you covered recently, on Today or in Telegram, and blocks will appear here.',
  },
  too_little_time: {
    title: "That's less time than Nova's shortest block",
    body:  'Nothing useful fits in the time you chose, so nothing is planned. Pick a longer time above.',
  },
  recovery: {
    title: 'Nothing is planned today',
    body:  'Nova is keeping today light after a run of missed days, and there is no comfortable topic on record to revisit. Rest counts.',
  },
  nothing_due: {
    title: 'Nothing is due today',
    body:  'No review has come due and no exam is close enough to pull work forward. The plan will fill again as reviews fall due.',
  },
}

const focusLink =
  'inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300'

// Today's blocks, exactly as the Planning Engine ordered them. A running
// session takes over the page's one primary action.
export function TodayPlan({ today, budget, onStart, starting, error }: Props) {
  const { blocks, activeSession: active, activeBlockId, done } = today
  const empty = blocks.length === 0 && today.emptyReason ? EMPTY[today.emptyReason] : null
  // The first planned block is the one to start; the rest wait behind it.
  const nextId = active ? null : blocks[0]?.id ?? null

  return (
    <section aria-labelledby="planner-today">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="planner-today" className="text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/80">Today</h2>
        {blocks.length > 0 && (
          <p className="text-xs text-foreground/45">
            {minutesLabel(budget.plannedMinutes)} planned
            {budget.minutes > budget.plannedMinutes && <> of {minutesLabel(budget.minutes)}</>}
          </p>
        )}
      </div>

      {active && activeBlockId === null && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-keppel-400/25 bg-card/70 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-keppel-300/90">
              <span className={cn('size-1.5 rounded-full', active.status === 'paused' ? 'bg-amber-300' : 'animate-pulse bg-keppel-300')} />
              {active.status === 'paused' ? 'Session paused' : 'Session in progress'}
            </p>
            <p className="mt-1.5 truncate text-base font-medium text-foreground">{active.topicName ?? 'Study session'}</p>
            <p className="text-xs text-foreground/45">{minutesLabel(active.elapsedMinutes)} in · not one of today&apos;s planned blocks</p>
          </div>
          <Link href="/focus" className={focusLink}>Resume <ArrowRight className="size-4" /></Link>
        </div>
      )}

      {empty ? (
        <div className="mt-4 rounded-2xl border border-white/8 bg-card/50 p-5 sm:p-7">
          <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">{empty.title}</h3>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/60">{empty.body}</p>
          {today.emptyReason === 'no_topics' && (
            <Link href="/home" className="mt-5 inline-flex h-10 items-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5">
              Tell Nova on Today
            </Link>
          )}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {blocks.map(block => {
            const running = block.id === activeBlockId
            const isNext  = block.id === nextId
            return (
              <li
                key={block.id}
                data-block={block.topicName}
                data-status={block.status}
                className={cn(
                  'rounded-2xl border p-4 sm:p-5',
                  running ? 'border-keppel-400/30 bg-card/80' : isNext ? 'border-white/10 bg-card/70' : 'border-white/6 bg-card/40',
                )}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3.5">
                    <span aria-hidden className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      running ? 'bg-keppel-400 text-keppel-950' : 'border border-white/12 text-foreground/50',
                    )}>
                      {block.order}
                    </span>
                    <div className="min-w-0">
                      {running && (
                        <p className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-keppel-300/90">
                          <span className={cn('size-1.5 rounded-full', block.status === 'paused' ? 'bg-amber-300' : 'animate-pulse bg-keppel-300')} />
                          {block.status === 'paused' ? 'Paused' : 'In progress'}
                          {active && <span className="normal-case tracking-normal text-foreground/45">· {minutesLabel(active.elapsedMinutes)} in</span>}
                        </p>
                      )}
                      <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">{block.topicName}</h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-foreground/50">
                        <span>{block.subjectName}</span>
                        <span aria-hidden className="text-foreground/20">·</span>
                        <span className="text-foreground/75">{minutesLabel(block.durationMinutes)}</span>
                        <span aria-hidden className="text-foreground/20">·</span>
                        <span>{ACTIVITY_LABEL[block.activityType]}</span>
                        <span aria-hidden className="text-foreground/20">·</span>
                        <span className={cn('font-medium', URGENCY_TONE[block.urgency])}>{URGENCY_LABEL[block.urgency]}</span>
                      </p>
                      {block.reasons.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`Why ${block.topicName}`}>
                          {block.reasons.map(reason => (
                            <li key={reason} className="rounded-full border border-white/8 bg-white/4 px-2.5 py-0.5 text-[11px] text-foreground/70">
                              {sentenceCase(reason)}
                            </li>
                          ))}
                        </ul>
                      )}
                      {block.rationale && <p className="mt-2.5 max-w-prose text-xs leading-relaxed text-foreground/50">{block.rationale}</p>}
                    </div>
                  </div>

                  {running ? (
                    <Link href="/focus" className={cn(focusLink, 'w-full sm:w-auto')}>Resume <ArrowRight className="size-4" /></Link>
                  ) : !active && (
                    <button
                      type="button"
                      onClick={() => onStart(block)}
                      disabled={starting !== null}
                      className={cn(
                        'inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-60 sm:w-auto',
                        isNext
                          ? 'bg-keppel-400 text-keppel-950 hover:bg-keppel-300'
                          : 'border border-white/12 text-foreground/80 hover:border-keppel-400/50 hover:text-keppel-200',
                      )}
                    >
                      {starting === block.id ? <><Loader2 className="size-4 animate-spin" /> Starting…</> : <>Start <ArrowRight className="size-4" /></>}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {active && blocks.length > 0 && (
        <p className="mt-3 text-xs text-foreground/40">One session at a time. Finish or end the current one to start another block.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      {done.length > 0 && (
        <div className="mt-6" data-section="done-today">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/40">
            Done today · {minutesLabel(today.doneMinutes)}
          </h3>
          <ul className="mt-2.5 space-y-1.5">
            {done.map(s => (
              <li key={s.id} className="flex items-center gap-2.5 text-sm text-foreground/65">
                <Check className="size-3.5 shrink-0 text-keppel-400" />
                <span className="truncate">{s.topicName ?? 'Study session'}</span>
                <span className="shrink-0 text-xs text-foreground/40">{minutesLabel(s.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

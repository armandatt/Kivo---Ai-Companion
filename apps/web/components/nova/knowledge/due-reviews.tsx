'use client'

import { ArrowRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeDueReview } from '@repo/api/nova/product/knowledge.types'
import { minutesLabel, relativeDay, sentenceCase } from '../format'
import { LEVEL_LABEL } from './labels'

type Props = {
  reviews:   KnowledgeDueReview[]
  hasTopics: boolean
  // A session is already running: one at a time, so nothing can be started.
  blocked:   boolean
  onStart:   (review: KnowledgeDueReview) => void
  starting:  string | null
  error:     string | null
}

// Topics due for review now, least retained first. Start opens a normal
// study session on the topic through the same route Home and Planner use.
export function DueReviews({ reviews, hasTopics, blocked, onStart, starting, error }: Props) {
  return (
    <section aria-labelledby="knowledge-due">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="knowledge-due" className="text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/80">Due for review</h2>
        {reviews.length > 0 && <p className="text-xs text-foreground/45">{reviews.length} topic{reviews.length === 1 ? '' : 's'}</p>}
      </div>

      {reviews.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-white/8 bg-card/40 px-5 py-4 text-sm text-foreground/55" data-empty="due">
          {hasTopics ? 'Nothing is due right now.' : 'Nothing is due right now. Reviews appear here once Nova has topics on record.'}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {reviews.map((review, i) => (
            <li
              key={review.id}
              data-due={review.topicName}
              className={cn('rounded-2xl border p-4 sm:p-5', i === 0 ? 'border-white/10 bg-card/70' : 'border-white/6 bg-card/40')}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-foreground/50">{review.subjectName}</p>
                  <h3 className="mt-0.5 text-lg font-semibold leading-snug tracking-tight text-foreground">{review.topicName}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-foreground/55">
                    <span>{review.level === 'unverified' ? LEVEL_LABEL.unverified : `${LEVEL_LABEL[review.level]} · ${review.masteryPercent}%`}</span>
                    {review.lastStudiedAt && <><span aria-hidden className="text-foreground/20">·</span><span>Last studied {relativeDay(review.lastStudiedAt)}</span></>}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`Why ${review.topicName} is due`}>
                    {review.reasons.map(reason => (
                      <li key={reason} className="rounded-full border border-white/8 bg-white/4 px-2.5 py-0.5 text-[11px] text-foreground/70">{sentenceCase(reason)}</li>
                    ))}
                  </ul>
                </div>
                {!blocked && (
                  <button
                    type="button"
                    onClick={() => onStart(review)}
                    disabled={starting !== null}
                    className={cn(
                      'inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-60 sm:w-auto',
                      i === 0 ? 'bg-keppel-400 text-keppel-950 hover:bg-keppel-300' : 'border border-white/12 text-foreground/80 hover:border-keppel-400/50 hover:text-keppel-200',
                    )}
                  >
                    {starting === review.id
                      ? <><Loader2 className="size-4 animate-spin" /> Starting…</>
                      : <>Start {minutesLabel(review.reviewMinutes)} review <ArrowRight className="size-4" /></>}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {blocked && reviews.length > 0 && (
        <p className="mt-3 text-xs text-foreground/40">A session is running. Finish or end it to start a review.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  )
}

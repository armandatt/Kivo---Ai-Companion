'use client'

import { ArrowRight, Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeDueReview } from '@repo/api/nova/product/knowledge.types'
import { minutesLabel, relativeDay, sentenceCase } from '../format'
import { BUTTON_PRIMARY, BUTTON_QUIET, ROW, SectionHeading } from '../workspace/ui'
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
      <SectionHeading id="knowledge-due" icon={RotateCcw} aside={reviews.length > 0 ? <span>{reviews.length} topic{reviews.length === 1 ? '' : 's'}</span> : undefined}>
        Due for review
      </SectionHeading>

      {reviews.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/60" data-empty="due">
          {hasTopics ? 'Nothing is due right now.' : 'Nothing is due right now. Reviews appear here once Nova has topics on record.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/6 border-y border-white/8">
          {reviews.map((review, i) => (
            <li key={review.id} data-due={review.topicName}
              className={cn('-mx-2 flex flex-col gap-3 rounded-md px-2 py-3.5 sm:flex-row sm:items-center sm:justify-between', ROW)}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {review.topicName} <span className="font-normal text-foreground/55">· {review.subjectName}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-foreground/60">
                  <span>{review.level === 'unverified' ? LEVEL_LABEL.unverified : `${LEVEL_LABEL[review.level]} · ${review.masteryPercent}%`}</span>
                  {review.lastStudiedAt && <><span aria-hidden className="text-foreground/25">·</span><span>Last studied {relativeDay(review.lastStudiedAt)}</span></>}
                  {review.reasons.length > 0 && <><span aria-hidden className="text-foreground/25">·</span><span aria-label={`Why ${review.topicName} is due`}>{review.reasons.map(sentenceCase).join(', ')}</span></>}
                </p>
              </div>
              {!blocked && (
                <button type="button" onClick={() => onStart(review)} disabled={starting !== null}
                  className={cn(i === 0 ? BUTTON_PRIMARY : BUTTON_QUIET, 'w-full shrink-0 sm:w-auto', i === 0 && 'h-9')}>
                  {starting === review.id
                    ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Starting…</>
                    : <>Start {minutesLabel(review.reviewMinutes)} review <ArrowRight aria-hidden className="size-4" /></>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {blocked && reviews.length > 0 && (
        <p className="mt-3 text-xs text-foreground/55">A session is running. Finish or end it to start a review.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  )
}

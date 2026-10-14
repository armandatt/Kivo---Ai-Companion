'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, Clock, ListOrdered, Loader2, Target } from 'lucide-react'
import type { NovaTodayReady, TodayAction } from '@repo/api/nova/product/today.types'
import { GOALS_HREF } from '@repo/api/nova/product/goals.types'
import { cn } from '@/lib/utils'
import { ACTIVITY_LABEL, URGENCY_LABEL, minutesLabel, sentenceCase } from './format'
import { BUTTON_PRIMARY, BUTTON_QUIET, SectionHeading, SURFACE, TEXT_LINK } from './workspace/ui'

const URGENCY_TONE: Record<TodayAction['urgency'], string> = {
  critical: 'text-amber-300',
  high:     'text-keppel-300',
  normal:   'text-foreground/60',
  optional: 'text-foreground/50',
}

// What set the length of today's plan, in a few words. The Planner explains it
// in full; these only name the rule the server reported.
const BASIS_LABEL: Record<NovaTodayReady['plan']['budgetBasis'], string> = {
  // Not "your usual time": with none stated, the length is assumed (the plan's
  // assumptions say so), so this names the setting, as setup does.
  preferred:   'a normal day',
  stated_time: 'the time you gave',
  recovery:    'cut back after missed days',
  reentry:     'first day back',
  no_pressure: 'kept light',
}

// Today's plan as the planner ordered it: the recommendation, then the
// blocks after it. Numbered in that order; nothing here reorders, adds or
// drops a block. The first block is the one to do now, opened out with its
// reasons and its Start button; the rest are a line each. Today carries the
// first few blocks of the day; when the day has more, the count says so and
// the Planner has the rest.
export function TodayPlan({ recommendation, alternatives, blockCount, plan, why, onStart, starting, error, disabled }: {
  recommendation: TodayAction | null
  alternatives:   TodayAction[]
  blockCount:     number
  plan:           Pick<NovaTodayReady['plan'], 'totalMinutesToday' | 'budgetMinutes' | 'budgetBasis'>
  // Further reasons from Nova's state (constraints, assumptions), under "Why this?".
  why:            string[]
  // Absent while a session runs: one session at a time.
  onStart?:       (action: TodayAction) => void
  // The topic of the start in flight, if any.
  starting?:      string | null
  error?:         string | null
  disabled?:      boolean
}) {
  const blocks = recommendation ? [recommendation, ...alternatives] : alternatives
  if (blocks.length === 0) return null
  const more = blockCount > blocks.length
  const now  = recommendation !== null && onStart !== undefined

  return (
    <section aria-labelledby="today-plan" data-section="today-plan">
      <SectionHeading id="today-plan" icon={ListOrdered} aside={
        <>
          {more && <span>{blocks.length} of {blockCount} blocks</span>}
          <Link href="/planner" className={TEXT_LINK}>{more ? 'The rest on the Planner' : 'Planner'} <ArrowRight aria-hidden className="size-3" /></Link>
        </>
      }>
        Today&apos;s plan
      </SectionHeading>

      <Budget blocks={blocks} plan={plan} />

      <ol className="mt-4">
        {blocks.map((action, i) => {
          const isNow = i === 0 && now
          const last  = i === blocks.length - 1
          return (
            <li key={`${action.subjectName}:${action.topicName}`} className="relative flex gap-4">
              {/* The day's thread: a numbered stop for each block */}
              <div aria-hidden className="relative flex w-7 shrink-0 flex-col items-center">
                <span className={cn(
                  'z-10 mt-4 flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                  isNow ? 'bg-keppel-400 text-keppel-950' : 'border border-white/15 bg-background text-foreground/60',
                )}>{i + 1}</span>
                {!last && <span className="absolute bottom-0 top-11 w-px bg-white/10" />}
              </div>
              <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-3')}>
                {isNow ? (
                  <NowBlock action={action} why={why} onStart={() => onStart!(action)} starting={starting === action.topicName} error={error ?? null} disabled={disabled} />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg px-1 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground/90">
                        <span className="sr-only">Block {i + 1}: </span>{action.topicName}
                      </p>
                      <BlockMeta action={action} />
                      {action.reasons.length > 0 && (
                        <p className="mt-1.5 text-xs leading-relaxed text-foreground/55">{action.reasons.map(sentenceCase).join(' · ')}</p>
                      )}
                    </div>
                    {onStart && (
                      <button type="button" disabled={disabled} onClick={() => onStart(action)} className={BUTTON_QUIET}>
                        {starting === action.topicName ? <><Loader2 aria-hidden className="size-3.5 animate-spin" /> Starting…</> : now ? 'Start instead' : 'Start'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function BlockMeta({ action }: { action: TodayAction }) {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-foreground/60">
      <span>{action.subjectName}</span>
      <span aria-hidden className="text-foreground/25">·</span>
      <span className="inline-flex items-center gap-1"><Clock aria-hidden className="size-3" />{minutesLabel(action.durationMinutes)}</span>
      <span aria-hidden className="text-foreground/25">·</span>
      <span>{ACTIVITY_LABEL[action.activityType]}</span>
      {(action.urgency === 'critical' || action.urgency === 'high') && (
        <><span aria-hidden className="text-foreground/25">·</span><span className={cn('font-medium', URGENCY_TONE[action.urgency])}>{URGENCY_LABEL[action.urgency]}</span></>
      )}
    </p>
  )
}

// The block to do now: what it is, why, and the one button that starts it.
function NowBlock({ action, why, onStart, starting, error, disabled }: {
  action: TodayAction; why: string[]; onStart: () => void; starting: boolean; error: string | null; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const reasons = [...action.reasons.map(sentenceCase), ...why]
  const hasWhy  = action.rationale.length > 0 || reasons.length > 0

  return (
    <div className={cn(SURFACE, 'border-keppel-400/25 p-4 sm:p-5')} data-block="now">
      <p className="flex flex-wrap items-center gap-x-2 text-xs">
        <span className="font-semibold text-keppel-300">Now</span>
        <span aria-hidden className="text-foreground/25">·</span>
        <span className={cn('font-medium', URGENCY_TONE[action.urgency])}>{URGENCY_LABEL[action.urgency]}</span>
      </p>
      <h3 id="nova-next-action" className="mt-2 text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
        <span className="sr-only">Block 1: </span>{action.topicName}
      </h3>
      <BlockMeta action={action} />

      {action.reasons.length > 0 && (
        <ul aria-label="Why Nova chose this" className="mt-3 flex flex-wrap gap-1.5">
          {action.reasons.map(reason => (
            <li key={reason} className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-foreground/75">{sentenceCase(reason)}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onStart} disabled={starting || disabled} className={cn(BUTTON_PRIMARY, 'w-full sm:w-auto')}>
          {starting
            ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Starting…</>
            : <>Start {minutesLabel(action.durationMinutes)} session <ArrowRight aria-hidden className="size-4" /></>}
        </button>
        {hasWhy && (
          <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="nova-why"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-foreground/65 transition-colors hover:bg-white/5 hover:text-foreground">
            Why this? <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      {hasWhy && open && (
        <div id="nova-why" className="mt-4 border-t border-white/8 pt-4">
          {action.rationale && <p className="max-w-prose text-sm leading-relaxed text-foreground/80">{action.rationale}</p>}
          {reasons.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-foreground/65">
              {reasons.map(line => (
                <li key={line} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-keppel-400/70" />{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// The day's minutes as the server reported them: each block's length against
// the day's budget, and what set the budget. Nothing is estimated.
function Budget({ blocks, plan }: { blocks: TodayAction[]; plan: Pick<NovaTodayReady['plan'], 'totalMinutesToday' | 'budgetMinutes' | 'budgetBasis'> }) {
  if (plan.budgetMinutes <= 0) return null
  return (
    <div className="mt-3" data-section="plan-budget">
      <div aria-hidden className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/6">
        {blocks.map((b, i) => (
          <span key={`${b.subjectName}:${b.topicName}`} className={i === 0 ? 'bg-keppel-400' : 'bg-keppel-400/45'}
            style={{ width: `${Math.min(100, (b.durationMinutes / plan.budgetMinutes) * 100)}%` }} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-foreground/60">
        {minutesLabel(plan.totalMinutesToday)} planned of {minutesLabel(plan.budgetMinutes)}, {BASIS_LABEL[plan.budgetBasis]}
      </p>
    </div>
  )
}

// What the learner said they are working toward. With nothing said, the way
// to say it: no goal is ever shown that they did not give.
export function WorkingToward({ goals }: { goals: string[] }) {
  return (
    <section aria-labelledby="working-toward">
      <SectionHeading id="working-toward" icon={Target} aside={goals.length > 0 ? <Link href={GOALS_HREF} className={TEXT_LINK}>Edit</Link> : undefined}>
        Working toward
      </SectionHeading>
      {goals.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {goals.map(goal => (
            <li key={goal} className="flex gap-2.5 text-sm leading-relaxed text-foreground/85">
              <span aria-hidden className="mt-[0.55rem] size-1.5 shrink-0 rounded-full border border-keppel-400/70" />{goal}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-foreground/60" data-unknown="no_goals">
          Nothing yet. <Link href={GOALS_HREF} className="font-medium text-keppel-300 hover:text-keppel-200">Add what you&apos;re working toward</Link>
        </p>
      )}
    </section>
  )
}

export function AccountingFor({ constraints }: { constraints: NovaTodayReady['constraints'] }) {
  if (constraints.length === 0) return null
  return (
    <section aria-labelledby="accounting-for" className="mt-5 border-t border-white/8 pt-4">
      <h3 id="accounting-for" className="text-xs font-medium text-foreground/60">Nova is accounting for</h3>
      <ul className="mt-2 space-y-1.5">
        {constraints.map(c => (
          <li key={`${c.category}:${c.description}`} className="text-sm leading-relaxed text-foreground/80">{c.description}</li>
        ))}
      </ul>
    </section>
  )
}

'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, Clock, ListOrdered, Loader2, Target } from 'lucide-react'
import type { NovaTodayReady, TodayAction } from '@repo/api/nova/product/today.types'
import { GOALS_HREF } from '@repo/api/nova/product/goals.types'
import { cn } from '@/lib/utils'
import { ACTIVITY_LABEL, URGENCY_LABEL, minutesLabel, sentenceCase } from './format'
import { BUTTON_PRIMARY, BUTTON_QUIET, SectionHeading, SURFACE_RAISED, TEXT_LINK } from './workspace/ui'
import { subjectColor, toneStyle } from './subject-color'
import type { TopicRecord } from './today-links'
import { RecordLine } from './topic-record'

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
// drops a block. The first block is the one to do now: opened out with its
// reasons and its Start button, here or (with `leadShown`) in Today's hero,
// when this lists only what comes after it. Each stop carries its subject's
// colour and when it starts, counted from the blocks before it. Today
// carries the first few blocks of the day; when the day has more, the count
// says so and the Planner has the rest.
export function TodayPlan({ recommendation, alternatives, blockCount, plan, why, onStart, starting, error, disabled, recordOf, leadShown = false, controls }: {
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
  // What is on record for a block's topic, when the Knowledge Map has it.
  recordOf?:      (action: TodayAction) => TopicRecord | null
  // The block to do now is already open in the hero above.
  leadShown?:     boolean
  // Beside the day's bar: how long the learner has.
  controls?:      ReactNode
}) {
  const blocks = recommendation ? [recommendation, ...alternatives] : alternatives
  if (blocks.length === 0) return null
  const more = blockCount > blocks.length
  const now  = recommendation !== null && onStart !== undefined
  const skipLead = now && leadShown
  if (skipLead && blocks.length === 1 && !more) return null
  // Minutes into the plan at which each block starts.
  const startsAt = blocks.map((_, i) => blocks.slice(0, i).reduce((sum, b) => sum + b.durationMinutes, 0))

  return (
    <section aria-labelledby="today-plan" data-section="today-plan">
      <SectionHeading id="today-plan" icon={ListOrdered} aside={
        <>
          {more && <span>{blocks.length} of {blockCount} blocks</span>}
          <Link href="/planner" className={TEXT_LINK}>{more ? 'The rest on the Planner' : 'Planner'} <ArrowRight aria-hidden className="size-3" /></Link>
        </>
      }>
        {skipLead ? 'Then' : 'Today’s plan'}
      </SectionHeading>

      {!leadShown && (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <DayFlow blocks={blocks} plan={plan} nowFirst={now} className="min-w-0 flex-1" />
          {controls && <div className="shrink-0">{controls}</div>}
        </div>
      )}

      {skipLead ? null : blocks[0] && now && (
        <div className="mt-4">
          <NowBlock action={blocks[0]} why={why} record={recordOf?.(blocks[0]) ?? null} onStart={() => onStart!(blocks[0]!)} starting={starting === blocks[0].topicName} error={error ?? null} disabled={disabled} />
        </div>
      )}
      {blocks.length > (now ? 1 : 0) && <ol className="mt-3 divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8 bg-card/40">
        {blocks.map((action, i) => {
          if (i === 0 && now) return null
          return (
            <li key={`${action.subjectName}:${action.topicName}`} className="subject-tone group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025]" style={toneStyle(action.subjectName)}>
              <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--sc-soft)] text-[11px] font-semibold tabular-nums text-[var(--sc-ink)]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-[14px] font-medium tracking-tight text-foreground/95"><span className="sr-only">Block {i + 1}: </span>{action.topicName}</p>
                  <p className="text-[11px] tabular-nums text-foreground/45">{startsAt[i] === 0 ? 'First' : `after ${minutesLabel(startsAt[i])}`}</p>
                </div>
                <BlockMeta action={action} />
                <RecordLine record={recordOf?.(action) ?? null} />
                {action.reasons.length > 0 && (
                  <p className="mt-1 text-xs leading-relaxed text-foreground/50">{action.reasons.map(sentenceCase).join(' · ')}</p>
                )}
              </div>
              {onStart && (
                <button type="button" disabled={disabled} onClick={() => onStart(action)} className={cn(BUTTON_QUIET, 'shrink-0 opacity-80 group-hover:border-[var(--sc-edge)] group-hover:opacity-100')}>
                  {starting === action.topicName ? <><Loader2 aria-hidden className="size-3.5 animate-spin" /> Starting…</> : now ? 'Start instead' : 'Start'}
                </button>
              )}
            </li>
          )
        })}
      </ol>}
    </section>
  )
}

function BlockMeta({ action }: { action: TodayAction }) {
  const color = subjectColor(action.subjectName)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-foreground/60">
      <span className="subject-tone inline-flex items-center gap-1.5 rounded-full bg-[var(--sc-soft)] py-0.5 pl-1.5 pr-2 font-medium text-[var(--sc-ink)]" style={toneStyle(action.subjectName)}>
        <span aria-hidden className={cn('size-1.5 rounded-full', color.dot)} />{action.subjectName}
      </span>
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
// A raised card washed in its subject's colour; on Today it floats in the hero.
export function NowBlock({ action, why, record, onStart, starting, error, disabled }: {
  action: TodayAction; why: string[]; record: TopicRecord | null; onStart: () => void; starting: boolean; error: string | null; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const reasons = [...action.reasons.map(sentenceCase), ...why]
  const hasWhy  = action.rationale.length > 0 || reasons.length > 0

  return (
    <div className={cn(SURFACE_RAISED, 'subject-tone relative overflow-hidden')} style={toneStyle(action.subjectName)} data-block="now">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-[var(--sc-soft)] to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-[var(--sc-soft)] blur-2xl" />
      <div className="relative p-5 sm:p-6">
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--sc)] opacity-50" />
            <span className="relative inline-flex size-2 rounded-full bg-[var(--sc)]" />
          </span>
          <span className="text-[var(--sc-ink)]">Next up</span>
          <span aria-hidden className="text-foreground/25">·</span>
          <span className={cn(URGENCY_TONE[action.urgency])}>{URGENCY_LABEL[action.urgency]}</span>
        </p>
        <h3 id="nova-next-action" className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.75rem]">
          <span className="sr-only">Block 1: </span>{action.topicName}
        </h3>
        <BlockMeta action={action} />
        <RecordLine record={record} className="mt-2" />

        {action.reasons.length > 0 && (
          <ul aria-label="Why Nova chose this" className="mt-4 flex flex-wrap gap-1.5">
            {action.reasons.map(reason => (
              <li key={reason} className="rounded-full border border-[var(--sc-edge)] bg-[var(--sc-faint)] px-2.5 py-0.5 text-xs text-foreground/80">{sentenceCase(reason)}</li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onStart} disabled={starting || disabled} className={cn(BUTTON_PRIMARY, 'h-11 w-full text-[15px] sm:w-auto sm:px-5')}>
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
          <div id="nova-why" className="nova-rise mt-4 border-t border-white/8 pt-4">
            {action.rationale && <p className="max-w-prose text-sm leading-relaxed text-foreground/80">{action.rationale}</p>}
            {reasons.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-foreground/65">
                {reasons.map(line => (
                  <li key={line} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[var(--sc)]" />{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The day as one slim bar: each block in order, as long as its minutes and
// in its subject's colour, against the day's budget as the server reported
// it, with what is left of the budget drawn empty. Nothing is estimated. The
// names are in the plan's list; the bar only shows the shape of the day.
export function DayFlow({ blocks, plan, nowFirst, className }: {
  blocks:    TodayAction[]
  plan:      Pick<NovaTodayReady['plan'], 'totalMinutesToday' | 'budgetMinutes' | 'budgetBasis'>
  // The first block is the one to do now.
  nowFirst:  boolean
  className?: string
}) {
  if (plan.budgetMinutes <= 0 || blocks.length === 0) return null
  const planned = blocks.reduce((sum, b) => sum + b.durationMinutes, 0)
  const spare   = Math.max(0, plan.budgetMinutes - planned)
  return (
    <div className={className} data-section="plan-budget">
      <ol aria-label="Today's blocks in order" className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {blocks.map((b, i) => (
          <li key={`${b.subjectName}:${b.topicName}`} title={`${b.topicName} · ${b.subjectName} · ${minutesLabel(b.durationMinutes)}`}
            className={cn('subject-tone min-w-1.5 bg-[var(--sc)] transition-[flex-grow] duration-500', !(i === 0 && nowFirst) && 'opacity-55')}
            style={{ ...toneStyle(b.subjectName), flexGrow: b.durationMinutes, flexBasis: 0 }}>
            <span className="sr-only">{b.topicName}, {minutesLabel(b.durationMinutes)}{i === 0 && nowFirst ? ', now' : ''}</span>
          </li>
        ))}
        {spare > 0 && (
          <li className="min-w-1.5 bg-white/8" style={{ flexGrow: spare, flexBasis: 0 }}>
            <span className="sr-only">{minutesLabel(spare)} of the day not planned</span>
          </li>
        )}
      </ol>
      <p className="mt-2 text-xs text-foreground/50">
        <span className="font-medium text-foreground/75">{minutesLabel(plan.totalMinutesToday)}</span> planned of {minutesLabel(plan.budgetMinutes)} · {BASIS_LABEL[plan.budgetBasis]}
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

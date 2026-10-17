'use client'

import { useState } from 'react'
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
export function TodayPlan({ recommendation, alternatives, blockCount, plan, why, onStart, starting, error, disabled, recordOf, leadShown = false }: {
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

      {!leadShown && <DayFlow blocks={blocks} plan={plan} nowFirst={now} className="mt-3" />}

      <ol className="mt-4">
        {blocks.map((action, i) => {
          if (i === 0 && skipLead) return null
          const isNow = i === 0 && now
          const last  = i === blocks.length - 1
          const next  = blocks[i + 1]
          return (
            <li key={`${action.subjectName}:${action.topicName}`} className="subject-tone relative flex gap-3 sm:gap-4" style={toneStyle(action.subjectName)}>
              {/* The day's thread: a stop in the block's colour, and a line
                  that turns into the next block's colour */}
              <div aria-hidden className="relative flex w-8 shrink-0 flex-col items-center">
                <span className={cn(
                  'z-10 mt-4 flex size-8 items-center justify-center rounded-full text-xs font-bold tabular-nums transition-transform',
                  isNow ? 'bg-[var(--sc)] text-[oklch(20%_0.03_var(--sh))] shadow-soft' : 'border-2 border-[var(--sc)] bg-card text-[var(--sc-ink)]',
                )}>{i + 1}</span>
                {!last && (
                  <span className="absolute bottom-0 top-12 w-0.5 rounded-full opacity-60"
                    style={{ background: `linear-gradient(var(--sc), oklch(var(--tone-l) var(--tone-c) ${subjectColor(next?.subjectName).hue}))` }} />
                )}
              </div>
              <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-3')}>
                {isNow ? (
                  <NowBlock action={action} why={why} record={recordOf?.(action) ?? null} onStart={() => onStart!(action)} starting={starting === action.topicName} error={error ?? null} disabled={disabled} />
                ) : (
                  <div className="group relative mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 overflow-hidden rounded-xl border border-white/6 bg-card/60 py-3 pl-4 pr-3 transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[var(--sc-edge)] hover:shadow-soft focus-within:border-[var(--sc-edge)]">
                    <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--sc)] opacity-70" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium tabular-nums text-foreground/50">
                        {startsAt[i] === 0 ? 'First' : `After ${minutesLabel(startsAt[i])}`}
                      </p>
                      <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground/95">
                        <span className="sr-only">Block {i + 1}: </span>{action.topicName}
                      </p>
                      <BlockMeta action={action} />
                      <RecordLine record={recordOf?.(action) ?? null} />
                      {action.reasons.length > 0 && (
                        <p className="mt-1.5 text-xs leading-relaxed text-foreground/55">{action.reasons.map(sentenceCase).join(' · ')}</p>
                      )}
                    </div>
                    {onStart && (
                      <button type="button" disabled={disabled} onClick={() => onStart(action)} className={cn(BUTTON_QUIET, 'group-hover:border-[var(--sc-edge)]')}>
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

// The day as a strip: each block in order, as wide as its minutes and in its
// subject's colour, against the day's budget as the server reported it, with
// what is left of the budget drawn empty. Nothing is estimated.
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="font-semibold text-foreground/75">Today&apos;s flow</span>
        <span className="text-foreground/55">{minutesLabel(plan.totalMinutesToday)} planned of {minutesLabel(plan.budgetMinutes)}, {BASIS_LABEL[plan.budgetBasis]}</span>
      </div>
      <ol aria-label="Today's blocks in order" className="mt-2 flex h-12 gap-1">
        {blocks.map((b, i) => {
          const lead = i === 0 && nowFirst
          return (
            <li key={`${b.subjectName}:${b.topicName}`} title={`${b.topicName} · ${b.subjectName} · ${minutesLabel(b.durationMinutes)}`}
              className={cn('subject-tone relative min-w-6 overflow-hidden rounded-lg transition-[flex-grow] duration-500',
                lead ? 'bg-[var(--sc)] text-[oklch(20%_0.03_var(--sh))] shadow-soft' : 'border border-[var(--sc-edge)] bg-[var(--sc-soft)] text-[var(--sc-ink)]')}
              style={{ ...toneStyle(b.subjectName), flexGrow: b.durationMinutes, flexBasis: 0 }}>
              <span className="block truncate px-2 pt-1.5 text-[11px] font-semibold leading-tight">{b.topicName}</span>
              <span className="block truncate px-2 text-[10px] font-medium leading-tight opacity-75">{lead ? 'Now · ' : ''}{minutesLabel(b.durationMinutes)}</span>
            </li>
          )
        })}
        {spare > 0 && (
          <li className="min-w-6 rounded-lg border border-dashed border-white/15" style={{ flexGrow: spare, flexBasis: 0 }}>
            <span className="sr-only">{minutesLabel(spare)} of the day not planned</span>
          </li>
        )}
      </ol>
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

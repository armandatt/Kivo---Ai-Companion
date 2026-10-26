'use client'

// Today at a glance, beside the next thing to do: the day as a strip (each
// open item as wide as its time today and in its subject's colour, what is
// done drawn first, what is left of the day's time drawn empty), how far
// along it is, when it would end, and the learner's own control for the
// time they have left. Built like Today's earlier DayFlow strip. Every
// number is the flow's; nothing is estimated except where it says so.

import { useState } from 'react'
import { CheckCircle2, Hourglass } from 'lucide-react'
import type { FlowOp, NovaDayView } from '@repo/api/nova/product/day-flow.types'
import { clockLabel, scheduleOf, SCHEDULE_FALLBACK_MINUTES } from '@repo/api/nova/product/day-flow-rules'
import { cn } from '@/lib/utils'
import { toneStyle } from '../subject-color'

const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

function Ring({ done, total }: { done: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r
  const share = total > 0 ? done / total : 0
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0 -rotate-90" aria-hidden>
      <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-white/8" />
      <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-nova transition-[stroke-dashoffset] duration-700" strokeDasharray={c} strokeDashoffset={c * (1 - share)} />
    </svg>
  )
}

export function DayGlance({ flow, busy, onOps, onAskNova }: {
  flow: NovaDayView
  busy: boolean
  onOps: (ops: FlowOp[]) => void
  onAskNova: () => void
}) {
  const [left, setLeft] = useState('')
  const open = flow.items.filter(i => i.status === 'planned' || i.status === 'active')
  const done = flow.items.filter(i => i.status === 'done')
  const later = flow.items.filter(i => i.status === 'later')
  const total = open.length + done.length
  const doneMinutes = done.reduce((s, i) => s + (i.spentMinutes ?? i.minutes ?? 0), 0)
  const budget = flow.budgetMinutes ?? 0
  const spare = Math.max(0, budget - flow.plannedMinutes)
  const over = budget > 0 ? flow.plannedMinutes - budget : 0
  const blocks = scheduleOf(flow.items, Math.ceil(flow.nowMinutes / 5) * 5)
  const end = blocks.at(-1)?.end ?? null
  const estimated = open.some(i => !i.minutes)
  const n = Number(left)
  const leftOk = Number.isInteger(n) && n > 0 && n <= 1440

  return (
    <div className="flex min-w-0 flex-col gap-5" data-day-glance>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Ring done={done.length} total={total} />
          <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">{done.length}<span className="text-foreground/40">/{total}</span></span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground" data-today-progress>{total === 0 ? 'Nothing in today yet' : done.length === total ? 'All done for today' : `${done.length} of ${total} done`}</p>
          <p className="mt-0.5 text-xs text-foreground/60">
            {minutesLabel(flow.plannedMinutes)} planned{budget ? ` of ${minutesLabel(budget)}` : ''}
            {end !== null && open.length > 0 && <> · ends about {clockLabel(end % (24 * 60))}{estimated ? '*' : ''}</>}
          </p>
        </div>
      </div>

      {(open.length > 0 || doneMinutes > 0) && (
        <div>
          <ol aria-label="Today's flow by time" className="flex h-11 gap-1" data-day-strip>
            {doneMinutes > 0 && (
              <li title={`Done today · ${minutesLabel(doneMinutes)}`} className="relative min-w-9 overflow-hidden rounded-lg border border-action/40 bg-action-soft text-action-ink" style={{ flexGrow: doneMinutes, flexBasis: 0 }}>
                <span className="flex items-center gap-1 truncate px-2 pt-1.5 text-[11px] font-semibold leading-tight"><CheckCircle2 aria-hidden className="size-3 shrink-0" />Done</span>
                <span className="block truncate px-2 text-[10px] font-medium leading-tight opacity-75">{minutesLabel(doneMinutes)}</span>
              </li>
            )}
            {open.map((i, k) => {
              const m = i.minutes ?? SCHEDULE_FALLBACK_MINUTES
              const lead = k === 0
              return (
                <li key={i.id} title={`${i.title}${i.subjectName ? ` · ${i.subjectName}` : ''} · ${i.minutes ? minutesLabel(i.minutes) : 'no time set'}`}
                  className={cn('subject-tone relative min-w-5 overflow-hidden rounded-lg transition-[flex-grow] duration-500',
                    lead ? 'bg-[var(--sc)] text-[oklch(20%_0.03_var(--sh))] shadow-soft' : 'border border-[var(--sc-edge)] bg-[var(--sc-soft)] text-[var(--sc-ink)]',
                    !i.minutes && 'border-dashed')}
                  style={{ ...toneStyle(i.subjectName), flexGrow: m, flexBasis: 0 }}>
                  <span className="block truncate px-2 pt-1.5 text-[11px] font-semibold leading-tight">{i.title}</span>
                  <span className="block truncate px-2 text-[10px] font-medium leading-tight opacity-75">{lead ? 'Next · ' : ''}{i.minutes ? minutesLabel(i.minutes) : '—'}</span>
                </li>
              )
            })}
            {spare > 0 && (
              <li className="min-w-5 rounded-lg border border-dashed border-white/15" style={{ flexGrow: spare, flexBasis: 0 }}>
                <span className="sr-only">{minutesLabel(spare)} of the day not planned</span>
              </li>
            )}
          </ol>
          {estimated && <p className="mt-1.5 text-[11px] text-foreground/50">*Items with no time are counted as {SCHEDULE_FALLBACK_MINUTES} min for the end time.</p>}
          {later.length > 0 && <p className="mt-1.5 text-[11px] text-foreground/55">{later.length} more if there’s time</p>}
        </div>
      )}

      {over > 0 && (
        <div className="rounded-xl border border-[color:var(--sem-warning,#e6b450)]/30 bg-[color:var(--sem-warning,#e6b450)]/[0.06] px-3.5 py-3 text-sm text-foreground/80" data-flow-over>
          That’s {minutesLabel(over)} more than your planner gives today. Nothing has been dropped.
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <button type="button" disabled={busy} onClick={() => onOps([{ op: 'fit', minutes: budget }])} className="rounded-lg border border-white/12 px-2.5 py-1 hover:bg-white/5" data-fit-budget>Fit to {minutesLabel(budget)}</button>
            <button type="button" onClick={onAskNova} className="rounded-lg px-2.5 py-1 text-foreground/60 hover:text-foreground">Ask Nova what to move</button>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <form className="flex flex-wrap items-center gap-2 text-xs text-foreground/60" onSubmit={e => { e.preventDefault(); if (leftOk) { onOps([{ op: 'fit', minutes: n }]); setLeft('') } }} data-fit-form>
          <Hourglass aria-hidden className="size-3.5" />
          <label htmlFor="fit-minutes">Time left today?</label>
          <input id="fit-minutes" inputMode="numeric" value={left} onChange={e => setLeft(e.target.value.slice(0, 4))} placeholder="min"
            className="h-7 w-16 rounded-md border border-white/10 bg-transparent px-2 text-foreground focus:border-nova/60 focus:outline-none" />
          <button type="submit" disabled={!leftOk || busy} className="rounded-md border border-white/12 px-2 py-1 text-foreground/80 hover:bg-white/5 disabled:opacity-40">Fit the rest</button>
          <span className="basis-full text-[11px] text-foreground/50">Keeps your order; what doesn’t fit moves to “If there’s time”.</span>
        </form>
      )}
    </div>
  )
}

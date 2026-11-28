'use client'

// The planning playground: the centre of Today, where the learner's day takes
// shape. It draws one of four real states and nothing else:
//
//   empty      no flow saved and nothing proposed: an invitation to plan, with
//              an example flow marked as an example (never a record).
//   thinking   Nova's request is in flight (the panel says so too); the canvas
//              edge shimmers. Nothing is drawn as decided.
//   proposal   a PendingChange from Nova, drawn as the day would stand: added,
//              moved and changed items marked, what would leave the day shown
//              struck, the minutes against the day. "Not applied" until the
//              server says it is. Apply / Choose changes / Change something /
//              Discard.
//   saved      the learner's own flow (list or schedule), edited directly:
//              their own drag, tick or time is their authorisation.
//
// Moves are animated from where an item was to where it is (FLIP), new items
// fade in in order, and only the items a change touched move. Nothing runs
// under reduced motion.

import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Check, Hourglass, LayoutList, Loader2, MessageSquareText, Pencil, Plus, RotateCcw, Sparkles, X } from 'lucide-react'
import type { FlowItemView, FlowOp, NovaDayView, PendingChange } from '@repo/api/nova/product/day-flow.types'
import { cn } from '@/lib/utils'
import { toneStyle } from '../subject-color'
import { FlowList, FlowSchedule } from './flow-list'

export type ProposalState = 'open' | 'applying' | 'applied' | 'declined' | 'replaced' | 'stale' | 'failed'
export type OpenProposal = { pending: PendingChange; state: ProposalState; note?: string }

const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Items keep their place on screen across a change and glide to the new one.
function useFlip(container: React.RefObject<HTMLElement | null>, key: unknown) {
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const now = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => now.set(el.dataset.flip!, el.getBoundingClientRect().top))
    if (!reduced()) {
      root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
        const before = last.current.get(el.dataset.flip!)
        const after = now.get(el.dataset.flip!)
        if (before === undefined || after === undefined || Math.abs(before - after) < 2) return
        el.animate([{ transform: `translateY(${before - after}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
      })
    }
    last.current = now
  }, [container, key])
}

const EXAMPLE = [
  { title: 'Learn one new concept properly', meta: 'A topic from your map · 45 min', hue: 237 },
  { title: 'Practice questions on it', meta: 'Same subject · 25 min', hue: 162 },
  { title: 'Light revision before bed', meta: 'Something you studied last week · 15 min', hue: 293 },
]

// Lines that rotate under the studio's picture: what Nova's draft rests on
// when there is one (its own reasons), else what the two buttons do. Text
// only; one line at a time; still under reduced motion.
function RotatingLine({ lines }: { lines: string[] }) {
  const [n, setN] = useState(0)
  useLayoutEffect(() => {
    if (lines.length < 2 || reduced()) return
    const t = window.setInterval(() => setN(x => (x + 1) % lines.length), 3600)
    return () => window.clearInterval(t)
  }, [lines.length])
  const line = lines[n % Math.max(1, lines.length)] ?? ''
  return (
    <p key={n} className="nova-rise min-h-[2.75rem] text-[13px] leading-relaxed text-foreground/60" aria-live="off">{line}</p>
  )
}

const ABOUT_LINES = [
  'Plan with Nova asks what matters today, then shapes the day with you.',
  'Propose a plan builds one from your tasks, deadlines, reviews and map.',
  'Every block fits the time you have. Nothing is added until you approve.',
]

// The empty studio (bug batch 28 Nov, item 12; owner 28 Nov: two buttons and
// nothing else to press). Plan with Nova talks it through; Propose a plan
// opens Nova's plan (at once when it is already prepared). The right side is
// a picture, not controls: Nova's draft drawn as drifting cards when the
// record holds one (else an example, said to be one), with the reasons
// rotating beneath.
function Empty({ onStart, onPropose, thinking, draft, ready }: {
  onStart: (text: string) => void; onPropose: () => void; starters: string[]; thinking: boolean
  draft: NovaDayView['draft']; onTakeDraft: () => void; busy: boolean; ready: string | null
}) {
  const shown = draft && draft.items.length ? draft.items.filter(i => i.status !== 'later').slice(0, 4) : null
  const cards = shown
    ? shown.map((it, i) => ({ key: it.id, title: it.title, meta: [it.subjectName, it.minutes ? `${it.minutes} min` : null].filter(Boolean).join(' · '), hue: [237, 162, 293, 30][i % 4]! }))
    : EXAMPLE.map(e => ({ key: e.title, ...e }))
  const lines = shown && draft!.reasons.length ? draft!.reasons.flatMap(r => r.split('. ').map(x => x.trim()).filter(Boolean).map(x => (x.endsWith('.') ? x : `${x}.`))) : ABOUT_LINES
  return (
    <div className="grid gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:py-16" data-playground-empty>
      <div className="nova-rise max-w-md">
        <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-nova-ink"><Sparkles aria-hidden className="size-3.5" /> Today’s planning studio</p>
        <h2 className="mt-4 text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[2.5rem]">Let’s design your day.</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-foreground/70">Talk it through with Nova, or let Nova propose a plan. Nothing changes until you approve it.</p>
        <div className="mt-7 grid gap-2 sm:grid-cols-2" data-plan-modes>
          <button type="button" disabled={thinking} onClick={() => onStart('Plan my day with me')}
            className="flex flex-col items-start gap-0.5 rounded-xl bg-action px-4 py-3 text-left text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] transition-colors hover:bg-action-hover disabled:opacity-50" data-plan-with-nova>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><MessageSquareText aria-hidden className="size-4" /> Plan with Nova</span>
            <span className="text-xs opacity-80">Talk it through</span>
          </button>
          <button type="button" disabled={thinking} onClick={onPropose}
            className="flex flex-col items-start gap-0.5 rounded-xl border border-nova/40 bg-nova/[0.08] px-4 py-3 text-left text-foreground transition-colors hover:bg-nova/15 disabled:opacity-50" data-propose-plan>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Sparkles aria-hidden className="size-4 text-nova-ink" /> Propose a plan</span>
            {ready
              ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-nova-ink" data-plan-ready><span aria-hidden className="studio-breathe size-1.5 rounded-full bg-current" /> Ready · {ready}</span>
              : <span className="text-xs text-foreground/60">From your record</span>}
          </button>
        </div>
      </div>
      <div aria-hidden className="relative mx-auto w-full max-w-sm" data-studio-picture>
        <div className="pointer-events-none absolute -inset-8 rounded-[2rem] bg-[radial-gradient(closest-side,rgb(var(--nova-rgb,94_200_180)/0.10),transparent)]" />
        <p className="relative mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/45">{shown ? 'Nova’s draft · from your record' : 'Example · not your plan'}</p>
        <div className="relative space-y-2.5">
          {cards.map((c, i) => (
            <div key={c.key} className="studio-drift subject-tone flex items-center gap-3 rounded-2xl border border-white/8 bg-background/40 px-4 py-3 backdrop-blur-sm" style={{ ['--sh' as string]: c.hue, ['--i' as string]: i }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-[var(--sc-edge)] text-[11px] font-semibold text-[var(--sc-ink)]">{i + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground/85">{c.title}</p>
                {c.meta && <p className="truncate text-[11px] text-foreground/45">{c.meta}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="relative mt-4"><RotatingLine lines={lines} /></div>
      </div>
    </div>
  )
}

// While Nova composes a plan that was not ready yet (item 12): placeholder
// cards shimmer where the plan will land. Rarely seen: the plan is usually
// prepared before the learner asks.
function Composing() {
  return (
    <div className="px-4 py-5 sm:px-7 sm:py-7" role="status" aria-live="polite" data-plan-composing>
      <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-nova-ink"><Sparkles aria-hidden className="size-3.5 animate-pulse" /> Nova is composing your day</p>
      <p className="mt-1 text-sm text-foreground/60">Reading your deadlines, reviews, map and goals…</p>
      <ol className="mt-5 space-y-2" aria-hidden>
        {[0, 1, 2, 3].map(i => <li key={i} className="plan-compose h-[62px] rounded-2xl border border-white/8" style={{ ['--i' as string]: i, opacity: 1 - i * 0.18 }} />)}
      </ol>
    </div>
  )
}

function Proposal({ proposal, flow, busy, onApply, onDiscard, onChange }: {
  proposal: OpenProposal; flow: NovaDayView; busy: boolean
  onApply: (keep: number[] | null) => void
  onDiscard: () => void
  onChange: () => void
}) {
  const p = proposal.pending
  const [choosing, setChoosing] = useState(false)
  const [keep, setKeep] = useState<boolean[]>(() => p.ops.map(() => true))
  const box = useRef<HTMLOListElement>(null)
  useFlip(box, p.id)
  const items = p.items.filter(i => i.status !== 'later')
  const later = p.items.filter(i => i.status === 'later')
  const kept = keep.flatMap((k, i) => (k ? [i] : []))
  const canChoose = p.changed.length === p.ops.length && p.ops.length > 1
  const over = p.budgetMinutes ? p.plannedMinutes - p.budgetMinutes : 0
  const stale = p.version !== flow.version
  const live = proposal.state === 'open' || proposal.state === 'applying'
  const word = { added: 'New', moved: 'Moved', changed: 'Changed', same: null } as const

  // A whole day lands with the plan animation (item 12); a small change as before.
  const dealt = p.size === 'plan'
  return (
    <div className="relative px-4 py-5 sm:px-7 sm:py-7" data-playground-proposal={proposal.state}>
      {dealt && <span aria-hidden className="plan-sweep" />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-nova-ink"><Sparkles aria-hidden className="size-3.5" /> Nova’s proposal</p>
          <p className="mt-1 text-sm text-foreground/65">{p.size === 'plan' ? 'A plan for today, drawn as it would stand.' : 'A change to today, drawn as it would stand.'}</p>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', proposal.state === 'applying' ? 'bg-nova/15 text-nova-ink' : 'bg-[color:var(--sem-warning,#e6b450)]/12 text-[color:var(--sem-warning-ink,#f5c26b)]')} data-playground-badge>
          {proposal.state === 'applying' ? <><Loader2 aria-hidden className="size-3.5 animate-spin" /> Applying…</> : <><span aria-hidden className="studio-breathe size-1.5 rounded-full bg-current" /> Not applied yet</>}
        </span>
      </div>

      <ol ref={box} className="mt-5 space-y-2" aria-label="The proposed flow">
        {items.map((i, k) => (
          <li key={i.id} data-flip={i.id} style={{ ...toneStyle(i.subjectName), ['--i' as string]: k }}
            className={cn('subject-tone relative flex items-center gap-3 overflow-hidden rounded-2xl border bg-background/50 py-3 pl-4 pr-3 backdrop-blur-sm', dealt ? 'plan-deal' : 'nova-reveal',
              i.change === 'same' ? 'border-white/8' : 'studio-pending border-transparent bg-[var(--sc-faint)]')} data-proposed-item={i.change}>
            <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-[var(--sc)]" />
            <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-[var(--sc-edge)] text-[11px] font-semibold tabular-nums text-[var(--sc-ink)]">{k + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-[15px] font-medium', i.change === 'same' ? 'text-foreground/70' : 'text-foreground')}>{i.title}</p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-foreground/55">
                {i.subjectName && <span className="rounded-full bg-[var(--sc-soft)] px-2 py-px font-medium text-[var(--sc-ink)]">{i.subjectName}</span>}
                <span>{i.kind === 'task' ? 'Task' : i.kind === 'topic' ? 'Topic' : 'Just for today'}</span>
              </p>
            </div>
            {word[i.change] && <span className="shrink-0 rounded-md bg-nova/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-nova-ink">{word[i.change]}</span>}
            <span className="w-16 shrink-0 text-right text-sm tabular-nums text-foreground/70">{i.minutes ? minutesLabel(i.minutes) : '—'}</span>
          </li>
        ))}
      </ol>
      {dealt && p.budgetMinutes ? (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8" aria-hidden data-plan-timebar>
          <div className={cn('plan-fill h-full rounded-full', over > 0 ? 'bg-amber-400' : 'bg-nova')} style={{ width: `${Math.min(100, (p.plannedMinutes / p.budgetMinutes) * 100)}%`, ['--n' as string]: items.length }} />
        </div>
      ) : null}
      {later.length > 0 && <p className="mt-3 text-xs text-foreground/55">If there’s time: {later.map(i => i.title).join(', ')}</p>}
      {p.removed.length > 0 && <p className="mt-2 text-xs text-foreground/55">Out of today: <span className="line-through decoration-foreground/40">{p.removed.map(r => r.title).join(', ')}</span>{p.removed.some(r => r.kind === 'task') ? ' · the tasks stay on your board' : ''}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/60">
        <span>{minutesLabel(p.plannedMinutes)} in the day{p.budgetMinutes ? ` · your usual day is ${minutesLabel(p.budgetMinutes)}` : ''} · times are estimates</span>
        {over > 0 && <span className="font-medium text-[color:var(--sem-warning-ink,#f5c26b)]">{minutesLabel(over)} over</span>}
      </div>

      {choosing && (
        <fieldset className="mt-4 space-y-1.5 rounded-2xl border border-white/8 bg-background/40 p-4">
          <legend className="px-1 text-xs text-foreground/60">Keep the changes you want</legend>
          {p.changed.map((c, k) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 text-sm text-foreground/85">
              <input type="checkbox" checked={keep[k]} onChange={e => setKeep(list => list.map((x, i) => (i === k ? e.target.checked : x)))} className="mt-1 accent-[var(--nova)]" data-proposal-keep={k} />{c}
            </label>
          ))}
        </fieldset>
      )}

      {stale && live ? (
        <p className="mt-5 rounded-xl border border-white/10 bg-background/40 px-4 py-3 text-sm text-foreground/75">Your flow changed since Nova proposed this, so it can’t be applied as it is. Ask Nova again for an up-to-date version.</p>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2" data-proposal-actions>
          <button type="button" disabled={busy || !live || (choosing && kept.length === 0)} onClick={() => onApply(choosing && kept.length < p.ops.length ? kept : null)}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-5 text-sm font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] transition-colors hover:bg-action-hover disabled:opacity-50" data-proposal-apply>
            {proposal.state === 'applying' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {choosing ? `Apply ${kept.length} of ${p.ops.length}` : p.size === 'plan' ? 'Apply plan' : 'Apply change'}
          </button>
          {canChoose && <button type="button" disabled={!live} onClick={() => setChoosing(v => !v)} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-white/12 px-4 text-sm text-foreground/85 hover:bg-white/5" data-proposal-edit><Pencil className="size-3.5" /> {choosing ? 'Done choosing' : 'Edit flow'}</button>}
          <button type="button" disabled={!live} onClick={onChange} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-white/12 px-4 text-sm text-foreground/85 hover:bg-white/5" data-proposal-change><MessageSquareText className="size-3.5" /> Change something</button>
          <button type="button" disabled={!live} onClick={onDiscard} className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-foreground/60 hover:bg-white/5 hover:text-foreground" data-proposal-discard><X className="size-3.5" /> Discard</button>
        </div>
      )}
    </div>
  )
}

export function Playground({ flow, proposal, thinking, busy, touched, sessionRunning, starting, starters, onOps, onStart, onView, onApply, onDiscard, onChange, onAsk, onAdd, onPropose, onTakeDraft, composing = false, ready = null }: {
  flow: NovaDayView | null
  proposal: OpenProposal | null
  thinking: boolean
  busy: boolean
  touched: string[]
  sessionRunning: boolean
  starting: string | null
  starters: string[]
  onOps: (ops: FlowOp[]) => void
  onStart: (item: FlowItemView, minutes: number) => void
  onView: (v: 'list' | 'schedule') => void
  onApply: (keep: number[] | null) => void
  onDiscard: () => void
  onChange: () => void
  onAsk: (text: string) => void
  onAdd: () => void
  // Item 12: Nova builds a plan now; and taking Nova's own suggestion as it is.
  onPropose: () => void
  onTakeDraft: () => void
  // Item 12: a plan being composed now; and when Nova's plan is already prepared, since when.
  composing?: boolean
  ready?: string | null
}) {
  const [left, setLeft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const ids = flow?.items.map(i => `${i.id}:${i.status}`).join(',') ?? ''
  useFlip(list, ids)
  const showing = proposal && (proposal.state === 'open' || proposal.state === 'applying') ? proposal : null
  const hasFlow = !!flow && flow.saved && flow.items.length > 0
  const open = flow?.items.filter(i => i.status === 'planned' || i.status === 'active') ?? []
  const done = flow?.items.filter(i => i.status === 'done').length ?? 0
  const n = Number(left)

  return (
    <section aria-label="Today's planning playground" aria-busy={thinking}
      className={cn('nova-hero relative isolate overflow-hidden rounded-[2rem] border border-white/8 bg-card/50', thinking && 'studio-thinking')}
      style={{ ['--h1' as string]: 179, ['--h2' as string]: 237, ['--h3' as string]: 293 }} data-playground={showing ? 'proposal' : hasFlow ? 'saved' : 'empty'}>
      <div aria-hidden className="nova-canvas pointer-events-none absolute inset-0 -z-10 opacity-60 [mask-image:radial-gradient(ellipse_at_40%_30%,black,transparent_80%)]" />
      {thinking && (
        <p role="status" className="absolute right-5 top-5 z-10 inline-flex items-center gap-2 rounded-full border border-nova/30 bg-background/70 px-3 py-1 text-xs font-medium text-nova-ink backdrop-blur" data-playground-thinking>
          <Loader2 aria-hidden className="size-3.5 animate-spin" /> Nova is thinking…
        </p>
      )}
      {proposal && (proposal.state === 'stale' || proposal.state === 'failed') && (
        <div role="alert" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--sem-warning,#e6b450)]/35 bg-[color:var(--sem-warning,#e6b450)]/[0.07] px-4 py-3 text-sm text-foreground/85 sm:mx-7" data-playground-failed>
          <span>{proposal.note ?? 'That didn’t apply. Nothing changed.'}</span>
          <button type="button" onClick={() => onAsk('Please propose that again for my flow as it is now.')} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline"><RotateCcw className="size-3.5" /> Ask Nova again</button>
        </div>
      )}

      {!flow ? (
        <div aria-busy="true" className="h-80 animate-pulse" />
      ) : composing && !showing ? (
        <Composing />
      ) : showing ? (
        <Proposal key={showing.pending.id} proposal={showing} flow={flow} busy={busy} onApply={onApply} onDiscard={onDiscard} onChange={onChange} />
      ) : !hasFlow ? (
        <Empty onStart={onAsk} onPropose={onPropose} starters={starters} thinking={thinking} draft={flow?.draft ?? null} onTakeDraft={onTakeDraft} busy={busy} ready={ready} />
      ) : (
        <div className="px-3 py-5 sm:px-6 sm:py-6" data-playground-saved>
          <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Your flow for today</h2>
              <p className="mt-0.5 text-xs text-foreground/60" data-today-progress>
                {done} of {open.length + done} done · {minutesLabel(flow.plannedMinutes)} planned{flow.budgetMinutes ? ` of ${minutesLabel(flow.budgetMinutes)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label="Show today as" className="inline-flex rounded-lg border border-white/10 bg-background/40 p-0.5 text-xs">
                {([['list', LayoutList, 'List'], ['schedule', CalendarDays, 'Schedule']] as const).map(([v, Icon, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={flow.view === v} disabled={busy} onClick={() => onView(v)}
                    className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1', flow.view === v ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground')} data-today-view={v}>
                    <Icon className="size-3.5" aria-hidden /> {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={onAdd} className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-background/40 px-2.5 text-xs font-medium text-foreground/80 hover:text-foreground" data-today-add-inline><Plus className="size-3.5" /> Add</button>
            </div>
          </div>
          <div ref={list} className="rounded-2xl bg-background/30 p-1.5 backdrop-blur-sm">
            {flow.view === 'schedule'
              ? <div className="px-3 py-2"><FlowSchedule flow={flow} busy={busy} onOps={onOps} touched={touched} /></div>
              : <FlowList flow={flow} busy={busy} touched={touched} onOps={onOps} onStart={onStart} starting={starting} sessionRunning={sessionRunning} />}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-2 text-xs text-foreground/60">
            <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); if (Number.isInteger(n) && n > 0 && n <= 1440) { onOps([{ op: 'fit', minutes: n }]); setLeft('') } }} data-fit-form>
              <Hourglass aria-hidden className="size-3.5" />
              <label htmlFor="fit-minutes">Time left today?</label>
              <input id="fit-minutes" inputMode="numeric" value={left} onChange={e => setLeft(e.target.value.slice(0, 4))} placeholder="min" className="h-7 w-16 rounded-md border border-white/10 bg-background/50 px-2 text-foreground focus:border-nova/60 focus:outline-none" />
              <button type="submit" disabled={!left || busy} className="rounded-md border border-white/12 px-2 py-1 text-foreground/80 disabled:opacity-40">Fit the rest</button>
            </form>
            <button type="button" onClick={() => onAsk('Help me change today’s flow')} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline">Change it with Nova <ArrowRight className="size-3" /></button>
          </div>
        </div>
      )}
    </section>
  )
}

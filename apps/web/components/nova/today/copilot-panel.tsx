'use client'

// Nova beside Today: Plan (shape the day together) and Focus (help with what
// is being worked on). Nova proposes; the learner decides. Each message is
// one request (day-copilot.ts) and nothing it reads is written by itself:
//
//   a question   Nova asks what it needs, with quick replies to tap.
//   a proposal   a change to today's flow, drawn as it would stand (added,
//                moved, changed, taken out, the minutes against the day's
//                time) and marked "Not applied". Apply sends it to the
//                server, which applies exactly it or refuses it as stale; it
//                is called applied only after the server says so, with Undo.
//                The learner can keep only some of its changes, ask for
//                different priorities, start again, or keep their plan.
//   a task change  shown with what it would do, run on its own Confirm
//                through the task routes.
//
// The conversation and each proposal's state are kept in this tab. The panel
// stays mounted while hidden, so closing it loses nothing.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Brain, CalendarRange, Check, ChevronDown, CircleSlash, Loader2, Pencil, RotateCcw, Send, Shuffle, Undo2, X } from 'lucide-react'
import type { CopilotMode, CopilotProposal, FlowItemView, NovaDayView, PendingChange } from '@repo/api/nova/product/day-flow.types'
import { KivoMark } from '@/components/brand/kivo-brand'
import { cn } from '@/lib/utils'
import { toneStyle } from '../subject-color'
import { askCopilot, runTaskProposal } from './day-api'

type PendingState = 'open' | 'applying' | 'applied' | 'declined' | 'replaced' | 'stale' | 'failed'
type Turn =
  | { id: string; role: 'learner'; text: string; mode: CopilotMode }
  | {
      id: string; role: 'nova'; text: string; question: string | null; choices: string[]
      pending: (PendingChange & { state: PendingState; note?: string }) | null
      changed: string[]
      proposals: Array<CopilotProposal & { state: 'open' | 'done' | 'declined' | 'failed' }>
      link: { href: string; label: string } | null
      error?: boolean
    }
type NovaTurn = Extract<Turn, { role: 'nova' }>

const store = (day: string) => `kivo-today-copilot-v2:${day}`
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

const STARTERS: Record<CopilotMode, string[]> = {
  plan: ['Plan my day', 'I have 45 minutes left', 'What should I do next?', 'Make today lighter'],
  focus: ['Explain the idea first', 'I want to implement it', 'Quick revision', 'I’m stuck'],
}
const CHANGE_WORD = { added: 'New', moved: 'Moved', changed: 'Changed', same: null } as const

export type ApproveResult = { ok: true; flow: NovaDayView } | { ok: false; stale: boolean; message: string }

export function CopilotPanel({ flow, mode, onMode, onAdopt, onApprove, onUndo, onReload, onClose, inputRef, focusItem }: {
  flow: NovaDayView
  mode: CopilotMode
  onMode: (m: CopilotMode) => void
  // A flow the server wrote on a "yes" in words.
  onAdopt: (flow: NovaDayView, changed: string[], touched: string[]) => void
  // The panel's Apply: the server applies exactly this proposal or refuses it.
  onApprove: (p: PendingChange, keep: number[] | null) => Promise<ApproveResult>
  onUndo: () => void
  onReload: () => void
  onClose?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  // The item Focus mode is about: the one running, else the next one.
  focusItem: FlowItemView | null
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const own = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? own
  const log = useRef<HTMLDivElement>(null)
  const running = flow.items.some(i => i.status === 'active' && !i.sessionEnded)

  useEffect(() => { try { const raw = sessionStorage.getItem(store(flow.day)); if (raw) setTurns(JSON.parse(raw) as Turn[]) } catch { /* storage off */ } }, [flow.day])
  useEffect(() => { try { sessionStorage.setItem(store(flow.day), JSON.stringify(turns.slice(-40))) } catch { /* storage off */ } }, [turns, flow.day])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [turns.length, pending])

  // The one proposal waiting for an answer: the latest, while it is open.
  const openTurn = [...turns].reverse().find((t): t is NovaTurn => t.role === 'nova' && t.pending !== null)
  const open = openTurn?.pending?.state === 'open' && openTurn.pending.version === flow.version ? openTurn.pending : null
  const lastNova = [...turns].reverse().find((t): t is NovaTurn => t.role === 'nova')

  const patchPending = (turnId: string, state: PendingState, note?: string) =>
    setTurns(list => list.map(t => (t.id === turnId && t.role === 'nova' && t.pending ? { ...t, pending: { ...t.pending, state, note } } : t)))

  async function send(text: string, opts: { draftNow?: boolean } = {}) {
    const message = text.trim()
    if (!message || pending) return
    setInput('')
    // Nova's turns carry what became of each proposal, so a "no" is remembered.
    const outcome: Record<PendingState, string> = { open: 'waiting for an answer', applying: 'being applied', applied: 'applied', declined: 'declined by the learner', replaced: 'replaced', stale: 'not applied (the flow had changed)', failed: 'not applied' }
    const history = turns.slice(-12).map(t => ({ role: t.role, text: t.role === 'learner' ? t.text : [t.question ?? t.text, t.pending ? `[Proposal, ${outcome[t.pending.state]}: ${t.pending.changed.join(' ')}]` : ''].filter(Boolean).join(' ') }))
    const openNow = open && openTurn ? { id: open.id, version: open.version, ops: open.ops } : null
    setTurns(list => [...list, { id: newId(), role: 'learner', text: message, mode }])
    setPending(true)
    const res = await askCopilot({ message, mode, version: flow.version, focusItemId: focusItem?.id ?? null, history, open: openNow, draftNow: opts.draftNow })
    setPending(false)
    if (!res.ok) {
      if ('flow' in res && res.flow) onAdopt(res.flow, [], [])
      setTurns(list => [...list, { id: newId(), role: 'nova', text: res.message, question: null, choices: [], pending: null, changed: [], proposals: [], link: null, error: true }])
      return
    }
    // A new proposal replaces the open one; a yes or a no in words closes it.
    if (openTurn && (res.pending || res.closed)) patchPending(openTurn.id, res.closed === 'approved' ? 'applied' : res.closed === 'declined' ? 'declined' : 'replaced')
    if (res.flow) onAdopt(res.flow, res.changed, res.touched)
    setTurns(list => [...list, {
      id: newId(), role: 'nova', text: res.reply, question: res.question, choices: res.choices,
      pending: res.pending ? { ...res.pending, state: 'open' } : null, changed: res.changed,
      proposals: res.proposals.map(p => ({ ...p, state: 'open' as const })), link: res.link,
    }])
  }

  async function apply(turn: NovaTurn, keep: number[] | null) {
    if (!turn.pending) return
    patchPending(turn.id, 'applying')
    const res = await onApprove(turn.pending, keep)
    if (res.ok) patchPending(turn.id, 'applied')
    else patchPending(turn.id, res.stale ? 'stale' : 'failed', res.message)
  }

  async function confirm(turnId: string, index: number, p: CopilotProposal) {
    if (p.kind === 'task_delete' && confirmDelete !== `${turnId}:${index}`) { setConfirmDelete(`${turnId}:${index}`); return }
    setConfirmDelete(null)
    const done = await runTaskProposal(p, `today:${flow.day}:${turnId}:${index}`)
    setTurns(list => list.map(t => (t.id === turnId && t.role === 'nova' ? { ...t, proposals: t.proposals.map((x, k) => (k === index ? { ...x, state: done.ok ? 'done' : 'failed' } : x)) } : t)))
    if (done.ok) onReload()
  }
  const decline = (turnId: string, index: number) => setTurns(list => list.map(t => (t.id === turnId && t.role === 'nova' ? { ...t, proposals: t.proposals.map((x, k) => (k === index ? { ...x, state: 'declined' } : x)) } : t)))
  const fill = (text: string) => { setInput(text); window.setTimeout(() => { box.current?.focus(); box.current?.setSelectionRange(text.length, text.length) }, 0) }

  const status = pending ? 'Nova is thinking…'
    : open ? 'A proposal is waiting for your answer. Nothing has changed yet.'
    : mode === 'plan' ? 'Nova asks before it changes anything.'
    : focusItem ? null : 'Pick something to focus on, or ask about anything you’re learning.'

  return (
    <section className="flex h-full min-h-0 flex-col bg-gradient-to-b from-nova/[0.05] via-transparent to-transparent" aria-label="Nova, your day's companion" data-copilot data-copilot-mode={mode}>
      <header className="flex shrink-0 items-center gap-2.5 px-4 pb-3 pt-4">
        <span aria-hidden className="relative grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-nova/30 to-nova/5 ring-1 ring-nova/35">
          {pending && <span className="absolute inset-0 rounded-full ring-2 ring-nova/50 kivo-node-pulse" />}
          <KivoMark size={16} className="text-nova-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-foreground">Nova</p>
          <p className="text-[11px] leading-tight text-foreground/55">{mode === 'plan' ? 'Plans with you' : 'Learns with you'}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Hide Nova" data-copilot-close><X className="size-4" /></button>}
      </header>
      <div className="shrink-0 px-4">
        <div role="tablist" aria-label="What Nova helps with" className="grid grid-cols-2 rounded-xl bg-white/[0.05] p-1 text-sm">
          {([['plan', CalendarRange, 'Plan'], ['focus', Brain, 'Focus']] as const).map(([m, Icon, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)}
              className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-[background-color,color,box-shadow]', mode === m ? 'bg-background text-foreground shadow-sm ring-1 ring-white/8' : 'text-foreground/55 hover:text-foreground')} data-copilot-tab={m}>
              <Icon className="size-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        {mode === 'focus' && focusItem && (
          <div className="subject-tone mt-3 flex items-center gap-2.5 rounded-xl border border-[var(--sc-edge)] bg-[var(--sc-faint)] px-3 py-2" style={toneStyle(focusItem.subjectName)} data-copilot-focus={focusItem.id}>
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--sc)]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{focusItem.title}</p>
              <p className="truncate text-[11px] text-foreground/60">{running ? 'Focusing now' : 'Up next'}{focusItem.subjectName ? ` · ${focusItem.subjectName}` : ''}</p>
            </div>
          </div>
        )}
        {status && <p className="mt-2.5 text-[11px] text-foreground/55" role="status" data-copilot-status>{status}</p>}
      </div>

      <div ref={log} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" data-copilot-log>
        {turns.length === 0 && (
          <div className="nova-rise rounded-2xl border border-white/8 bg-card/50 p-4">
            <p className="text-sm font-medium text-foreground">{mode === 'plan' ? 'Let’s shape today together.' : focusItem ? `What do you want from ${focusItem.title}?` : 'What are you working on?'}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">{mode === 'plan'
              ? 'Tell me what matters today, or how much time you have. I’ll ask what I need, suggest something concrete, and change nothing until you say yes.'
              : 'Understand it, build it, or revise it? Tell me where you are and I’ll pitch it to you: short, simple, practical, or just hints.'}</p>
          </div>
        )}
        {turns.map(t => t.role === 'learner' ? (
          <div key={t.id} className="ml-auto w-fit max-w-[86%] rounded-2xl rounded-br-md bg-action/15 px-3.5 py-2 text-sm text-foreground ring-1 ring-action/20" data-copilot-turn="learner">{t.text}</div>
        ) : (
          <div key={t.id} className="nova-reveal flex gap-2.5" data-copilot-turn="nova">
            <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-nova/12 ring-1 ring-nova/25"><KivoMark size={11} className="text-nova-ink" /></span>
            <div className="min-w-0 flex-1 space-y-2.5 text-sm leading-relaxed text-foreground/85">
              {t.text && <p className={cn('whitespace-pre-wrap', t.error && 'text-amber-200')}>{t.text}</p>}
              {t.question && <p className="whitespace-pre-wrap font-medium text-foreground" data-copilot-question>{t.question}</p>}
              {t.pending && <Proposal turn={t} flow={flow} busy={pending} onApply={keep => void apply(t, keep)} onDecline={() => patchPending(t.id, 'declined')}
                onPriorities={() => fill('Change the priorities: ')} onRestart={() => void send('Let’s start from scratch')} onUndo={onUndo} />}
              {t.changed.length > 0 && !t.pending && (
                <div className="rounded-xl border border-nova/25 bg-nova/[0.06] px-3 py-2 text-xs text-foreground/80" data-copilot-changed>
                  <p className="mb-1 font-semibold text-nova-ink">Applied and saved</p>
                  {t.changed.map((c, k) => <p key={k} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-nova-ink" aria-hidden /> {c}</p>)}
                  {t === lastNova && flow.canUndo && <button type="button" onClick={onUndo} className="mt-1 inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-copilot-undo><Undo2 className="size-3" /> Undo</button>}
                </div>
              )}
              {t.proposals.map((p, k) => (
                <div key={k} className="rounded-xl border border-[color:var(--sem-warning,#e6b450)]/35 bg-[color:var(--sem-warning,#e6b450)]/[0.05] px-3 py-2.5 text-xs" data-copilot-proposal={p.kind}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--sem-warning-ink,#f5c26b)]">Needs your yes · changes the task</p>
                  <p className="mt-1 font-medium text-foreground">{p.label}</p>
                  {p.details && p.details.length > 0 && <ul className="mt-1 space-y-0.5 text-foreground/60">{p.details.map(d => <li key={d}>{d}</li>)}</ul>}
                  {p.state === 'open' ? (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => void confirm(t.id, k, p)} className="rounded-lg bg-action px-2.5 py-1 font-semibold text-action-foreground hover:bg-action-hover" data-proposal-confirm>
                        {p.kind === 'task_delete' && confirmDelete === `${t.id}:${k}` ? 'Yes, delete the task' : p.kind === 'create_task' ? 'Create task' : 'Confirm'}
                      </button>
                      <button type="button" onClick={() => decline(t.id, k)} className="rounded-lg px-2 py-1 text-subtle hover:text-foreground">Not now</button>
                    </div>
                  ) : <p className="mt-1.5 text-subtle">{p.state === 'done' ? 'Done.' : p.state === 'failed' ? 'That didn’t save. Nothing changed.' : 'Left as it is.'}</p>}
                </div>
              ))}
              {t.link && <Link href={t.link.href} className="inline-flex items-center gap-1 text-sm font-medium text-nova-ink hover:underline">{t.link.label} <ArrowRight className="size-3.5" /></Link>}
              {t === lastNova && t.choices.length > 0 && !pending && (
                <div className="flex flex-wrap gap-1.5 pt-0.5" data-copilot-choices>
                  {t.choices.map(c => (
                    <button key={c} type="button" onClick={() => void send(c, { draftNow: c.toLowerCase().startsWith('just draft') })}
                      className="rounded-full border border-nova/30 bg-nova/[0.06] px-3 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-nova/60 hover:bg-nova/12" data-copilot-choice>{c}</button>
                  ))}
                  {t.question && <button type="button" onClick={() => box.current?.focus()} className="rounded-full px-2 py-1 text-xs text-foreground/50 hover:text-foreground">Something else…</button>}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2.5" aria-hidden>
            <span className="grid size-6 place-items-center rounded-full bg-nova/12 ring-1 ring-nova/25"><KivoMark size={11} className="text-nova-ink" /></span>
            <span className="flex gap-1"><span className="size-1.5 animate-bounce rounded-full bg-nova/70 [animation-delay:-0.2s]" /><span className="size-1.5 animate-bounce rounded-full bg-nova/70 [animation-delay:-0.1s]" /><span className="size-1.5 animate-bounce rounded-full bg-nova/70" /></span>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/6 px-4 pb-4 pt-3">
        {turns.length === 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {STARTERS[mode].map(c => <button key={c} type="button" disabled={pending} onClick={() => void send(c)} className="rounded-full border border-white/12 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-nova/50 hover:text-foreground disabled:opacity-40" data-copilot-chip>{c}</button>)}
          </div>
        )}
        <form onSubmit={e => { e.preventDefault(); void send(input) }} className="flex items-end gap-2 rounded-2xl border border-white/10 bg-card/60 p-1.5 transition-colors focus-within:border-nova/50">
          <label htmlFor="copilot-input" className="sr-only">Tell Nova</label>
          <textarea id="copilot-input" ref={box} rows={1} value={input} maxLength={800} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
            placeholder={open ? 'Say yes, or what to change…' : mode === 'plan' ? 'What matters today?' : 'Ask about what you’re working on…'}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none" data-copilot-input />
          <button type="submit" disabled={!input.trim() || pending} className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-40" aria-label="Send">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
      </div>
    </section>
  )
}

// A proposed change to today, drawn as the day would stand. Small changes
// are a compact line; a day being built is a card with its items, minutes
// and choices. "Not applied" until the server says it is.
function Proposal({ turn, flow, busy, onApply, onDecline, onPriorities, onRestart, onUndo }: {
  turn: NovaTurn; flow: NovaDayView; busy: boolean
  onApply: (keep: number[] | null) => void
  onDecline: () => void
  onPriorities: () => void
  onRestart: () => void
  onUndo: () => void
}) {
  const p = turn.pending!
  const [editing, setEditing] = useState(false)
  const [keep, setKeep] = useState<boolean[]>(() => p.ops.map(() => true))
  const [showAll, setShowAll] = useState(false)
  const editable = p.changed.length === p.ops.length && p.ops.length > 1
  const live = p.state === 'open' || p.state === 'applying'
  const big = p.size === 'plan'
  const kept = keep.flatMap((k, i) => (k ? [i] : []))
  const items = p.items.filter(i => i.status !== 'later')
  const later = p.items.filter(i => i.status === 'later')
  const shown = showAll ? items : items.slice(0, 6)
  const over = p.budgetMinutes ? p.plannedMinutes - p.budgetMinutes : 0
  const stateLine: Record<PendingState, string | null> = {
    open: null, applying: 'Applying…', applied: 'Applied and saved.', declined: 'Not applied. Your plan is as it was.',
    replaced: 'Replaced by the newer proposal below. Not applied.', stale: p.note ?? 'Your flow changed since, so this wasn’t applied.', failed: p.note ?? 'That didn’t save. Nothing changed.',
  }

  return (
    <div className={cn('overflow-hidden rounded-2xl border transition-colors', live ? 'border-nova/35 bg-card/80 shadow-soft' : 'border-white/8 bg-card/40')} data-copilot-pending={p.state} data-pending-size={p.size}>
      <div className="flex items-center justify-between gap-2 border-b border-white/6 px-3.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-nova-ink">{big ? 'Proposed plan for today' : 'Proposed change'}</p>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', p.state === 'applied' ? 'bg-nova/15 text-nova-ink' : live ? 'bg-[color:var(--sem-warning,#e6b450)]/12 text-[color:var(--sem-warning-ink,#f5c26b)]' : 'bg-white/6 text-foreground/50')} data-pending-badge>
          {p.state === 'applied' ? 'Applied' : p.state === 'applying' ? 'Applying' : live ? 'Not applied yet' : 'Not applied'}
        </span>
      </div>

      <div className="px-3.5 py-3">
        {editing ? (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-foreground/60">Keep the changes you want:</legend>
            {p.changed.map((c, k) => (
              <label key={k} className="flex cursor-pointer items-start gap-2 text-xs text-foreground/85">
                <input type="checkbox" checked={keep[k]} onChange={e => setKeep(list => list.map((x, i) => (i === k ? e.target.checked : x)))} className="mt-0.5 accent-[var(--nova)]" data-pending-keep={k} />
                {c}
              </label>
            ))}
          </fieldset>
        ) : big ? (
          <>
            <ol className="space-y-1">
              {shown.map((i, k) => (
                <li key={i.id} className="subject-tone flex items-center gap-2 text-[13px]" style={toneStyle(i.subjectName)}>
                  <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-foreground/40">{k + 1}</span>
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--sc)]" />
                  <span className={cn('min-w-0 flex-1 truncate', i.change === 'same' ? 'text-foreground/60' : 'text-foreground')}>{i.title}</span>
                  {CHANGE_WORD[i.change] && <span className="shrink-0 rounded-md bg-nova/12 px-1.5 text-[10px] font-semibold text-nova-ink">{CHANGE_WORD[i.change]}</span>}
                  <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-foreground/55">{i.minutes ? minutesLabel(i.minutes) : '—'}</span>
                </li>
              ))}
            </ol>
            {items.length > 6 && <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground/55 hover:text-foreground">{showAll ? 'Show less' : `${items.length - 6} more`} <ChevronDown className={cn('size-3', showAll && 'rotate-180')} /></button>}
            {later.length > 0 && <p className="mt-2 text-[11px] text-foreground/55">If there’s time: {later.map(i => i.title).join(', ')}</p>}
            {p.removed.length > 0 && <p className="mt-2 text-[11px] text-foreground/55">Out of today: <span className="line-through decoration-foreground/30">{p.removed.map(r => r.title).join(', ')}</span>{p.removed.some(r => r.kind === 'task') ? ' (tasks stay on your board)' : ''}</p>}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/6 pt-2 text-[11px] text-foreground/60">
              <span>{minutesLabel(p.plannedMinutes)} planned{p.budgetMinutes ? ` of ${minutesLabel(p.budgetMinutes)}` : ''} · times are estimates</span>
              {over > 0 && <span className="font-medium text-[color:var(--sem-warning-ink,#f5c26b)]">{minutesLabel(over)} over</span>}
            </div>
          </>
        ) : (
          <ul className="space-y-1 text-[13px] text-foreground/90">
            {p.changed.map((c, k) => <li key={k} className="flex items-start gap-2"><span aria-hidden className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-nova" />{c}</li>)}
          </ul>
        )}
      </div>

      {live ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/6 bg-white/[0.02] px-3 py-2.5">
          <button type="button" disabled={busy || p.state === 'applying' || (editing && kept.length === 0) || p.version !== flow.version}
            onClick={() => onApply(editing && kept.length < p.ops.length ? kept : null)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50" data-pending-apply>
            {p.state === 'applying' ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {editing ? `Apply ${kept.length} of ${p.ops.length}` : big ? 'Apply this plan' : 'Apply'}
          </button>
          {editable && <button type="button" onClick={() => setEditing(v => !v)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-foreground/75 hover:bg-white/6 hover:text-foreground" data-pending-edit><Pencil className="size-3" /> {editing ? 'Done choosing' : 'Let me edit it'}</button>}
          {big && <button type="button" onClick={onPriorities} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-foreground/75 hover:bg-white/6 hover:text-foreground"><Shuffle className="size-3" /> Change priorities</button>}
          {big && <button type="button" onClick={onRestart} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-foreground/75 hover:bg-white/6 hover:text-foreground"><RotateCcw className="size-3" /> Start over</button>}
          <button type="button" onClick={onDecline} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-foreground/60 hover:bg-white/6 hover:text-foreground" data-pending-decline><CircleSlash className="size-3" /> {big ? 'Keep my plan' : 'Not now'}</button>
          {p.version !== flow.version && <p className="basis-full text-[11px] text-foreground/55">Your flow changed since this was proposed. Ask again to get an up-to-date one.</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-white/6 px-3.5 py-2 text-[11px] text-foreground/60" data-pending-result>
          {p.state === 'applied' && <Check className="size-3.5 text-nova-ink" aria-hidden />}
          <span>{stateLine[p.state]}</span>
          {p.state === 'applied' && flow.canUndo && <button type="button" onClick={onUndo} className="ml-auto inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-copilot-undo><Undo2 className="size-3" /> Undo</button>}
        </div>
      )}
    </div>
  )
}

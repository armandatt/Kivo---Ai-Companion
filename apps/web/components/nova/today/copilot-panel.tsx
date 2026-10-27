'use client'

// Nova beside the playground: the daily-planning conversation. One job,
// today's flow (day-copilot.ts). Each message is one request; nothing Nova
// reads is written by itself:
//
//   a question   Nova asks what it needs, with quick replies to tap.
//   a proposal   drawn in the playground (the page shows it from
//                onProposal); here it is a short line saying it waits for
//                the learner. Apply goes to the server, which applies exactly
//                it or refuses it as stale; it is called applied only after
//                the server says so.
//
// The page drives the same proposal from the playground through the handle
// (apply, discard, fill, send). The conversation is temporary and the flow is
// not: the conversation and each proposal's state are kept in this tab for
// today only (sessionStorage, keyed by the day, so a new day starts a new
// chat); the flow is the server's. The panel stays mounted while hidden, so
// closing it loses nothing. New chat clears the conversation and nothing
// else; with a proposal still waiting it asks first, because starting over
// discards that proposal (the saved flow stays as it is).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Loader2, MessageSquarePlus, Send, Undo2, X } from 'lucide-react'
import type { NovaDayView, PendingChange } from '@repo/api/nova/product/day-flow.types'
import { KioMark } from '@/components/brand/kio-brand'
import { cn } from '@/lib/utils'
import { askCopilot } from './day-api'
import type { OpenProposal, ProposalState } from './playground'

type Turn =
  | { id: string; role: 'learner'; text: string }
  | {
      id: string; role: 'nova'; text: string; question: string | null; choices: string[]
      pending: (PendingChange & { state: ProposalState; note?: string }) | null
      changed: string[]
      link: { href: string; label: string } | null
      error?: boolean
    }
type NovaTurn = Extract<Turn, { role: 'nova' }>

const PREFIX = 'kivo-today-studio:'
const store = (day: string) => `${PREFIX}${day}`
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export type ApproveResult = { ok: true; flow: NovaDayView } | { ok: false; stale: boolean; message: string }
export type CopilotHandle = {
  send: (text: string, opts?: { draftNow?: boolean }) => void
  apply: (keep: number[] | null) => void
  discard: () => void
  fill: (text: string) => void
}

const OUTCOME: Record<ProposalState, string> = {
  open: 'waiting for an answer', applying: 'being applied', applied: 'applied', declined: 'declined by the learner',
  replaced: 'replaced', stale: 'not applied (the flow had changed)', failed: 'not applied',
}
const STATE_LINE: Record<ProposalState, string> = {
  open: 'Shown in the playground · not applied yet', applying: 'Applying…', applied: 'Applied and saved',
  declined: 'Discarded · your plan is as it was', replaced: 'Replaced by a newer proposal', stale: 'Not applied · your flow had changed', failed: 'Not applied · nothing changed',
}

export const CopilotPanel = forwardRef<CopilotHandle, {
  flow: NovaDayView
  // The top-level subject selected on the page, as context.
  subject: { id: string | null; name: string } | null
  onAdopt: (flow: NovaDayView, changed: string[], touched: string[]) => void
  onApprove: (p: PendingChange, keep: number[] | null) => Promise<ApproveResult>
  onUndo: () => void
  onClose?: () => void
  // What the playground draws: whether Nova is working, and the latest proposal.
  onState: (s: { thinking: boolean; proposal: OpenProposal | null }) => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}>(function CopilotPanel({ flow, subject, onAdopt, onApprove, onUndo, onClose, onState, inputRef }, ref) {
  const [turns, setTurns] = useState<Turn[]>([])
  // The day these turns belong to: they are saved under that day only.
  const [turnsDay, setTurnsDay] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const own = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? own
  const log = useRef<HTMLDivElement>(null)

  // Today's conversation, if this tab has one; an earlier day's is let go.
  useEffect(() => {
    let saved: Turn[] = []
    try {
      const raw = sessionStorage.getItem(store(flow.day))
      if (raw) saved = JSON.parse(raw) as Turn[]
      for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k?.startsWith(PREFIX) && k !== store(flow.day)) sessionStorage.removeItem(k) }
    } catch { /* storage off */ }
    setTurns(saved); setTurnsDay(flow.day); setConfirmNew(false)
  }, [flow.day])
  useEffect(() => { if (turnsDay !== flow.day) return; try { if (turns.length) sessionStorage.setItem(store(flow.day), JSON.stringify(turns.slice(-40))); else sessionStorage.removeItem(store(flow.day)) } catch { /* storage off */ } }, [turns, turnsDay, flow.day])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [turns.length, pending])

  // The latest proposal, whatever became of it.
  const lastProposal = [...turns].reverse().find((t): t is NovaTurn => t.role === 'nova' && t.pending !== null) ?? null
  const open = lastProposal?.pending && lastProposal.pending.state === 'open' && lastProposal.pending.version === flow.version ? lastProposal.pending : null
  const lastNova = [...turns].reverse().find((t): t is NovaTurn => t.role === 'nova')
  useEffect(() => {
    const p = lastProposal?.pending
    onState({ thinking: pending, proposal: p ? { pending: p, state: p.state, note: p.note } : null })
  }, [pending, lastProposal?.id, lastProposal?.pending?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (turnId: string, state: ProposalState, note?: string) =>
    setTurns(list => list.map(t => (t.id === turnId && t.role === 'nova' && t.pending ? { ...t, pending: { ...t.pending, state, note } } : t)))

  async function send(text: string, opts: { draftNow?: boolean } = {}) {
    const message = text.trim()
    if (!message || pending) return
    setInput('')
    const history = turns.slice(-12).map(t => ({ role: t.role, text: t.role === 'learner' ? t.text : [t.question ? `${t.text} ${t.question}`.trim() : t.text, t.pending ? `[Proposal, ${OUTCOME[t.pending.state]}: ${t.pending.changed.join(' ')}]` : ''].filter(Boolean).join(' ') }))
    const openNow = open ? { id: open.id, version: open.version, ops: open.ops } : null
    const openTurn = open ? lastProposal : null
    setTurns(list => [...list, { id: newId(), role: 'learner', text: message }])
    setPending(true)
    const res = await askCopilot({ message, version: flow.version, history, open: openNow, draftNow: opts.draftNow, subjectId: subject?.id ?? null })
    setPending(false)
    if (!res.ok) {
      if ('flow' in res && res.flow) onAdopt(res.flow, [], [])
      setTurns(list => [...list, { id: newId(), role: 'nova', text: res.message, question: null, choices: [], pending: null, changed: [], link: null, error: true }])
      return
    }
    // A new proposal replaces the open one; a yes or a no in words closes it.
    if (openTurn && (res.pending || res.closed)) patch(openTurn.id, res.closed === 'approved' ? 'applied' : res.closed === 'declined' ? 'declined' : 'replaced')
    if (res.flow) onAdopt(res.flow, res.changed, res.touched)
    setTurns(list => [...list, {
      id: newId(), role: 'nova', text: res.reply, question: res.question, choices: res.choices,
      pending: res.pending ? { ...res.pending, state: 'open' } : null, changed: res.changed, link: res.link,
    }])
  }

  async function apply(keep: number[] | null) {
    const turn = lastProposal
    if (!turn?.pending || turn.pending.state !== 'open') return
    patch(turn.id, 'applying')
    const res = await onApprove(turn.pending, keep)
    if (res.ok) patch(turn.id, 'applied')
    else patch(turn.id, res.stale ? 'stale' : 'failed', res.message)
  }
  const discard = () => { if (lastProposal?.pending?.state === 'open') patch(lastProposal.id, 'declined') }
  // A proposal not yet applied or discarded, current or not.
  const unapplied = lastProposal?.pending?.state === 'open' || lastProposal?.pending?.state === 'applying'
  const applying = lastProposal?.pending?.state === 'applying'
  const startOver = () => { setConfirmNew(false); setTurns([]); setInput(''); box.current?.focus() }
  const newChat = () => { if (pending || applying) return; if (unapplied) setConfirmNew(true); else startOver() }
  const fill = (text: string) => { setInput(text); window.setTimeout(() => { box.current?.focus(); box.current?.setSelectionRange(text.length, text.length) }, 0) }
  useImperativeHandle(ref, () => ({ send: (t, o) => void send(t, o), apply: k => void apply(k), discard, fill }))

  const starters = subject
    ? [`Plan time for ${subject.name}`, 'Plan my day', 'I have about an hour']
    : ['Plan my day', 'I want to learn something new', 'I have about an hour']

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Nova, planning today with you" data-copilot>
      <header className="flex shrink-0 items-center gap-3 border-b border-white/6 px-5 py-4">
        <span aria-hidden className="relative grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-nova/35 via-nova/15 to-transparent ring-1 ring-nova/35">
          {pending && <span className="absolute inset-0 rounded-2xl ring-2 ring-nova/50 kio-node-pulse" />}
          <KioMark size={18} className="text-nova-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-foreground">Nova</p>
          <p className="truncate text-xs leading-tight text-foreground/55" role="status" data-copilot-status>
            {pending ? 'Thinking…' : open ? 'Waiting for your answer on the proposal' : 'Plans today with you · nothing changes without your yes'}
          </p>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={newChat} disabled={pending || applying}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-foreground/70 hover:bg-white/6 hover:text-foreground disabled:opacity-40"
            title="Start a new conversation. Your saved flow stays as it is." data-copilot-new>
            <MessageSquarePlus aria-hidden className="size-4" /> New chat
          </button>
        )}
        {onClose && <button type="button" onClick={onClose} className="inline-flex size-9 items-center justify-center rounded-xl text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Hide Nova" data-copilot-close><X className="size-4" /></button>}
      </header>
      {confirmNew && (
        <div role="alertdialog" aria-labelledby="copilot-new-title" className="mx-5 mt-3 shrink-0 rounded-xl border border-amber-300/30 bg-amber-300/[0.06] px-3.5 py-3 text-sm"
          onKeyDown={e => { if (e.key === 'Escape') setConfirmNew(false) }} data-copilot-confirm-new>
          <p id="copilot-new-title" className="font-medium text-foreground">Discard Nova’s proposal and start a new chat?</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/65">It hasn’t been applied. Your saved flow, tasks and sessions stay as they are.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" autoFocus onClick={() => { discard(); startOver() }} className="rounded-lg bg-action px-3 py-1.5 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-copilot-new-confirm>Discard and start new</button>
            <button type="button" onClick={() => setConfirmNew(false)} className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-foreground/80 hover:bg-white/5" data-copilot-new-cancel>Keep it</button>
          </div>
        </div>
      )}
      {subject && (
        <p className="mx-5 mt-3 inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-nova/10 px-3 py-1 text-xs text-nova-ink" data-copilot-subject>
          Context: {subject.name}
        </p>
      )}

      <div ref={log} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" data-copilot-log>
        {turns.length === 0 && (
          <div className="nova-rise">
            <p className="text-[15px] font-medium leading-relaxed text-foreground">Hi, I’m Nova. What do you want today to be about?</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/65">I’ll ask a couple of questions, suggest a flow from your own subjects and tasks, and change nothing until you say yes.</p>
          </div>
        )}
        {turns.map(t => t.role === 'learner' ? (
          <div key={t.id} className="nova-reveal ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-action/15 px-4 py-2.5 text-[15px] leading-relaxed text-foreground ring-1 ring-action/20" data-copilot-turn="learner">{t.text}</div>
        ) : (
          <div key={t.id} className="nova-reveal flex gap-3" data-copilot-turn="nova">
            <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl bg-nova/12 ring-1 ring-nova/25"><KioMark size={12} className="text-nova-ink" /></span>
            <div className="min-w-0 flex-1 space-y-2.5 text-[15px] leading-relaxed text-foreground/85">
              {t.text && <p className={cn('whitespace-pre-wrap', t.error && 'text-amber-200')}>{t.text}</p>}
              {t.question && <p className="whitespace-pre-wrap font-medium text-foreground" data-copilot-question>{t.question}</p>}
              {t.pending && (
                <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs', t.pending.state === 'open' ? 'border-nova/35 bg-nova/[0.06] text-foreground/85' : t.pending.state === 'applied' ? 'border-nova/25 text-nova-ink' : 'border-white/8 text-foreground/55')} data-copilot-pending={t.pending.state}>
                  {t.pending.state === 'applied' ? <Check aria-hidden className="size-3.5" /> : t.pending.state === 'applying' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <span aria-hidden className={cn('size-1.5 rounded-full', t.pending.state === 'open' ? 'studio-breathe bg-nova' : 'bg-foreground/30')} />}
                  <span className="min-w-0 flex-1">{t.pending.state === 'stale' || t.pending.state === 'failed' ? (t.pending.note ?? STATE_LINE[t.pending.state]) : STATE_LINE[t.pending.state]}</span>
                  {t.pending.state === 'open' && t === lastProposal && (
                    <>
                      <button type="button" onClick={() => void apply(null)} disabled={t.pending.version !== flow.version} className="rounded-lg bg-action px-2.5 py-1 font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-50" data-pending-apply>Apply</button>
                      <button type="button" onClick={discard} className="rounded-lg px-2 py-1 text-foreground/60 hover:text-foreground" data-pending-decline>Discard</button>
                    </>
                  )}
                  {t.pending.state === 'applied' && t === lastProposal && flow.canUndo && <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 font-medium hover:underline" data-copilot-undo><Undo2 className="size-3" /> Undo</button>}
                </div>
              )}
              {t.changed.length > 0 && !t.pending && (
                <div className="rounded-xl border border-nova/25 bg-nova/[0.06] px-3 py-2 text-xs text-foreground/80" data-copilot-changed>
                  <p className="mb-1 font-semibold text-nova-ink">Applied and saved</p>
                  {t.changed.map((c, k) => <p key={k} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-nova-ink" aria-hidden /> {c}</p>)}
                </div>
              )}
              {t.link && <Link href={t.link.href} className="inline-flex items-center gap-1 text-sm font-medium text-nova-ink hover:underline">{t.link.label} <ArrowRight className="size-3.5" /></Link>}
              {t === lastNova && t.choices.length > 0 && !pending && (
                <div className="flex flex-wrap gap-1.5 pt-0.5" data-copilot-choices>
                  {t.choices.map(c => (
                    <button key={c} type="button" onClick={() => void send(c, { draftNow: c.toLowerCase().startsWith('just draft') })}
                      className="rounded-full border border-nova/30 bg-nova/[0.06] px-3.5 py-1.5 text-[13px] font-medium text-foreground/90 transition-colors hover:border-nova/60 hover:bg-nova/12" data-copilot-choice>{c}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-3" aria-hidden>
            <span className="grid size-7 place-items-center rounded-xl bg-nova/12 ring-1 ring-nova/25"><KioMark size={12} className="text-nova-ink" /></span>
            <span className="flex gap-1"><span className="size-1.5 animate-bounce rounded-full bg-nova/70 [animation-delay:-0.2s]" /><span className="size-1.5 animate-bounce rounded-full bg-nova/70 [animation-delay:-0.1s]" /><span className="size-1.5 animate-bounce rounded-full bg-nova/70" /></span>
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pb-5 pt-3">
        {turns.length === 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {starters.map(c => <button key={c} type="button" disabled={pending} onClick={() => void send(c)} className="rounded-full border border-white/12 px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:border-nova/50 hover:text-foreground disabled:opacity-40" data-copilot-chip>{c}</button>)}
          </div>
        )}
        <form onSubmit={e => { e.preventDefault(); void send(input) }} className="flex items-end gap-2 rounded-2xl border border-white/10 bg-background/60 p-2 shadow-soft transition-colors focus-within:border-nova/50">
          <label htmlFor="copilot-input" className="sr-only">Tell Nova</label>
          <textarea id="copilot-input" ref={box} rows={2} value={input} maxLength={800} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
            placeholder={open ? 'Say yes, or what to change…' : 'What do you want to do today?'}
            className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none" data-copilot-input />
          <button type="submit" disabled={!input.trim() || pending} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-40" aria-label="Send">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
        <p className="mt-2 px-1 text-[11px] text-foreground/45">Nova plans today only. Notes, tasks and your map are changed on their own pages.</p>
      </div>
    </section>
  )
})

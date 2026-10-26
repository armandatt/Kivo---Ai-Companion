'use client'

// Nova beside Today: Plan (shape today's flow) and Focus (help with what is
// being worked on). Each message is one request (day-copilot.ts): the reply
// is Nova's words, and what changed in the flow is shown from what the
// server wrote, with Undo. A change to a task itself is a proposal that runs
// only on the learner's Confirm. The conversation is kept in this tab.

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Send, Sparkles, Undo2, X } from 'lucide-react'
import type { CopilotMode, CopilotProposal, NovaDayView } from '@repo/api/nova/product/day-flow.types'
import { KivoMark } from '@/components/brand/kivo-brand'
import { cn } from '@/lib/utils'
import { askCopilot, runTaskProposal } from './day-api'

type Turn =
  | { id: string; role: 'learner'; text: string; mode: CopilotMode }
  | { id: string; role: 'nova'; text: string; changed: string[]; proposals: Array<CopilotProposal & { state: 'open' | 'done' | 'declined' | 'failed' }>; question: string | null; error?: boolean }

const store = (day: string) => `kivo-today-copilot:${day}`
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const CHIPS: Record<CopilotMode, string[]> = {
  plan: ['Plan my day', 'I only have 45 minutes now', 'Make the rest of the day realistic', 'I finished early. What next?'],
  focus: ['Explain this simply', 'Give me an example', 'I’m stuck. Where do I start?'],
}

export function CopilotPanel({ flow, mode, onMode, onAdopt, onUndo, onReload, onClose, inputRef }: {
  flow: NovaDayView
  mode: CopilotMode
  onMode: (m: CopilotMode) => void
  onAdopt: (flow: NovaDayView, changed: string[], touched: string[]) => void
  onUndo: () => void
  onReload: () => void
  onClose?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const own = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? own
  const log = useRef<HTMLDivElement>(null)
  const focusItem = flow.items.find(i => i.status === 'active' && !i.sessionEnded) ?? null

  useEffect(() => { try { const raw = sessionStorage.getItem(store(flow.day)); if (raw) setTurns(JSON.parse(raw) as Turn[]) } catch { /* storage off */ } }, [flow.day])
  useEffect(() => { try { sessionStorage.setItem(store(flow.day), JSON.stringify(turns.slice(-30))) } catch { /* storage off */ } }, [turns, flow.day])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [turns.length, pending])

  async function send(text: string) {
    const message = text.trim()
    if (!message || pending) return
    setInput('')
    const history = turns.slice(-6).map(t => ({ role: t.role, text: t.role === 'learner' ? t.text : [t.text, ...t.changed].join(' ') }))
    setTurns(list => [...list, { id: newId(), role: 'learner', text: message, mode }])
    setPending(true)
    const res = await askCopilot({ message, mode, version: flow.version, focusItemId: focusItem?.id ?? null, history })
    setPending(false)
    if (!res.ok) {
      if ('flow' in res && res.flow) onAdopt(res.flow, [], [])
      setTurns(list => [...list, { id: newId(), role: 'nova', text: res.message, changed: [], proposals: [], question: null, error: true }])
      return
    }
    if (res.flow) onAdopt(res.flow, res.changed, res.touched)
    setTurns(list => [...list, { id: newId(), role: 'nova', text: res.reply, changed: res.changed, proposals: res.proposals.map(p => ({ ...p, state: 'open' as const })), question: res.question }])
  }

  async function confirm(turnId: string, index: number, p: CopilotProposal) {
    if (p.kind === 'task_delete' && confirmDelete !== `${turnId}:${index}`) { setConfirmDelete(`${turnId}:${index}`); return }
    setConfirmDelete(null)
    const done = await runTaskProposal(p, `today:${flow.day}:${turnId}:${index}`)
    setTurns(list => list.map(t => (t.id === turnId && t.role === 'nova' ? { ...t, proposals: t.proposals.map((x, k) => (k === index ? { ...x, state: done.ok ? 'done' : 'failed' } : x)) } : t)))
    if (done.ok) onReload()
  }
  const decline = (turnId: string, index: number) => setTurns(list => list.map(t => (t.id === turnId && t.role === 'nova' ? { ...t, proposals: t.proposals.map((x, k) => (k === index ? { ...x, state: 'declined' } : x)) } : t)))

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Nova, your day's copilot" data-copilot data-copilot-mode={mode}>
      <header className="flex shrink-0 items-center gap-2 border-b border-white/6 px-3.5 py-2.5">
        <span aria-hidden className="relative grid size-7 shrink-0 place-items-center rounded-full bg-nova/12 ring-1 ring-nova/30">
          {pending && <span className="absolute inset-0 rounded-full ring-2 ring-nova/40 kivo-node-pulse" />}
          <KivoMark size={14} className="text-nova-ink" />
        </span>
        <div role="tablist" aria-label="What Nova helps with" className="inline-flex rounded-lg bg-white/[0.04] p-0.5 text-xs">
          {(['plan', 'focus'] as const).map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)}
              className={cn('rounded-md px-2.5 py-1 font-medium transition-colors', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-foreground/55 hover:text-foreground')} data-copilot-tab={m}>
              {m === 'plan' ? 'Plan' : 'Focus'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {onClose && <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Hide Nova"><X className="size-4" /></button>}
      </header>
      <p className="shrink-0 px-3.5 pt-2 text-[11px] text-subtle" role="status">
        {pending ? 'Nova is reading your day…' : mode === 'plan' ? 'Changes to today’s flow apply at once, with Undo. Changes to a task itself wait for your yes.' : focusItem ? `Helping with ${focusItem.title}.` : 'Start something to focus on, or ask about anything you’re learning.'}
      </p>

      <div ref={log} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3" data-copilot-log>
        {turns.length === 0 && (
          <p className="text-sm leading-relaxed text-foreground/70">{mode === 'plan'
            ? 'Tell Nova what today is for, or what changed: “Move FastAPI to the top”, “I only have 45 minutes”, “Give me 20 minutes of revision first”.'
            : 'Ask about what you’re working on. Nova explains from its own knowledge and says when it isn’t sure.'}</p>
        )}
        {turns.map(t => t.role === 'learner' ? (
          <div key={t.id} className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.06] px-3 py-2 text-sm text-foreground" data-copilot-turn="learner">{t.text}</div>
        ) : (
          <div key={t.id} className="nova-reveal space-y-2 text-sm leading-relaxed text-foreground/85" data-copilot-turn="nova">
            {(t.question ?? t.text) && <p className={cn('whitespace-pre-wrap', t.error && 'text-amber-200')}>{t.question ?? t.text}</p>}
            {t.changed.length > 0 && (
              <div className="rounded-lg border-l-2 border-nova/50 bg-nova/[0.05] px-2.5 py-1.5 text-xs text-foreground/80" data-copilot-changed>
                {t.changed.map((c, k) => <p key={k} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-nova-ink" aria-hidden /> {c}</p>)}
                {t === turns.filter(x => x.role === 'nova' && x.changed.length).at(-1) && flow.canUndo && (
                  <button type="button" onClick={onUndo} className="mt-1 inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-copilot-undo><Undo2 className="size-3" /> Undo</button>
                )}
              </div>
            )}
            {t.proposals.map((p, k) => (
              <div key={k} className="rounded-lg border border-[color:var(--sem-warning,#e6b450)]/40 px-2.5 py-2 text-xs" data-copilot-proposal={p.kind}>
                <p className="font-medium text-foreground">{p.label}</p>
                {p.state === 'open' ? (
                  <div className="mt-1.5 flex gap-2">
                    <button type="button" onClick={() => void confirm(t.id, k, p)} className="rounded-md bg-action px-2 py-1 font-semibold text-action-foreground hover:bg-action-hover" data-proposal-confirm>
                      {p.kind === 'task_delete' && confirmDelete === `${t.id}:${k}` ? 'Yes, delete the task' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => decline(t.id, k)} className="rounded-md px-2 py-1 text-subtle hover:text-foreground">Not now</button>
                  </div>
                ) : <p className="mt-1 text-subtle">{p.state === 'done' ? 'Done.' : p.state === 'failed' ? 'That didn’t save. Nothing changed.' : 'Left as it is.'}</p>}
              </div>
            ))}
          </div>
        ))}
        {pending && <div className="space-y-2" aria-hidden><div className="h-3 w-3/4 animate-pulse rounded bg-white/6" /><div className="h-3 w-1/2 animate-pulse rounded bg-white/5" /></div>}
      </div>

      <div className="shrink-0 border-t border-white/6 px-3.5 pb-3 pt-2.5">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CHIPS[mode].map(c => <button key={c} type="button" disabled={pending} onClick={() => void send(c)} className="rounded-full border border-white/12 px-2.5 py-1 text-xs text-foreground/80 hover:border-nova/50 disabled:opacity-40" data-copilot-chip>{c}</button>)}
        </div>
        <form onSubmit={e => { e.preventDefault(); void send(input) }} className="flex items-end gap-2">
          <label htmlFor="copilot-input" className="sr-only">Tell Nova</label>
          <textarea id="copilot-input" ref={box} rows={1} value={input} maxLength={800} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
            placeholder={mode === 'plan' ? 'Change today, or ask what to do next…' : 'Ask about what you’re working on…'}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-white/10 bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-nova/60 focus:outline-none" data-copilot-input />
          <button type="submit" disabled={!input.trim() || pending} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-action text-action-foreground hover:bg-action-hover disabled:opacity-40" aria-label="Send">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-subtle"><Sparkles className="size-3" aria-hidden /> Nova changes only today’s flow by itself.</p>
      </div>
    </section>
  )
}

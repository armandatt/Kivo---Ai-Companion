'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUp, Check, CircleSlash, Loader2, PencilLine, RotateCcw } from 'lucide-react'
import type { BuilderMessage, DraftView } from '@repo/api/nova/product/builder.types'
import { planCounts } from '@repo/api/nova/product/workspace-plan'
import { KivoMark } from '@/components/brand/kivo-brand'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import type { DraftState } from './use-draft'

// The left half of Build with Nova: the conversation, what Nova is doing
// right now (from the server's job stage, never guessed), and the decisions
// that are the learner's: approve a version, retry, cancel.

export const STATUS_LABEL: Record<DraftView['status'], string> = {
  discovery: 'Talking it through', drafting: 'Writing a proposal', awaiting_approval: 'Waiting for your approval',
  building: 'Building', ready: 'Built', failed: 'Needs attention', cancelled: 'Cancelled',
}

export function NovaAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full bg-nova/12 ring-1 ring-nova/30', size === 'sm' ? 'size-7' : 'size-9')}>
      <KivoMark size={size === 'sm' ? 15 : 18} className="text-nova-ink" />
    </span>
  )
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000))
  return <span className="tabular-nums">{s}s</span>
}

function Working({ draft }: { draft: DraftView }) {
  const p = draft.pending
  if (draft.status === 'building') return <p role="status" className="flex items-center gap-2 text-sm text-foreground/70"><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Building your workspace…</p>
  if (!p) return null
  const text = p.stage === 'reading' ? 'Nova is reading your message' : p.kind === 'revise' ? 'Nova is writing the new version' : 'Nova is writing the proposal'
  return (
    <div role="status" className="flex items-start gap-3" data-pending={p.stage}>
      <NovaAvatar size="sm" />
      <div className="rounded-2xl rounded-tl-md bg-white/4 px-3.5 py-2.5 text-sm text-foreground/75">
        <p className="flex items-center gap-2"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> {text}… <span className="text-xs text-subtle"><Elapsed since={p.startedAt} /></span></p>
        {p.stage === 'writing' && <p className="mt-1 text-xs text-subtle">A full proposal can take up to a minute. You can keep reading or editing meanwhile.</p>}
      </div>
    </div>
  )
}

function Message({ m }: { m: BuilderMessage }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-action-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground">{m.text}</p>
      </div>
    )
  }
  if (m.kind === 'notice') return <p className="px-10 text-xs leading-relaxed text-subtle" data-kind="notice">{m.text}</p>
  return (
    <div className="flex items-start gap-3" data-kind={m.kind ?? 'chat'}>
      <NovaAvatar size="sm" />
      <div className={cn('max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[14px] leading-relaxed',
        m.kind === 'error' ? 'border border-red-400/25 bg-red-400/6 text-foreground/85' : 'bg-white/4 text-foreground/85')}>
        {(m.kind === 'proposal' || m.kind === 'revision' || m.kind === 'built') && m.version !== undefined && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-nova-ink">{m.kind === 'built' ? `Built from version ${m.version}` : `Proposal · version ${m.version}`}</p>
        )}
        <p className="whitespace-pre-wrap">{m.text}</p>
      </div>
    </div>
  )
}

function ApprovalCard({ state, onEdit, onDiscuss }: { state: DraftState; onEdit: () => void; onDiscuss: () => void }) {
  const { draft, plan, busy, save } = state
  const [confirmCancel, setConfirmCancel] = useState(false)
  if (!draft || !plan) return null
  const counts = planCounts(plan)
  const blocked = Boolean(busy) || save === 'saving' || state.working
  const first = draft.similar.length > 0 && !draft.target
  return (
    <section aria-labelledby="approval-title" className="rounded-2xl border border-nova/25 bg-nova/5 p-4" data-approval={draft.version}>
      <h2 id="approval-title" className="text-sm font-semibold text-foreground">Ready for your review · version {draft.version}</h2>
      <p className="mt-1 text-xs leading-relaxed text-foreground/70">
        {draft.target ? <>Adds to <span className="font-medium text-foreground">{draft.target.title}</span>: </> : 'Creates '}
        {[counts.subjects && `${counts.subjects} subject${counts.subjects === 1 ? '' : 's'}`, counts.topics && `${counts.topics} topics`, counts.tasks && `${counts.tasks} tasks`, counts.notes && `${counts.notes} notes`, counts.dates && `${counts.dates} date${counts.dates === 1 ? '' : 's'}`].filter(Boolean).join(', ')}.
        {' '}Nothing exists until you approve{draft.target ? ', and nothing already there is changed or removed' : ''}.
      </p>
      {first && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-xs" data-similar>
          <p className="font-medium text-foreground">You already have {draft.similar.length === 1 ? 'a workspace with this name' : 'workspaces like this'}: {draft.similar.map(w => w.title).join(', ')}.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.similar.slice(0, 2).map(w => (
              <button key={w.id} type="button" disabled={blocked} onClick={() => void state.approve({ addTo: w.id })} className={BUTTON_QUIET}>Add to {w.title}</button>
            ))}
            <button type="button" disabled={blocked} onClick={() => void state.approve({ confirmAnother: true })} className={BUTTON_QUIET}>Create a new one</button>
          </div>
          <p className="mt-2 text-subtle">Adding merges: nothing you have is changed or removed.</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!first && (
          <button type="button" onClick={() => void state.approve()} disabled={blocked} className={BUTTON_PRIMARY} data-approve>
            {busy === 'approve' ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Building…</> : save === 'saving' ? 'Saving your edits…' : <><Check aria-hidden className="size-4" /> Approve and build</>}
          </button>
        )}
        <button type="button" onClick={onEdit} className={BUTTON_QUIET}><PencilLine aria-hidden className="size-3.5" /> Edit proposal</button>
        <button type="button" onClick={onDiscuss} className={BUTTON_QUIET}>Discuss with Nova</button>
        {confirmCancel ? (
          <span className="flex items-center gap-2 text-xs text-foreground/75">Cancel this? Nothing has been created.
            <button type="button" onClick={() => { setConfirmCancel(false); void state.cancel() }} className={BUTTON_QUIET} data-confirm-cancel>Yes, cancel</button>
            <button type="button" onClick={() => setConfirmCancel(false)} className={BUTTON_QUIET}>Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmCancel(true)} disabled={blocked} className="ml-auto text-xs font-medium text-subtle underline-offset-4 hover:text-foreground hover:underline">Cancel</button>
        )}
      </div>
    </section>
  )
}

function FailureCard({ state }: { state: DraftState }) {
  const f = state.draft?.failure
  if (!f || state.working) return null
  return (
    <section role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-red-400/25 bg-red-400/5 p-4 text-sm" data-failure={f.stage}>
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-red-400" />
      <p className="min-w-0 flex-1 text-foreground/85">{f.message}</p>
      {f.stage === 'building'
        ? <button type="button" onClick={() => void state.approve()} disabled={Boolean(state.busy)} className={BUTTON_QUIET}><RotateCcw aria-hidden className="size-3.5" /> Approve again</button>
        : <button type="button" onClick={() => void state.retry()} disabled={Boolean(state.busy)} className={BUTTON_QUIET} data-retry><RotateCcw aria-hidden className="size-3.5" /> Try again</button>}
    </section>
  )
}

function BuiltCard({ draft, onImprove }: { draft: DraftView; onImprove: () => void }) {
  const w = draft.workspace
  if (!w) return null
  const first = w.subjects[0]
  return (
    <section role="status" className="rounded-2xl border border-action/30 bg-action-soft p-4" data-built>
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Check aria-hidden className="size-4 text-action-ink" /> {w.title} is in Kivo</p>
      <p className="mt-1 text-xs text-foreground/70">Its tasks are on your Planner board, its subjects in Knowledge, its notes in Notes and its dates on the calendar. Edit them on the right or where they live.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/planner?view=board" className={BUTTON_QUIET}>Planner board</Link>
        {first && <Link href={`/knowledge?subject=${first.id}`} className={BUTTON_QUIET}>Knowledge</Link>}
        <Link href="/notes" className={BUTTON_QUIET}>Notes</Link>
        <Link href="/home" className={BUTTON_QUIET}>Today</Link>
        <button type="button" onClick={onImprove} className={BUTTON_QUIET}>Improve it with Nova</button>
      </div>
    </section>
  )
}

export function Composer({ onSend, disabled, placeholder, inputRef, initial = '' }: {
  onSend: (text: string) => Promise<boolean>; disabled: boolean; placeholder: string; inputRef?: React.RefObject<HTMLTextAreaElement | null>; initial?: string
}) {
  const [text, setText] = useState(initial)
  const [sending, setSending] = useState(false)
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? own
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text, ref])
  async function submit() {
    const t = text.trim()
    if (!t || disabled || sending) return
    setSending(true)
    setText('')
    const ok = await onSend(t)
    setSending(false)
    // Not sent: their words come back.
    if (!ok) setText(t)
  }
  return (
    <form onSubmit={e => { e.preventDefault(); void submit() }} className="flex items-end gap-2 rounded-2xl border border-white/10 bg-card/80 p-2 focus-within:border-action/60">
      <label htmlFor="builder-composer" className="sr-only">Message Nova</label>
      <textarea id="builder-composer" ref={ref} value={text} rows={1} maxLength={2000} placeholder={placeholder}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() } }}
        className="max-h-44 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-subtle" />
      <button type="submit" disabled={disabled || sending || !text.trim()} aria-label="Send"
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ArrowUp aria-hidden className="size-4" />}
      </button>
    </form>
  )
}

export function Conversation({ state, onEdit, onImprove, onNew, header }: {
  state: DraftState; onEdit: () => void; onImprove: () => void; onNew: () => void; header: React.ReactNode
}) {
  const { draft } = state
  const end = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const count = draft?.messages.length ?? 0
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [count, draft?.pending?.stage, draft?.status])

  const talking = draft && ['discovery', 'awaiting_approval', 'failed', 'drafting'].includes(draft.status)
  const placeholder = !draft ? '' : state.working ? 'Nova is working…' : draft.plan ? 'Ask for a change, or ask Nova anything…' : 'Tell Nova about it…'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5" aria-live="polite" aria-label="Conversation with Nova">
        {draft && draft.messages.length === 0 && !draft.pending && (
          <div className="flex items-start gap-3"><NovaAvatar size="sm" /><p className="rounded-2xl rounded-tl-md bg-white/4 px-3.5 py-2.5 text-[14px] text-foreground/85">{draft.target ? `What would you like to change or add in ${draft.target.title}? I'll only add to it: nothing there is changed or removed.` : 'What are you working on, and what would you like to end up with?'}</p></div>
        )}
        {draft?.messages.map(m => <Message key={m.id} m={m} />)}
        {draft && <Working draft={draft} />}
        <div ref={end} />
      </div>
      <div className="space-y-3 border-t border-white/8 p-3 sm:p-4">
        {draft && <FailureCard state={state} />}
        {draft?.status === 'awaiting_approval' && !state.working && <ApprovalCard state={state} onEdit={onEdit} onDiscuss={() => composer.current?.focus()} />}
        {draft?.status === 'ready' && <BuiltCard draft={draft} onImprove={onImprove} />}
        {draft?.status === 'cancelled' && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-foreground/70"><CircleSlash aria-hidden className="size-4" /> Cancelled. Nothing was created.
            <button type="button" onClick={onNew} className={BUTTON_QUIET}>Start a new conversation</button></p>
        )}
        {state.actionError && <p role="alert" className="text-sm text-red-400">{state.actionError}</p>}
        {talking && <Composer onSend={state.send} disabled={state.working || state.busy === 'approve'} placeholder={placeholder} inputRef={composer} />}
      </div>
    </div>
  )
}

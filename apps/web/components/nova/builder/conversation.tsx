'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Check, CircleSlash, FileText, ImageIcon, LayoutTemplate, Loader2, Paperclip, RotateCcw, X } from 'lucide-react'
import { FILE_TYPES, FILES_MAX, FILES_TOTAL_BYTES, encodeFile } from '@/components/nova/templates/templates-api'
import type { BuilderMessage, DraftListItem, DraftView } from '@repo/api/nova/product/builder.types'
import type { WorkspaceSummary } from '@repo/api/nova/product/workspaces.types'
import { KivoMark } from '@/components/brand/kivo-brand'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { messageBlocks, wordsFor, type Inline } from './builder-view'
import type { DraftState } from './use-draft'

// The left half of Build with Nova: the conversation, and what Nova is
// doing right now (from the server's job stage, never guessed). The
// decisions about a proposal (approve, edit, discard) are on the playground's
// bottom bar, not here.
//
// Nova's replies are not streamed: the server writes each one whole. A reply
// that arrives while the page is open is drawn in quickly, word by word, and
// at once for a learner who asked their device for less motion.

export const STATUS_LABEL: Record<DraftView['status'], string> = {
  discovery: 'Talking it through', drafting: 'Writing a proposal', awaiting_approval: 'Waiting for your approval',
  building: 'Building', ready: 'Built', failed: 'Needs attention', cancelled: 'Cancelled',
}

export const BUILD_EXAMPLES = [
  'Plan my semester exams',
  'Build a roadmap for my project',
  'Organise my learning goals',
  "I'm building an app and need a plan to ship it",
  'I have a work deadline in three weeks',
]

const REVEAL_MS_PER_WORD = 22
const REVEAL_MAX_MS = 1100

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

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ── Nova's words ──────────────────────────────────────────────────────────────

function Spans({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => (p.strong ? <strong key={i} className="font-semibold text-foreground">{p.text}</strong> : <span key={i}>{p.text}</span>))}</>
}

export function FormattedText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {messageBlocks(text).map((b, i) => b.type === 'p'
        ? <p key={i}>{b.lines.map((l, k) => <span key={k}>{k > 0 && <br />}<Spans parts={l} /></span>)}</p>
        : b.type === 'ul'
          ? <ul key={i} className="space-y-1 pl-1">{b.items.map((it, k) => <li key={k} className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-nova-ink" /><span><Spans parts={it} /></span></li>)}</ul>
          : <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-subtle">{b.items.map((it, k) => <li key={k}><Spans parts={it} /></li>)}</ol>)}
    </div>
  )
}

// A finished reply drawn in word by word, fast. The whole text is announced
// once by the page's live region, not word by word.
function RevealText({ text }: { text: string }) {
  const words = useRef(text.split(' '))
  const [shown, setShown] = useState(() => (reducedMotion() ? words.current.length : 0))
  useEffect(() => {
    const total = words.current.length
    if (shown >= total) return
    const duration = Math.min(REVEAL_MAX_MS, total * REVEAL_MS_PER_WORD)
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const n = Math.min(total, Math.ceil(((now - start) / duration) * total))
      setShown(n)
      if (n < total) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // Runs once per message: the text of a stored message does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div aria-hidden={shown < words.current.length}><FormattedText text={words.current.slice(0, shown).join(' ')} /></div>
}

function Files({ files }: { files: NonNullable<BuilderMessage['files']> }) {
  return (
    <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5" aria-label="Shared files">
      {files.map(f => (
        <li key={f.name} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-card px-2 py-1 text-xs text-foreground/85" data-shared={f.name}>
          <FileText aria-hidden className="size-3.5 text-action-ink" /><span className="max-w-56 truncate">{f.name}</span>{f.pages ? <span className="text-subtle">{f.pages} pages</span> : null}
        </li>
      ))}
    </ul>
  )
}

function UserMessage({ text, files, sending }: { text: string; files?: BuilderMessage['files']; sending?: boolean }) {
  return (
    <div className={cn('flex flex-col items-end gap-1.5', sending && 'opacity-70')} data-role="user">
      {files && files.length > 0 && <Files files={files} />}
      {text && <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-action-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground">{text}</p>}
      {sending && <span className="flex items-center gap-1 text-[11px] text-subtle"><Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" /> Sending</span>}
    </div>
  )
}

function Message({ m, fresh }: { m: BuilderMessage; fresh: boolean }) {
  if (m.role === 'user') return <UserMessage text={m.text} files={m.files} />
  if (m.kind === 'notice') return <p className="px-10 text-xs leading-relaxed text-subtle" data-kind="notice">{m.text}</p>
  const tag = (m.kind === 'proposal' || m.kind === 'revision' || m.kind === 'built') && m.version !== undefined
    ? (m.kind === 'built' ? `Built from version ${m.version}` : `${m.kind === 'revision' ? 'New version' : 'Proposal'} · v${m.version} on the right`) : null
  return (
    <div className={cn('flex items-start gap-3', fresh && 'nova-rise')} data-kind={m.kind ?? 'chat'}>
      <NovaAvatar size="sm" />
      <div className="min-w-0 max-w-[88%] flex-1">
        <p className="mb-1 text-xs font-semibold text-foreground/80">Nova</p>
        <div className={cn('text-[14px] leading-relaxed text-foreground/85', m.kind === 'error' && 'rounded-xl border border-red-400/25 bg-red-400/6 px-3 py-2')}>
          {tag && <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-nova/10 px-2 py-0.5 text-[11px] font-medium text-nova-ink"><Check aria-hidden className="size-3" /> {tag}</p>}
          {fresh ? <RevealText text={m.text} /> : <FormattedText text={m.text} />}
        </div>
      </div>
    </div>
  )
}

// What Nova is doing, step by step, as far as the server says it has got.
function Working({ draft }: { draft: DraftView }) {
  const p = draft.pending
  const words = wordsFor(draft.brief.kind)
  const steps: Array<{ label: string; done: boolean }> =
    draft.status === 'building' ? [{ label: 'Creating your workspace in Kivo', done: false }]
    : !p ? []
    : p.stage === 'reading' ? [{ label: draft.files.length ? 'Reading your message and files' : 'Reading your message', done: false }]
    : [{ label: 'Read your message', done: true }, { label: p.kind === 'revise' ? words.revising : words.writing, done: false }]
  if (steps.length === 0) return null
  return (
    <div role="status" className="flex items-start gap-3" data-pending={p?.stage ?? 'building'}>
      <NovaAvatar size="sm" />
      <div className="min-w-0 flex-1 pt-0.5">
        <ul className="space-y-1.5 text-[13px]">
          {steps.map(s => (
            <li key={s.label} className={cn('flex items-center gap-2', s.done ? 'text-subtle' : 'text-foreground/85')}>
              {s.done ? <Check aria-hidden className="size-3.5 text-action-ink" /> : <Loader2 aria-hidden className="size-3.5 animate-spin text-nova-ink motion-reduce:animate-none" />}
              {s.label}{!s.done && '…'}
              {!s.done && p && <span className="text-xs text-subtle"><Elapsed since={p.startedAt} /></span>}
            </li>
          ))}
        </ul>
        {p?.stage === 'writing' && <p className="mt-1.5 text-xs text-subtle">It appears on the right when it&apos;s ready, usually within a minute. You can keep reading meanwhile.</p>}
      </div>
    </div>
  )
}

function FailureCard({ state }: { state: DraftState }) {
  const f = state.draft?.failure
  // A failed build is the playground's to show, beside approval.
  if (!f || f.stage === 'building' || state.working) return null
  return (
    <section role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/5 p-3 text-sm" data-failure={f.stage}>
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-red-400" />
      <p className="min-w-0 flex-1 text-foreground/85">{f.message}</p>
      <button type="button" onClick={() => void state.retry()} disabled={Boolean(state.busy)} className={BUTTON_QUIET} data-retry><RotateCcw aria-hidden className="size-3.5" /> Try again</button>
    </section>
  )
}

// ── The composer ──────────────────────────────────────────────────────────────

// A file chosen in the composer, encoded for the request.
export type Upload = { name: string; data: string; size: number; type: string }
// Text put in the message box from elsewhere on the page (a hint, an
// example, a suggestion); n changes each time, so the same text can be put twice.
export type Seed = { text: string; n: number }

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp'
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function Composer({ onSend, disabled, placeholder, seed, hint }: {
  onSend: (text: string, files: Upload[]) => Promise<boolean>; disabled: boolean; placeholder: string; seed?: Seed | null; hint?: React.ReactNode
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Upload[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  // Put in, focused, with the caret at the end; never sent from here.
  useEffect(() => {
    if (!seed) return
    if (seed.text) setText(seed.text)
    const el = ref.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => { const n = el.value.length; el.setSelectionRange(n, n) })
  }, [seed])

  // Checked here only to save a wasted upload; the server checks the bytes.
  async function add(list: FileList | File[]) {
    setFileError(null)
    const next = [...files]
    for (const f of Array.from(list)) {
      if (!FILE_TYPES.includes(f.type)) { setFileError(`${f.name} isn't a PDF or a PNG, JPEG or WebP image.`); continue }
      if (next.length >= FILES_MAX) { setFileError(`Up to ${FILES_MAX} files with one message.`); break }
      if (next.reduce((n, x) => n + x.size, 0) + f.size > FILES_TOTAL_BYTES) { setFileError('Files with one message can add up to 3 MB.'); continue }
      const encoded = await encodeFile(f)
      next.push({ ...encoded, size: f.size, type: f.type })
    }
    setFiles(next)
  }

  async function submit() {
    const t = text.trim()
    if ((!t && files.length === 0) || disabled || sending) return
    setSending(true)
    const sent = files
    setText(''); setFiles([])
    const ok = await onSend(t, sent)
    setSending(false)
    // Not sent: their words and files come back.
    if (!ok) { setText(t); setFiles(sent) }
  }
  return (
    <form onSubmit={e => { e.preventDefault(); void submit() }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); void add(e.dataTransfer.files) } }}
      className={cn('rounded-2xl border bg-background/70 p-1.5 shadow-soft transition-colors focus-within:border-action/60', dragging ? 'border-dashed border-action' : 'border-white/12')} data-composer>
      {files.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5 px-1.5 pt-1" aria-label="Files to send">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 py-1 pl-2 pr-1 text-xs text-foreground/85" data-upload={f.name}>
              {f.type === 'application/pdf' ? <FileText aria-hidden className="size-3.5 text-action-ink" /> : <ImageIcon aria-hidden className="size-3.5 text-action-ink" />}
              <span className="max-w-48 truncate">{f.name}</span><span className="text-subtle">{kb(f.size)}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="grid size-5 place-items-center rounded text-foreground/55 hover:bg-white/8 hover:text-foreground"><X aria-hidden className="size-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="builder-composer" className="sr-only">Message Nova</label>
      <textarea id="builder-composer" ref={ref} value={text} rows={1} maxLength={2000} placeholder={files.length ? 'Say what to do with it, or just send' : placeholder}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() } }}
        className="block max-h-44 min-h-11 w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-subtle" />
      <div className="flex items-center gap-1">
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={e => { if (e.target.files) void add(e.target.files); e.target.value = '' }} data-file-input />
        <button type="button" onClick={() => picker.current?.click()} disabled={disabled || sending} aria-label="Attach a PDF or photo" title="Attach a PDF or photo"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground/60 transition-colors hover:bg-white/6 hover:text-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring">
          <Paperclip aria-hidden className="size-4" /><span className="hidden sm:inline">PDF or photo</span>
        </button>
        <span className="hidden min-w-0 flex-1 truncate text-[11px] text-subtle sm:block">{hint ?? 'Enter to send · Shift+Enter for a new line'}</span>
        <button type="submit" disabled={disabled || sending || (!text.trim() && files.length === 0)} aria-label="Send"
          className="ml-auto grid size-8 shrink-0 place-items-center rounded-lg bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ArrowUp aria-hidden className="size-4" />}
        </button>
      </div>
      {fileError && <p role="alert" className="px-2 pb-1 pt-1 text-xs text-red-400">{fileError}</p>}
    </form>
  )
}

// ── Scrolling ─────────────────────────────────────────────────────────────────

// Follows new content only while the learner is at the bottom; reading
// further up, they get a button instead of being moved.
function useFollow() {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [behind, setBehind] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      if (pinned.current) setBehind(false)
    }
    const follow = new MutationObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
      else setBehind(true)
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    follow.observe(el, { childList: true, subtree: true, characterData: true })
    el.scrollTop = el.scrollHeight
    return () => { el.removeEventListener('scroll', onScroll); follow.disconnect() }
  }, [])
  const toEnd = () => { const el = box.current; if (el) { el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' }); pinned.current = true; setBehind(false) } }
  return { box, behind, toEnd }
}

// ── The conversation of a draft ───────────────────────────────────────────────

export function Conversation({ state, header, seed, onReview }: {
  state: DraftState; header: React.ReactNode; seed: Seed | null; onReview: () => void
}) {
  const { draft } = state
  const { box, behind, toEnd } = useFollow()
  // Messages there when the page opened are drawn as they are; later ones come in.
  const seen = useRef<Set<string> | null>(null)
  if (draft && !seen.current) seen.current = new Set(draft.messages.map(m => m.id))
  const [outgoing, setOutgoing] = useState<{ text: string; files: Upload[] } | null>(null)

  const talking = draft && ['discovery', 'awaiting_approval', 'failed', 'drafting'].includes(draft.status)
  const placeholder = !draft ? '' : state.working ? 'Nova is working…' : draft.plan ? 'Ask for a change, or ask Nova anything…' : 'Tell Nova about it…'
  const lastNova = draft ? [...draft.messages].reverse().find(m => m.role === 'nova') : undefined
  const reviewable = draft && draft.plan && (draft.status === 'awaiting_approval' || draft.status === 'ready' || draft.status === 'building')

  const send = async (text: string, files: Upload[]) => {
    setOutgoing({ text, files })
    toEnd()
    const ok = await state.send(text, files)
    setOutgoing(null)
    return ok
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {header}
      <div ref={box} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5" aria-label="Conversation with Nova">
        {draft && draft.messages.length === 0 && !draft.pending && (
          <div className="flex items-start gap-3"><NovaAvatar size="sm" /><div className="pt-0.5 text-[14px] leading-relaxed text-foreground/85"><p className="mb-1 text-xs font-semibold text-foreground/80">Nova</p>{draft.target ? `What would you like to add to ${draft.target.title}? I'll only add to it: nothing there is changed or removed.` : 'What are you working on, and what would you like to end up with?'}</div></div>
        )}
        {draft?.messages.map(m => <Message key={m.id} m={m} fresh={m.role === 'nova' && !seen.current?.has(m.id)} />)}
        {outgoing && <UserMessage text={outgoing.text} files={outgoing.files.map(f => ({ name: f.name, pages: null }))} sending />}
        {draft && <Working draft={draft} />}
      </div>
      {/* The whole reply, said once to a screen reader. */}
      <p className="sr-only" aria-live="polite">{lastNova?.text ?? ''}</p>
      {behind && (
        <button type="button" onClick={toEnd} className="absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/12 bg-card px-3 py-1 text-xs font-medium text-foreground/85 shadow-soft">
          <ArrowDown aria-hidden className="size-3.5" /> New message
        </button>
      )}
      <div className="shrink-0 space-y-2.5 border-t border-white/8 p-3 sm:p-4">
        {draft && <FailureCard state={state} />}
        {reviewable && (
          <button type="button" onClick={onReview} className="flex w-full items-center justify-between gap-2 rounded-xl border border-nova/25 bg-nova/5 px-3 py-2 text-left text-sm font-medium text-foreground lg:hidden" data-review>
            <span>{draft.status === 'ready' ? 'Open your workspace' : draft.status === 'building' ? 'Building version ' + draft.version + '…' : `Review version ${draft.version} and approve`}</span>
            <ArrowRight aria-hidden className="size-4 text-nova-ink" />
          </button>
        )}
        {draft?.status === 'cancelled' && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-foreground/70"><CircleSlash aria-hidden className="size-4" /> Discarded. Nothing was created.
            <Link href="/build" className={BUTTON_QUIET}>Start a new conversation</Link></p>
        )}
        {state.actionError && (state.errorOf === 'send' || state.errorOf === 'retry') && <p role="alert" className="text-sm text-red-400">{state.actionError}</p>}
        {talking && <Composer onSend={send} disabled={state.working || state.busy === 'approve'} placeholder={placeholder} seed={seed} />}
      </div>
    </div>
  )
}

// ── Before there is a conversation ────────────────────────────────────────────

export function NewConversation({ header, onStart, busy, error, seed, onExample, drafts, workspaces }: {
  header: React.ReactNode; onStart: (text: string, targetWorkspaceId?: string, files?: Upload[]) => Promise<boolean>; busy: boolean; error: string | null
  seed: Seed | null; onExample: (text: string) => void; drafts: DraftListItem[]; workspaces: WorkspaceSummary[]
}) {
  const open = drafts.filter(d => d.status !== 'ready' && d.status !== 'cancelled').slice(0, 3)
  const [outgoing, setOutgoing] = useState<string | null>(null)
  const start = async (text: string, files: Upload[]) => {
    setOutgoing(text || files.map(f => f.name).join(', '))
    const ok = await onStart(text, undefined, files)
    if (!ok) setOutgoing(null)
    return ok
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-build-start>
      {header}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-5">
        <div className="flex items-start gap-3">
          <NovaAvatar />
          <div className="min-w-0 pt-0.5">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">What would you like to build?</h1>
            <p className="mt-1 text-[14px] leading-relaxed text-foreground/70">Tell me about an exam, a project, a skill or something at work. I&apos;ll ask what I need, then propose a workspace on the right that you can edit. Nothing is created until you approve it.</p>
          </div>
        </div>
        {outgoing !== null ? <UserMessage text={outgoing} sending /> : (
          <div>
            <p className="mb-2 text-xs font-medium text-subtle">Try one of these</p>
            <ul className="grid gap-1.5">
              {BUILD_EXAMPLES.map(e => (
                <li key={e}><button type="button" onClick={() => onExample(e)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/8 px-3 py-2 text-left text-sm text-foreground/80 transition-colors hover:border-nova/35 hover:bg-nova/5 hover:text-foreground">
                  {e}<ArrowUp aria-hidden className="size-3.5 rotate-45 text-subtle" /></button></li>
              ))}
            </ul>
          </div>
        )}
        {open.length > 0 && outgoing === null && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-subtle">Continue a conversation</p>
            <ul className="space-y-0.5">{open.map(d => (
              <li key={d.id}><Link href={`/build?draft=${encodeURIComponent(d.id)}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground/80 hover:bg-white/4">
                <span className="truncate">{d.title ?? 'Untitled conversation'}</span><span className="shrink-0 text-xs text-subtle">{STATUS_LABEL[d.status]}</span></Link></li>
            ))}</ul>
          </div>
        )}
        {workspaces.length > 0 && outgoing === null && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-subtle">Add to a workspace you have</p>
            <ul className="flex flex-wrap gap-1.5">{workspaces.slice(0, 4).map(w => (
              <li key={w.id}><button type="button" disabled={busy} onClick={() => void onStart('', w.id)} className={BUTTON_QUIET}>{w.title}</button></li>
            ))}</ul>
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-white/8 p-3 sm:p-4">
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Composer onSend={start} disabled={busy} seed={seed} placeholder="e.g. I'm building TrackerX, a project tracker for small teams" hint="Attach a syllabus, notes or a photo of a plan (up to 3 MB)" />
        <p className="text-center text-[11px] text-subtle"><Link href="/templates" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"><LayoutTemplate aria-hidden className="size-3" /> Prefer a ready-made start? Browse templates</Link></p>
      </div>
    </div>
  )
}

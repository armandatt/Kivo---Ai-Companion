'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MessageSquare, PanelsTopLeft, Plus } from 'lucide-react'
import type { DraftListItem } from '@repo/api/nova/product/builder.types'
import type { WorkspaceSummary } from '@repo/api/nova/product/workspaces.types'
import { PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { loadWorkspaces } from '@/components/nova/templates/templates-api'
import * as api from './builder-api'
import { mapDestinations, touchedSubjects, wordsFor } from './builder-view'
import { BUILD_EXAMPLES, Composer, Conversation, NewConversation, NovaAvatar, STATUS_LABEL, type Seed, type Upload } from './conversation'
import { LiveWorkspace } from './live-workspace'
import { DraftPlayground, PlaygroundHeader, PlaygroundWaiting } from './playground'
import type { PlaygroundView } from './plan-edit'
import { useDraft } from './use-draft'

// Build with Nova: a conversation on the left, the workspace it shapes on
// the right, from the first screen on. On a phone the two are tabs. The
// address names the draft (?draft=<id>), so a refresh, the back button or a
// link from Telegram opens the same conversation; /build alone is a new one.

const SPLIT_KEY = 'kivo-build-split'
const SPLIT_MIN = 32, SPLIT_MAX = 64, SPLIT_DEFAULT = 42

function readSplit(): number {
  try { const v = Number(localStorage.getItem(SPLIT_KEY)); return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT } catch { return SPLIT_DEFAULT }
}

// A first step toward Build with Nova from elsewhere (Today's first run):
// say anything, and the conversation opens on /build.
export function BuildStart({ onStart, busy, error, compact = false }: {
  onStart: (text: string, targetWorkspaceId?: string, files?: Upload[]) => Promise<boolean>; workspaces: WorkspaceSummary[]; drafts: DraftListItem[]
  busy: boolean; error: string | null; compact?: boolean
}) {
  const [seed, setSeed] = useState<Seed | null>(null)
  return (
    <div className={cn('space-y-5', compact ? '' : 'mx-auto max-w-xl')} data-build-start>
      <div className="flex items-start gap-3">
        <NovaAvatar />
        <div>
          <h1 className={cn('font-semibold tracking-tight text-foreground', compact ? 'text-xl' : 'text-2xl')}>What would you like to build?</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-foreground/70">Start with a rough idea: an exam, a project, a skill or something at work. Nova asks what it needs, proposes a workspace you can edit, and builds nothing until you approve it.</p>
        </div>
      </div>
      <Composer seed={seed} onSend={(text, files) => onStart(text, undefined, files)} disabled={busy} placeholder="e.g. I'm building TrackerX, a project tracker for small teams" />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {BUILD_EXAMPLES.slice(0, 3).map(e => (
          <li key={e}><button type="button" onClick={() => setSeed(s => ({ text: e, n: (s?.n ?? 0) + 1 }))} className="rounded-full border border-white/10 px-3 py-1 text-xs text-foreground/75 transition-colors hover:border-white/25 hover:text-foreground">{e}</button></li>
        ))}
      </ul>
    </div>
  )
}

function ConversationHeader({ title, status, drafts, current, onNew }: { title: string; status: string | null; drafts: DraftListItem[]; current: string | null; onNew: (() => void) | null }) {
  const router = useRouter()
  const others = drafts.filter(d => d.status !== 'cancelled')
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/8 px-4 py-2.5 sm:px-5">
      <NovaAvatar size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {status && <p className="truncate text-xs text-subtle">{status}</p>}
      </div>
      {others.length > 0 && (
        <label className="hidden sm:block">
          <span className="sr-only">Switch conversation</span>
          <select value={current ?? ''} onChange={e => router.push(e.target.value ? `/build?draft=${encodeURIComponent(e.target.value)}` : '/build')}
            className="h-8 max-w-44 rounded-lg border border-white/10 bg-background px-2 text-xs text-foreground/80">
            {!current && <option value="">New conversation</option>}
            {others.map(d => <option key={d.id} value={d.id}>{d.title ?? 'Untitled'} — {STATUS_LABEL[d.status]}</option>)}
          </select>
        </label>
      )}
      {onNew && <button type="button" onClick={onNew} className={BUTTON_QUIET} aria-label="New conversation"><Plus aria-hidden className="size-3.5" /> New</button>}
    </div>
  )
}

export function BuilderPage() {
  const params = useSearchParams()
  const router = useRouter()
  const draftId = params.get('draft')
  // "Improve with Nova" on a workspace: a conversation about that one.
  const improve = params.get('improve')
  const state = useDraft(draftId)
  const { draft } = state
  const [drafts, setDrafts] = useState<DraftListItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [tab, setTab] = useState<'chat' | 'playground'>('chat')
  const [view, setView] = useState<PlaygroundView>('overview')
  const [split, setSplit] = useState(SPLIT_DEFAULT)
  const [seed, setSeed] = useState<Seed | null>(null)
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => { setSplit(readSplit()) }, [])
  const loadLists = useCallback(() => {
    void api.listDrafts().then(r => { if ('status' in r) setDrafts(r.drafts) })
    void loadWorkspaces().then(r => { if ('status' in r) setWorkspaces(r.workspaces) })
  }, [])
  useEffect(() => { loadLists() }, [loadLists, draftId, draft?.status, draft?.title])

  // Approved here and stored: the Knowledge Map, on what was built or
  // changed. Only once the server says it is saved (status ready, read back
  // from the records); a failed build stays here with its error. With several
  // subjects there is no one place to go: the bar offers each.
  const approving = useRef<string[] | null>(null)
  useEffect(() => {
    // Changes to something they have are seen where they were made: those subjects.
    if (state.busy === 'approve') { approving.current ??= touchedSubjects(draft); return }
    if (!approving.current || state.busy) return
    const touched = approving.current
    approving.current = null
    const places = mapDestinations(draft, touched)
    if (places.length === 1) router.push(places[0]!.href)
  }, [state.busy, draft, router])
  // A new conversation starts on the conversation, at the overview.
  useEffect(() => { setTab('chat'); setView('overview'); setStartError(null) }, [draftId])

  // Something to say to Nova, put in the message box (never sent from here).
  const ask = useCallback((text: string) => { setTab('chat'); setSeed(s => ({ text, n: (s?.n ?? 0) + 1 })) }, [])

  // A new proposal or version: the playground tab says so on a phone.
  const seen = useRef(0)
  const fresh = Boolean(draft?.plan) && (draft?.version ?? 0) > seen.current && tab === 'chat'
  useEffect(() => { if (tab === 'playground' && draft) seen.current = draft.version }, [tab, draft])

  const start = useCallback(async (text: string, targetWorkspaceId?: string, files: Upload[] = []) => {
    setStarting(true); setStartError(null)
    const res = await api.startDraft({ clientKey: api.newClientKey(), ...(text ? { text } : {}), ...(files.length ? { files: files.map(f => ({ name: f.name, data: f.data })) } : {}), ...(targetWorkspaceId ? { targetWorkspaceId } : {}) })
    setStarting(false)
    if (!res.ok) { setStartError(res.message); return false }
    router.push(`/build?draft=${encodeURIComponent(res.draft.id)}`)
    return true
  }, [router])

  const improving = useRef<string | null>(null)
  useEffect(() => {
    if (!improve || draftId || improving.current === improve) return
    improving.current = improve
    void start('', improve)
  }, [improve, draftId, start])

  const setAndKeep = (next: number) => {
    const v = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, Math.round(next)))
    setSplit(v)
    try { localStorage.setItem(SPLIT_KEY, String(v)) } catch { /* a convenience only */ }
  }
  const drag = (e: React.PointerEvent) => {
    const box = grid.current?.getBoundingClientRect()
    if (!box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setAndKeep(((ev.clientX - box.left) / box.width) * 100)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (draftId && state.loadError && !draft) {
    return (
      <div className="mx-auto max-w-xl pt-12">
        <PageNotice tone="error" title="This conversation didn't open" action={<RetryButton onRetry={() => void state.reload()} />}>
          {state.loadError} <Link href="/build" className="underline underline-offset-4">Start a new one</Link>
        </PageNotice>
      </div>
    )
  }

  const onNew = () => router.push('/build')
  let conversation: React.ReactNode
  let playground: React.ReactNode
  if (!draftId) {
    const header = <ConversationHeader title="New conversation" status={null} drafts={drafts} current={null} onNew={null} />
    conversation = <NewConversation header={header} onStart={start} busy={starting} error={startError} seed={seed} onExample={ask} drafts={drafts} workspaces={workspaces} onDeleted={loadLists} />
    playground = (
      <div className="flex h-full min-h-0 flex-col">
        <PlaygroundHeader title="Your workspace" badge="draft" />
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><PlaygroundWaiting draft={null} words={wordsFor(null)} /></div>
      </div>
    )
  } else {
    const title = draft?.title ?? draft?.target?.title ?? 'New conversation'
    const header = <ConversationHeader title={title} status={draft ? STATUS_LABEL[draft.status] : null} drafts={drafts} current={draftId} onNew={onNew} />
    conversation = draft
      ? <Conversation key={draftId} state={state} header={header} seed={seed} onReview={() => setTab('playground')} />
      : <div aria-busy="true" aria-label="Opening the conversation" className="space-y-3 p-5"><div className="h-10 animate-pulse rounded-xl bg-white/4 motion-reduce:animate-none" /><div className="h-24 animate-pulse rounded-2xl bg-white/4 motion-reduce:animate-none" /></div>
    // Something stored (what it works on, or what it built): shown as it is, with any proposed changes on it.
    playground = draft?.current && (draft.resource || draft.status === 'ready')
      ? <LiveWorkspace view={view} onView={setView} state={state} onAsk={ask} />
      : <DraftPlayground state={state} view={view} onView={setView} onAsk={ask} />
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-[32rem] flex-col pt-10 lg:pt-0" data-builder={draftId ? draft?.status ?? 'loading' : 'new'}>
      {/* Phones: one panel at a time. */}
      <div role="tablist" aria-label="Build with Nova" className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-card/50 p-1 lg:hidden">
        {(['chat', 'playground'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('relative flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium', tab === t ? 'bg-white/8 text-foreground' : 'text-foreground/60')}>
            {t === 'chat' ? <MessageSquare aria-hidden className="size-4" /> : <PanelsTopLeft aria-hidden className="size-4" />}
            {t === 'chat' ? 'Conversation' : 'Playground'}
            {t === 'playground' && fresh && <span className="absolute right-3 top-2 size-2 rounded-full bg-nova" aria-label="New proposal" />}
          </button>
        ))}
      </div>
      <div ref={grid} className="grid min-h-0 flex-1 grid-cols-1 lg:[grid-template-columns:var(--split)_10px_minmax(0,1fr)]" style={{ ['--split' as string]: `${split}%` }}>
        <section aria-label="Conversation" className={cn('min-h-0 overflow-hidden rounded-2xl border border-white/8 bg-card/40', tab === 'chat' ? 'flex flex-col' : 'hidden', 'lg:flex lg:flex-col')}>
          {conversation}
        </section>
        <div role="separator" aria-orientation="vertical" aria-label="Resize the conversation and the playground" aria-valuenow={split} aria-valuemin={SPLIT_MIN} aria-valuemax={SPLIT_MAX} tabIndex={0}
          onPointerDown={drag} onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); setAndKeep(split - 2) } if (e.key === 'ArrowRight') { e.preventDefault(); setAndKeep(split + 2) } }}
          className="group hidden cursor-col-resize items-center justify-center focus-visible:outline-none lg:flex">
          <span aria-hidden className="h-12 w-1 rounded-full bg-white/10 transition-colors group-hover:bg-white/25 group-focus-visible:bg-action" />
        </div>
        <section aria-label="Playground" className={cn('min-h-0 overflow-hidden rounded-2xl border border-white/8 bg-card/40', tab === 'playground' ? 'flex flex-col' : 'hidden', 'lg:flex lg:flex-col')}>
          {playground}
        </section>
      </div>
    </div>
  )
}

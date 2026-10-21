'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutTemplate, MessageSquare, PanelsTopLeft, Plus } from 'lucide-react'
import type { DraftListItem } from '@repo/api/nova/product/builder.types'
import type { WorkspaceSummary } from '@repo/api/nova/product/workspaces.types'
import { PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { loadWorkspaces } from '@/components/nova/templates/templates-api'
import * as api from './builder-api'
import { Composer, Conversation, NovaAvatar, STATUS_LABEL } from './conversation'
import { LiveWorkspace } from './live-workspace'
import { DraftPlayground } from './playground'
import type { PlaygroundView } from './plan-edit'
import { useDraft } from './use-draft'

// Build with Nova: a conversation on the left, the workspace it shapes on
// the right. On a phone the two are tabs. The address names the draft
// (?draft=<id>), so a refresh, the back button or a link from Telegram opens
// the same conversation.

const SPLIT_KEY = 'kivo-build-split'
const SPLIT_MIN = 32, SPLIT_MAX = 64, SPLIT_DEFAULT = 42

export const BUILD_EXAMPLES = [
  "I'm building a project and need a plan to finish it",
  'I need to prepare for an exam',
  'Help me organise my semester',
  'I want a roadmap to learn a new skill',
  'I have a work deadline in three weeks',
  "I already have a plan, but it isn't working",
]

function readSplit(): number {
  try { const v = Number(localStorage.getItem(SPLIT_KEY)); return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT } catch { return SPLIT_DEFAULT }
}

// The first screen: say anything, or improve something already built.
export function BuildStart({ onStart, workspaces, drafts, busy, error, compact = false }: {
  onStart: (text: string, targetWorkspaceId?: string) => Promise<boolean>; workspaces: WorkspaceSummary[]; drafts: DraftListItem[]
  busy: boolean; error: string | null; compact?: boolean
}) {
  const [seed, setSeed] = useState('')
  const [key, setKey] = useState(0)
  const open = drafts.filter(d => d.status !== 'ready').slice(0, 4)
  return (
    <div className={cn('space-y-6', compact ? '' : 'mx-auto max-w-xl')} data-build-start>
      <div className="flex items-start gap-3">
        <NovaAvatar />
        <div>
          <h1 className={cn('font-semibold tracking-tight text-foreground', compact ? 'text-xl' : 'text-2xl')}>What would you like to organise?</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-foreground/70">Start with a rough idea: a project, an exam, a skill, your semester or something at work. Nova asks what it needs, proposes a structure you can edit, and builds nothing until you approve it.</p>
        </div>
      </div>
      <Composer key={key} initial={seed} onSend={text => onStart(text)} disabled={busy} placeholder="e.g. I'm building TrackerX, a project tracker for small teams" />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div>
        <p className="mb-2 text-xs text-subtle">Or begin from</p>
        <ul className="flex flex-wrap gap-1.5">
          {BUILD_EXAMPLES.map(e => (
            <li key={e}><button type="button" onClick={() => { setSeed(e); setKey(k => k + 1) }} className="rounded-full border border-white/10 px-3 py-1 text-xs text-foreground/75 transition-colors hover:border-white/25 hover:text-foreground">{e}</button></li>
          ))}
        </ul>
      </div>
      {!compact && workspaces.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-subtle">Improve a workspace you have</p>
          <ul className="flex flex-wrap gap-1.5">{workspaces.slice(0, 6).map(w => (
            <li key={w.id}><button type="button" disabled={busy} onClick={() => void onStart('', w.id)} className={BUTTON_QUIET}>{w.title}</button></li>
          ))}</ul>
        </div>
      )}
      {!compact && open.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-subtle">Continue a conversation</p>
          <ul className="space-y-1">{open.map(d => (
            <li key={d.id}><Link href={`/build?draft=${encodeURIComponent(d.id)}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground/80 hover:bg-white/4">
              <span className="truncate">{d.title ?? 'Untitled conversation'}</span><span className="shrink-0 text-xs text-subtle">{STATUS_LABEL[d.status]}</span></Link></li>
          ))}</ul>
        </div>
      )}
      {!compact && <p className="text-xs text-subtle"><Link href="/templates" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"><LayoutTemplate aria-hidden className="size-3.5" /> Prefer a ready-made start? Browse templates</Link> (they can read a syllabus PDF too).</p>}
    </div>
  )
}

function ConversationHeader({ title, status, drafts, current, onNew }: { title: string; status: string | null; drafts: DraftListItem[]; current: string | null; onNew: () => void }) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
      <NovaAvatar />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Nova</p>
        <p className="truncate text-xs text-subtle">{title}{status ? ` · ${status}` : ''}</p>
      </div>
      {drafts.length > 1 && (
        <label className="hidden sm:block">
          <span className="sr-only">Switch conversation</span>
          <select value={current ?? ''} onChange={e => e.target.value && router.push(`/build?draft=${encodeURIComponent(e.target.value)}`)}
            className="h-8 max-w-[11rem] rounded-lg border border-white/10 bg-background px-2 text-xs text-foreground/80">
            {drafts.map(d => <option key={d.id} value={d.id}>{d.title ?? 'Untitled'} — {STATUS_LABEL[d.status]}</option>)}
          </select>
        </label>
      )}
      <button type="button" onClick={onNew} className={BUTTON_QUIET} aria-label="New conversation"><Plus aria-hidden className="size-3.5" /> New</button>
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
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => { setSplit(readSplit()) }, [])
  useEffect(() => {
    void api.listDrafts().then(r => { if ('status' in r) setDrafts(r.drafts) })
    void loadWorkspaces().then(r => { if ('status' in r) setWorkspaces(r.workspaces) })
  }, [draftId, draft?.status])

  // A new proposal or version: the playground tab says so on a phone.
  const seen = useRef(0)
  const fresh = Boolean(draft?.plan) && (draft?.version ?? 0) > seen.current && tab === 'chat'
  useEffect(() => { if (tab === 'playground' && draft) seen.current = draft.version }, [tab, draft])

  const start = useCallback(async (text: string, targetWorkspaceId?: string) => {
    setStarting(true); setStartError(null)
    const res = await api.startDraft({ clientKey: api.newClientKey(), ...(text ? { text } : {}), ...(targetWorkspaceId ? { targetWorkspaceId } : {}) })
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

  if (!draftId) {
    return (
      <div className="mx-auto w-full max-w-6xl pb-16 pt-12 lg:pt-8">
        <BuildStart onStart={start} workspaces={workspaces} drafts={drafts} busy={starting} error={startError} />
      </div>
    )
  }

  if (state.loadError && !draft) {
    return (
      <div className="mx-auto max-w-xl pt-12">
        <PageNotice tone="error" title="This conversation didn't open" action={<RetryButton onRetry={() => void state.reload()} />}>
          {state.loadError} <Link href="/build" className="underline underline-offset-4">Start a new one</Link>
        </PageNotice>
      </div>
    )
  }

  const title = draft?.title ?? draft?.target?.title ?? 'New workspace'
  const header = <ConversationHeader title={title} status={draft ? STATUS_LABEL[draft.status] : null} drafts={drafts} current={draftId} onNew={() => router.push('/build')} />
  const conversation = draft
    ? <Conversation state={state} header={header} onNew={() => router.push('/build')}
        onEdit={() => { setTab('playground'); setView(v => (v === 'overview' ? 'board' : v)) }}
        onImprove={() => draft.workspace && void start('', draft.workspace.id)} />
    : <div aria-busy="true" aria-label="Opening the conversation" className="p-5"><div className="h-24 animate-pulse rounded-2xl bg-white/4" /></div>
  const playground = draft?.status === 'ready' && draft.workspace
    ? <LiveWorkspace workspaceId={draft.workspace.id} view={view} onView={setView} />
    : <DraftPlayground state={state} view={view} onView={setView} />

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-[32rem] flex-col pt-10 lg:pt-0" data-builder={draft?.status ?? 'loading'}>
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

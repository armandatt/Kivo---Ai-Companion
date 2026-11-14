'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import { RecentlyDeleted } from '@/components/nova/knowledge-map/recently-deleted'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import { KnowledgeMap } from '@/components/nova/knowledge-map/knowledge-map'
import { useNovaView } from '@/components/nova/use-nova-view'
import { PageAction, PageFrame, PageHeader, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { scopeState } from '@/components/nova/knowledge-map/scope-switch'

const TITLE = 'Knowledge Map'
const DESCRIPTION = 'A workspace as you arranged it: its subjects, topics inside topics, tasks and their steps, notes and saved pages, joined the way they are filed and linked. Nothing here is guessed.'

// While there is no map to draw: the ordinary page frame, with its title.
function Frame({ children, actions }: { children: React.ReactNode; actions?: boolean }) {
  return (
    <PageFrame width="wide" className="flex min-h-[calc(100dvh-3rem)] flex-col pb-6">
      <PageHeader title={TITLE} description={DESCRIPTION} className="pb-5" actions={actions ? <Actions /> : undefined} />
      {children}
    </PageFrame>
  )
}

function Actions() {
  const [trash, setTrash] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  return <>
    {/* Recently deleted: maps and subjects deleted here, kept 30 days. */}
    <span className="relative">
      <button type="button" onClick={() => setTrash(o => !o)} aria-expanded={trash} className={cn(BUTTON_QUIET, 'h-9')} data-open-trash><History aria-hidden className="size-3.5" /> <span className="max-sm:sr-only">Recently deleted</span></button>
      {trash && <RecentlyDeleted className="absolute right-0 top-11 z-40" onClose={() => setTrash(false)} onRestored={text => { setSaid(text); setTrash(false); window.setTimeout(() => window.location.reload(), 900) }} />}
    </span>
    {said && <span role="status" className="text-xs text-foreground/70" data-trash-said>{said}</span>}
    <PageAction href="/notes/new">New note</PageAction>
    {/* On a phone, the map comes first: these are in the navigation. */}
    <Link href="/saved" className={cn(BUTTON_QUIET, 'hidden h-9 md:inline-flex')}>Saved pages</Link>
    <Link href="/knowledge" className={cn(BUTTON_QUIET, 'hidden h-9 md:inline-flex')}>Topic list</Link>
  </>
}

// The map is the page, edge to edge: the dashboard's 1.5rem padding is taken
// back (-m-6), a slim bar holds the title and its links, and the canvas takes
// every pixel below it, with no frame around it.
function Workspace({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-6 flex h-[100dvh] flex-col pt-10 lg:pt-0 [&_[data-knowledge-map]]:rounded-none [&_[data-knowledge-map]]:border-x-0 [&_[data-knowledge-map]]:border-b-0">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl" title={DESCRIPTION}>{TITLE}</h1>
        <div className="flex items-center gap-2 [&_a]:h-9 [&_a]:text-sm"><Actions /></div>
      </header>
      {children}
    </div>
  )
}

// Which workspace's map: ?workspace=<id>, else Everything ("all"). The map
// always opens on everything the learner has unless a link names a workspace.
function workspaceInAddress(): string {
  if (typeof window === 'undefined') return 'all'
  const w = new URLSearchParams(window.location.search).get('workspace')
  return w && w.length <= 64 ? w : 'all'
}

export default function KnowledgeMapPage() {
  const [workspace, setWorkspace] = useState<string>(workspaceInAddress)
  useEffect(() => { setWorkspace(workspaceInAddress()) }, [])
  const { view, loading, refreshing, error, refresh } = useNovaView<NovaKnowledgeMapView>(`/api/nova/knowledge-map?workspace=${encodeURIComponent(workspace)}`)
  const choose = (id: string) => {
    setWorkspace(id)
    const url = new URL(window.location.href)
    url.searchParams.set('workspace', id)
    url.searchParams.delete('focus')
    url.searchParams.delete('explore')
    window.history.replaceState(null, '', url.toString())
  }

  if (loading) {
    return (
      <PageLoading label="Loading your map" width="wide">
        <div aria-hidden className="h-[28rem] animate-pulse rounded-[1.5rem] bg-white/3" />
      </PageLoading>
    )
  }
  if (!view) {
    return (
      <Frame>
        <PageNotice tone="error" title="Couldn't load your map" action={<RetryButton onRetry={() => void refresh()} busy={refreshing} />}>
          The server didn&apos;t answer. Nothing is lost.
        </PageNotice>
      </Frame>
    )
  }
  if (view.status !== 'ready') {
    return (
      <Frame>
        <PageNotice title="There is nothing to map yet" action={<PageAction href="/home">Set up on Today</PageAction>}>
          The map is drawn from your subjects and topics. Tell Nova what you are studying and it appears here.
        </PageNotice>
      </Frame>
    )
  }
  if (view.nodes.length === 0) {
    // An empty map never strands anyone: other maps stay one click away, and
    // what was deleted is in Recently deleted (in the header).
    const others = (view.workspaces ?? []).filter(w => w.id !== view.workspaceId)
    return (
      <Frame actions>
        <PageNotice title={view.workspaceId ? 'This map is empty' : 'Your map is empty'} action={<PageAction href="/settings/study">Add subjects and topics</PageAction>}>
          Add a subject and its topics, write a note, or save a page from your browser. Each one becomes a card here, joined to the subject you file it under. Deleted something by mistake? Open Recently deleted above.
          {(view.workspaceId || others.length > 0) && (
            <span className="mt-4 flex flex-wrap gap-2" data-empty-switch>
              {view.workspaceId && <button type="button" onClick={() => choose('all')} className={cn(BUTTON_QUIET, 'h-9')}>Show everything you have</button>}
              {others.slice(0, 4).map(w => <button key={w.id} type="button" onClick={() => choose(w.id)} className={cn(BUTTON_QUIET, 'h-9')}>{w.title}</button>)}
            </span>
          )}
        </PageNotice>
      </Frame>
    )
  }
  // The map on screen stays while the next one loads; what was asked and is
  // not shown yet is said, and a failed request is said with Retry (it was
  // silent before, so "Everything" could look like it never came).
  const scope = scopeState({ requested: workspace, shown: view.workspaceId ?? null, hasView: true, refreshing, error, label: id => view.workspaces?.find(w => w.id === id)?.title ?? 'that map' })
  return (
    <Workspace>
      {scope.kind !== 'showing' && (
        <div role={scope.kind === 'failed' ? 'alert' : 'status'} data-scope-state={scope.kind}
          className={cn('mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs', scope.kind === 'failed' ? 'border-red-400/30 bg-red-400/8 text-foreground/85' : 'border-white/10 bg-white/3 text-foreground/75')}>
          <span className="flex items-center gap-2">
            {scope.kind === 'switching' && <span aria-hidden className="kivo-node-pulse inline-block size-2 rounded-full bg-[var(--nova)]" />}
            {scope.kind === 'switching' ? `Loading ${scope.to}… the map below is the one you had.` : `Couldn't load ${scope.to}. The map below is still the one you had; nothing was changed.`}
          </span>
          {scope.kind === 'failed' && (
            <span className="flex gap-2">
              <RetryButton onRetry={() => void refresh()} busy={refreshing} />
              <button type="button" onClick={() => choose(view.workspaceId ?? 'all')} className={cn(BUTTON_QUIET, 'h-8')}>Stay here</button>
            </span>
          )}
        </div>
      )}
      <KnowledgeMap key={view.workspaceId ?? 'all'} view={view} onChanged={() => void refresh()} onWorkspace={choose} pendingScope={scope.kind === 'switching' ? workspace : null} />
    </Workspace>
  )
}

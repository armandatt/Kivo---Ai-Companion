'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import { KnowledgeMap } from '@/components/nova/knowledge-map/knowledge-map'
import { useNovaView } from '@/components/nova/use-nova-view'
import { PageAction, PageFrame, PageHeader, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'

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
  return <>
    <PageAction href="/notes/new">New note</PageAction>
    {/* On a phone, the map comes first: these are in the navigation. */}
    <Link href="/saved" className={cn(BUTTON_QUIET, 'hidden h-9 md:inline-flex')}>Saved pages</Link>
    <Link href="/knowledge" className={cn(BUTTON_QUIET, 'hidden h-9 md:inline-flex')}>Topic list</Link>
  </>
}

// The map is the page: a one-line title, and the canvas takes every pixel
// left below it (the dashboard's main area pads 1.5rem on each side).
function Workspace({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-[120rem] flex-col pt-10 lg:pt-0">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl" title={DESCRIPTION}>{TITLE}</h1>
        <div className="flex items-center gap-2 [&_a]:h-9 [&_a]:text-sm"><Actions /></div>
      </header>
      {children}
    </div>
  )
}

// Which workspace's map: ?workspace=<id> (or "all"), else the one worked on last.
function workspaceInAddress(): string | null {
  if (typeof window === 'undefined') return null
  const w = new URLSearchParams(window.location.search).get('workspace')
  return w && w.length <= 64 ? w : null
}

export default function KnowledgeMapPage() {
  const [workspace, setWorkspace] = useState<string | null>(null)
  useEffect(() => { setWorkspace(workspaceInAddress()) }, [])
  const { view, loading, refreshing, refresh } = useNovaView<NovaKnowledgeMapView>(`/api/nova/knowledge-map${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`)
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
    return (
      <Frame actions>
        <PageNotice title="Your map is empty" action={<PageAction href="/settings/study">Add subjects and topics</PageAction>}>
          Add a subject and its topics, write a note, or save a page from your browser. Each one becomes a card here, joined to the subject you file it under.
        </PageNotice>
      </Frame>
    )
  }
  return <Workspace><KnowledgeMap key={view.workspaceId ?? 'all'} view={view} onChanged={() => void refresh()} onWorkspace={choose} /></Workspace>
}

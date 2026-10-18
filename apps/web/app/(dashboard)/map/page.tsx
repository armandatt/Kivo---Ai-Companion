'use client'

import Link from 'next/link'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import { KnowledgeMap } from '@/components/nova/knowledge-map/knowledge-map'
import { useNovaView } from '@/components/nova/use-nova-view'
import { PageAction, PageFrame, PageHeader, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'

const TITLE = 'Knowledge Map'
const DESCRIPTION = 'Your subjects, topics, notes and saved pages, joined the way you filed and linked them. Nothing here is guessed.'

// The map fills the screen below its title: the frame is a column, and the
// canvas takes the height that is left.
function Frame({ children, actions }: { children: React.ReactNode; actions?: boolean }) {
  return (
    <PageFrame width="wide" className="flex min-h-[calc(100dvh-3rem)] flex-col pb-6">
      <PageHeader
        title={TITLE} description={DESCRIPTION} className="pb-5"
        actions={actions ? <>
          <PageAction href="/notes/new">New note</PageAction>
          {/* On a phone, the map comes first: these are in the navigation. */}
          <Link href="/saved" className={cn(BUTTON_QUIET, 'hidden sm:inline-flex')}>Saved pages</Link>
          <Link href="/knowledge" className={cn(BUTTON_QUIET, 'hidden sm:inline-flex')}>Topic list</Link>
          <Link href="/settings/study" className={cn(BUTTON_QUIET, 'hidden sm:inline-flex')}>Add subjects</Link>
        </> : undefined}
      />
      {children}
    </PageFrame>
  )
}

export default function KnowledgeMapPage() {
  const { view, loading, refreshing, refresh } = useNovaView<NovaKnowledgeMapView>('/api/nova/knowledge-map')

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
  return <Frame actions><KnowledgeMap view={view} onChanged={() => void refresh()} /></Frame>
}

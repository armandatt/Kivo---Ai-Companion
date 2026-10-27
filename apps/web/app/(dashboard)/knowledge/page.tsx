'use client'

import { PageAction, PageFrame, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { NovaKnowledge } from '@/components/nova/knowledge/nova-knowledge'
import { useNovaKnowledge } from '@/components/nova/use-nova-knowledge'

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <PageFrame width="wide">
      <PageNotice title={title} action={<PageAction href="/home">Go to Today</PageAction>}>{body}</PageNotice>
    </PageFrame>
  )
}

// Nova only. The dashboard shell keeps Rex accounts off this route
// (product/companion.ts); the API answers them "not_nova" as well.
export default function KnowledgePage() {
  const { view, loading, refreshing, error, refresh } = useNovaKnowledge()

  if (loading) {
    return (
      <PageLoading label="Loading your knowledge" width="wide">
        <div className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-8">
          <div className="space-y-1.5">
            <div className="mb-3 h-8 animate-pulse rounded-lg bg-white/4" />
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-6 animate-pulse rounded-md bg-white/3" style={{ marginLeft: i % 3 === 0 ? 0 : 14 }} />)}
          </div>
          <div className="mt-6 space-y-4 lg:mt-0">
            <div className="h-3 w-40 animate-pulse rounded bg-white/5" />
            <div className="h-7 w-64 max-w-full animate-pulse rounded-md bg-white/6" />
            <div className="h-64 animate-pulse rounded-2xl bg-white/3" />
          </div>
        </div>
      </PageLoading>
    )
  }

  if (!view) {
    return (
      <PageFrame width="wide">
        <PageNotice tone="error" title="Couldn't load your knowledge" action={<RetryButton onRetry={() => void refresh()} busy={refreshing} />}>
          The server didn&apos;t answer. Nothing is lost; everything Nova has on record is saved.
        </PageNotice>
      </PageFrame>
    )
  }

  if (view.status === 'not_nova') return <Notice title="Knowledge is part of Nova" body="This account uses a different companion, so there is nothing to show here." />
  if (view.status === 'not_connected') return <Notice title="Connect Nova first" body="Nova has no learner linked to this account yet. Connect it on Today." />
  if (view.status === 'onboarding_incomplete') return <Notice title="Nova needs to know what you're studying" body="Finish the short setup conversation on Today, and your subjects will appear here." />

  return (
    <>
      {error && (
        <p role="status" className="mx-auto mb-2 w-full max-w-7xl pt-12 text-xs text-amber-300/80 lg:pt-0">
          Showing what loaded last. Reconnecting…
        </p>
      )}
      <NovaKnowledge view={view} onChanged={() => void refresh()} />
    </>
  )
}

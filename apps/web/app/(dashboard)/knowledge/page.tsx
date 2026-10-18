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
        <div>
          <div className="space-y-3 border-b border-white/8 pb-5">
            <div className="h-3 w-28 animate-pulse rounded bg-white/5" />
            <div className="h-7 w-72 max-w-full animate-pulse rounded-md bg-white/6" />
            <div className="h-4 w-96 max-w-full animate-pulse rounded bg-white/4" />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_17rem]">
            <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-11 animate-pulse rounded-lg bg-white/3" />)}</div>
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-xl bg-white/3" />
              <div className="h-64 animate-pulse rounded-xl bg-white/3" />
            </div>
            <div className="hidden h-48 animate-pulse rounded-xl bg-white/3 xl:block" />
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

'use client'

import { useState } from 'react'
import { PageFrame, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { RexHome } from '@/components/home/rex-home'
import { NovaHome } from '@/components/nova/nova-home'
import { ConnectNova, NovaOnboarding } from '@/components/nova/nova-setup'
import { useNovaToday } from '@/components/nova/use-nova-today'

// The shape of Today while it loads: the header, the plan beside the margin.
function Loading() {
  return (
    <PageLoading label="Loading your day" width="wide">
      <div className="space-y-3 border-b border-white/8 pb-5">
        <div className="h-3 w-32 animate-pulse rounded bg-white/5" />
        <div className="h-7 w-64 animate-pulse rounded-md bg-white/6" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-white/4" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-5">
          <div className="h-8 w-72 max-w-full animate-pulse rounded-full bg-white/4" />
          <div className="h-1.5 animate-pulse rounded-full bg-white/5" />
          <div className="h-48 animate-pulse rounded-xl border border-white/5 bg-white/3" />
          <div className="h-14 animate-pulse rounded-lg bg-white/3" />
          <div className="h-14 animate-pulse rounded-lg bg-white/3" />
        </div>
        <div className="space-y-6">
          {[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-lg bg-white/3" />)}
        </div>
      </div>
    </PageLoading>
  )
}

// One Home, two companions. The server says which learner this account is
// (GET /api/nova/today); the page renders that answer.
export default function HomePage() {
  const [minutes, setMinutes] = useState<number | null>(null)
  const { view, loading, refreshing, error, refresh } = useNovaToday(minutes)

  if (loading) return <Loading />

  if (!view) {
    return (
      <PageFrame width="narrow">
        <PageNotice tone="error" title="Couldn't load your day" action={<RetryButton onRetry={() => void refresh()} busy={refreshing} />}>
          The server didn&apos;t answer. Nothing is lost; your sessions and plan are saved.
        </PageNotice>
      </PageFrame>
    )
  }

  if (view.status === 'not_nova') return <RexHome />
  if (view.status === 'not_connected') return <PageFrame width="narrow"><ConnectNova onCheck={refresh} /></PageFrame>
  if (view.status === 'onboarding_incomplete') return <PageFrame width="narrow"><NovaOnboarding onProgress={refresh} /></PageFrame>

  return (
    <>
      {error && (
        <p role="status" className="mx-auto mb-2 w-full max-w-7xl pt-12 text-xs text-amber-300/80 lg:pt-0">
          Showing what loaded last. Reconnecting…
        </p>
      )}
      <NovaHome view={view} minutes={minutes} onMinutes={setMinutes} refreshing={refreshing} onRefresh={refresh} />
    </>
  )
}

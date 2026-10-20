'use client'

import { useState } from 'react'
import { PageAction, PageFrame, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'
import { RexPlanner } from '@/components/planner/rex-planner'
import { NovaPlanner } from '@/components/nova/planner/nova-planner'
import { useNovaPlanner } from '@/components/nova/use-nova-planner'
import { useTodayFocus } from '@/components/nova/today-focus'

function Loading() {
  return (
    <PageLoading label="Loading your plan">
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-white/5" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-white/4" />
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-3">
            <div className="h-28 animate-pulse rounded-2xl bg-white/3" />
            <div className="h-28 animate-pulse rounded-2xl bg-white/3" />
            <div className="h-28 animate-pulse rounded-2xl bg-white/3" />
          </div>
          <div className="h-72 animate-pulse rounded-2xl bg-white/3" />
        </div>
      </div>
    </PageLoading>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <PageFrame>
      <PageNotice title={title} action={<PageAction href="/home">Go to Today</PageAction>}>{body}</PageNotice>
    </PageFrame>
  )
}

// One Planner route, two companions. The server says which learner this
// account is (GET /api/nova/planner); the page renders that answer.
export default function PlannerPage() {
  const [minutes, setMinutes] = useState<number | null>(null)
  // The subject chosen on Today, so the two pages show the same plan.
  const [subject, setSubject] = useTodayFocus()
  const { view, loading, refreshing, error, refresh } = useNovaPlanner(minutes, subject)

  if (loading) return <Loading />

  if (!view) {
    return (
      <PageFrame>
        <PageNotice tone="error" title="Couldn't load your plan" action={<RetryButton onRetry={() => void refresh()} busy={refreshing} />}>
          The server didn&apos;t answer. Nothing is lost; your sessions and what Nova knows are saved.
        </PageNotice>
      </PageFrame>
    )
  }

  if (view.status === 'not_nova') return <RexPlanner />
  if (view.status === 'not_connected') {
    return <Notice title="Connect Nova first" body="Nova plans from what it knows about you, and it has no learner linked to this account yet. Connect it on Today." />
  }
  if (view.status === 'onboarding_incomplete') {
    return <Notice title="Nova needs to know what you're studying" body="There is nothing to plan until Nova knows your subjects and what is coming up. Finish the short setup conversation on Today." />
  }

  return (
    <>
      {error && (
        <p role="status" className="mx-auto mb-2 w-full max-w-6xl pt-10 text-xs text-amber-300/80 lg:pt-0">
          Showing the plan that loaded last. Reconnecting…
        </p>
      )}
      <NovaPlanner view={view} minutes={minutes} onMinutes={setMinutes} refreshing={refreshing} onChanged={() => void refresh()} onClearFocus={() => setSubject(null)} />
    </>
  )
}

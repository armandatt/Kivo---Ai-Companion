'use client'

import { useState } from 'react'
import { RexHome } from '@/components/home/rex-home'
import { NovaHome } from '@/components/nova/nova-home'
import { ConnectNova, NovaOnboarding } from '@/components/nova/nova-setup'
import { useNovaToday } from '@/components/nova/use-nova-today'

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">{children}</div>
}

function Loading() {
  return (
    <Frame>
      <div aria-busy="true" aria-label="Loading your day" className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-white/5" />
        <div className="h-4 w-40 animate-pulse rounded bg-white/4" />
        <div className="h-80 animate-pulse rounded-3xl border border-white/5 bg-white/3" />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl bg-white/3" />
          <div className="h-24 animate-pulse rounded-xl bg-white/3" />
        </div>
      </div>
    </Frame>
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
      <Frame>
        <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your day</h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">
            The server didn&apos;t answer. Nothing is lost; your sessions and plan are saved.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-60"
          >
            {refreshing ? 'Trying…' : 'Try again'}
          </button>
        </section>
      </Frame>
    )
  }

  if (view.status === 'not_nova') return <RexHome />
  if (view.status === 'not_connected') return <Frame><ConnectNova onCheck={refresh} /></Frame>
  if (view.status === 'onboarding_incomplete') return <Frame><NovaOnboarding onProgress={refresh} /></Frame>

  return (
    <>
      {error && (
        <p role="status" className="mx-auto mb-2 w-full max-w-3xl pt-10 text-xs text-amber-300/80 lg:pt-0">
          Showing what loaded last. Reconnecting…
        </p>
      )}
      <NovaHome view={view} minutes={minutes} onMinutes={setMinutes} refreshing={refreshing} onRefresh={refresh} />
    </>
  )
}

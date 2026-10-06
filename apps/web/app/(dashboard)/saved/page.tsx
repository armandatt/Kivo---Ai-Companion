'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { NovaSavedResourcesView } from '@repo/api/nova/product/learning-events.types'
import { NovaSaved } from '@/components/nova/saved/nova-saved'
import { useNovaView } from '@/components/nova/use-nova-view'

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4">{children}</div>
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">{body}</p>
        <Link href="/home" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
          Go to Today
        </Link>
      </section>
    </Frame>
  )
}

function Saved() {
  const connect = useSearchParams().get('connect') !== null
  const { view, loading, refreshing, error, refresh } = useNovaView<NovaSavedResourcesView>('/api/nova/learning-events')

  if (loading) {
    return (
      <Frame>
        <div aria-busy="true" aria-label="Loading your saved pages" className="space-y-6">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-white/5" />
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-56 animate-pulse rounded-2xl bg-white/3" />
            <div className="h-56 animate-pulse rounded-2xl bg-white/3" />
          </div>
        </div>
      </Frame>
    )
  }

  if (!view) {
    return (
      <Frame>
        <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your saved pages</h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">The server didn&apos;t answer. Nothing is lost.</p>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-60">
            {refreshing ? 'Trying…' : 'Try again'}
          </button>
        </section>
      </Frame>
    )
  }

  if (view.status === 'not_nova') return <Notice title="Saved pages are part of Nova" body="This account uses a different companion, so there is nothing to show here." />
  if (view.status === 'not_connected') return <Notice title="Connect Nova first" body="Nova has no learner linked to this account yet. Connect it on Today." />
  if (view.status === 'onboarding_incomplete') return <Notice title="Nova needs to know what you're studying" body="Finish the short setup conversation on Today. Then you can save pages under your subjects." />

  return (
    <>
      {error && <p role="status" className="mx-auto mb-2 w-full max-w-6xl pt-10 text-xs text-amber-300/80 lg:pt-0">Showing what loaded last. Reconnecting…</p>}
      <NovaSaved view={view} connect={connect} onChanged={() => void refresh()} />
    </>
  )
}

// Nova only. The dashboard shell keeps Rex accounts off this route
// (product/companion.ts); the API answers them "not_nova" as well.
export default function SavedPage() {
  return <Suspense fallback={null}><Saved /></Suspense>
}

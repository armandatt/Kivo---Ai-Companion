'use client'

import Link from 'next/link'
import { NovaKnowledge } from '@/components/nova/knowledge/nova-knowledge'
import { useNovaKnowledge } from '@/components/nova/use-nova-knowledge'

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl pb-20 pt-12 lg:pt-2">{children}</div>
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <section className="max-w-2xl rounded-xl border border-white/8 bg-card/70 p-5 sm:p-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">{body}</p>
        <Link href="/home" className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
          Go to Today
        </Link>
      </section>
    </Frame>
  )
}

// Nova only. The dashboard shell keeps Rex accounts off this route
// (product/companion.ts); the API answers them "not_nova" as well.
export default function KnowledgePage() {
  const { view, loading, refreshing, error, refresh } = useNovaKnowledge()

  if (loading) {
    return (
      <Frame>
        <div aria-busy="true" aria-label="Loading your knowledge">
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
      </Frame>
    )
  }

  if (!view) {
    return (
      <Frame>
        <section role="alert" className="max-w-2xl rounded-xl border border-white/8 bg-card/70 p-5 sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your knowledge</h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">
            The server didn&apos;t answer. Nothing is lost; everything Nova has on record is saved.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-white/12 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-60"
          >
            {refreshing ? 'Trying…' : 'Try again'}
          </button>
        </section>
      </Frame>
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

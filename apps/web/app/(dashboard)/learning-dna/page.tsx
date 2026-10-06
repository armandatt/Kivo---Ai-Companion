'use client'

import Link from 'next/link'
import { NovaLearningDna } from '@/components/nova/learning-dna/nova-learning-dna'
import { useNovaLearningDna } from '@/components/nova/use-nova-learning-dna'

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

// Nova only. The dashboard shell keeps Rex accounts off this route
// (product/companion.ts); the API answers them "not_nova" as well.
export default function LearningDnaPage() {
  const { view, loading, refreshing, error, refresh } = useNovaLearningDna()

  if (loading) {
    return (
      <Frame>
        <div aria-busy="true" aria-label="Loading your Learning DNA" className="space-y-6">
          <div className="h-8 w-56 animate-pulse rounded-lg bg-white/5" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-white/4" />
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-44 animate-pulse rounded-2xl bg-white/3" />)}
            </div>
            <div className="h-72 animate-pulse rounded-2xl bg-white/3" />
          </div>
        </div>
      </Frame>
    )
  }

  if (!view) {
    return (
      <Frame>
        <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your Learning DNA</h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">
            The server didn&apos;t answer. Nothing is lost; your sessions and what Nova knows are saved.
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

  if (view.status === 'not_nova') return <Notice title="Learning DNA is part of Nova" body="This account uses a different companion, so there is nothing to show here." />
  if (view.status === 'not_connected') return <Notice title="Connect Nova first" body="Nova has no learner linked to this account yet. Connect it on Today." />
  if (view.status === 'onboarding_incomplete') return <Notice title="Nova needs to know what you're studying" body="Finish the short setup conversation on Today. Nova starts learning how you work from your first sessions after that." />

  return (
    <>
      {error && (
        <p role="status" className="mx-auto mb-2 w-full max-w-6xl pt-10 text-xs text-amber-300/80 lg:pt-0">
          Showing what loaded last. Reconnecting…
        </p>
      )}
      <NovaLearningDna view={view} />
    </>
  )
}

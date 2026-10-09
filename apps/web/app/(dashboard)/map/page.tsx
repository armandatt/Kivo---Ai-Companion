'use client'

import Link from 'next/link'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import { KnowledgeMap } from '@/components/nova/knowledge-map/knowledge-map'
import { useNovaView } from '@/components/nova/use-nova-view'

const ACTION = 'inline-flex h-10 items-center justify-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5'

function Shell({ children, actions }: { children: React.ReactNode; actions?: boolean }) {
  return (
    <div className="mx-auto flex h-full min-h-[calc(100vh-4rem)] w-full max-w-7xl flex-col pb-6 pt-10 lg:pt-4">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Knowledge Map</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
            Your subjects, topics, notes and saved pages, joined the way you filed them. Nothing here is guessed.
          </p>
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2">
            <Link href="/notes/new" className={ACTION}>New note</Link>
            <Link href="/saved" className={ACTION}>Saved pages</Link>
            <Link href="/settings/study" className={ACTION}>Add subjects</Link>
            <Link href="/knowledge" className={ACTION}>Topic list</Link>
          </div>
        )}
      </header>
      {children}
    </div>
  )
}

function Notice({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">{body}</p>
      <Link href={href} className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">{cta}</Link>
    </section>
  )
}

export default function KnowledgeMapPage() {
  const { view, loading, refreshing, refresh } = useNovaView<NovaKnowledgeMapView>('/api/nova/knowledge-map')

  if (loading) {
    return <Shell><div aria-busy="true" aria-label="Loading your map" className="min-h-[24rem] flex-1 animate-pulse rounded-3xl bg-white/3" /></Shell>
  }
  if (!view) {
    return (
      <Shell>
        <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your map</h2>
          <p className="mt-3 text-sm text-foreground/65">The server didn&apos;t answer. Nothing is lost.</p>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-60">
            {refreshing ? 'Trying…' : 'Try again'}
          </button>
        </section>
      </Shell>
    )
  }
  if (view.status !== 'ready') {
    return (
      <Shell>
        <Notice
          title="There is nothing to map yet"
          body="The map is drawn from your subjects and topics. Tell Nova what you are studying and it appears here."
          href="/home" cta="Set up on Today"
        />
      </Shell>
    )
  }
  if (view.nodes.length === 0) {
    return (
      <Shell actions>
        <Notice
          title="Your map is empty"
          body="Add a subject and its topics, write a note, or save a page from your browser. Each one becomes a point here, joined to the subject you file it under."
          href="/settings/study" cta="Add subjects and topics"
        />
      </Shell>
    )
  }
  return <Shell actions><KnowledgeMap view={view} /></Shell>
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import type { LearningResource, NovaSavedResourcesReady } from '@repo/api/nova/product/learning-events.types'
import { relativeDay, sentenceCase } from '../format'
import { ExtensionPanel } from './extension-panel'
import { removeResource } from './saved-api'

function ResourceRow({ resource, onRemoved }: { resource: LearningResource; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false)
  const filed = [resource.subjectName, resource.topicName].filter(Boolean).join(' · ')

  async function remove() {
    if (!window.confirm('Remove this page from Nova?')) return
    setRemoving(true)
    if (await removeResource(resource.id)) onRemoved()
    else setRemoving(false)
  }

  return (
    <li data-resource={resource.id} data-resource-title={resource.title} className="px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[15px] font-medium text-foreground/90 underline-offset-4 hover:text-keppel-200 hover:underline">
            <span className="truncate">{resource.title}</span>
            <ExternalLink className="size-3.5 shrink-0 text-foreground/35" aria-hidden />
          </a>
          <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-foreground/50">
            <span>{resource.domain}</span>
            <span aria-hidden className="text-foreground/20">·</span>
            <span data-filed>{filed || 'Not filed under a subject'}</span>
            <span aria-hidden className="text-foreground/20">·</span>
            <span>{sentenceCase(relativeDay(resource.savedAt))}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/focus?study=${encodeURIComponent(resource.id)}`} className="inline-flex h-9 items-center justify-center rounded-lg bg-keppel-400 px-3 text-xs font-semibold text-keppel-950 transition-colors hover:bg-keppel-300" data-study>
            Study this
          </Link>
          <button type="button" onClick={() => void remove()} disabled={removing} className="h-9 rounded-lg border border-white/12 px-3 text-xs text-foreground/65 transition-colors hover:bg-white/5 disabled:opacity-50" data-remove>
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}

// The pages the learner saved from their browser, and the browsers they
// connected. A saved page is a bookmark with a subject, nothing more: Nova
// learns nothing about the learner from it until they study it.
export function NovaSaved({ view, connect, onChanged }: { view: NovaSavedResourcesReady; connect: boolean; onChanged: () => void }) {
  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4" data-saved={view.resources.length > 0 ? 'ready' : 'empty'}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Saved</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          Pages you saved from your browser. Saving one tells Nova it matters to you, not that you know it.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {view.resources.length === 0 ? (
            <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-empty="saved">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Nothing saved yet</h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60">
                Connect the Nova browser extension, and when you come across something worth studying, save it from there. It will be waiting here.
              </p>
            </section>
          ) : (
            <ul className="divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40" data-resources>
              {view.resources.map(r => <ResourceRow key={r.id} resource={r} onRemoved={onChanged} />)}
            </ul>
          )}
        </div>

        <aside className="space-y-6">
          <ExtensionPanel open={connect} />
          <section className="rounded-2xl border border-white/8 bg-card/50 p-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">What Nova keeps</h2>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/60">
              <li>The page&apos;s address and title, and the subject and topic you filed it under. Nothing from the page itself.</li>
              <li>Only pages you save or ask to study. Nova does not see your other tabs or your history.</li>
              <li>Saving a page changes nothing in Knowledge. A finished study session does.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

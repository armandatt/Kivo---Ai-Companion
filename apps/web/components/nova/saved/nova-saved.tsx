'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import type { LearningResource, NovaSavedResourcesReady, ResourceConnection, ResourceUpdateResponse } from '@repo/api/nova/product/learning-events.types'
import { relativeDay, sentenceCase } from '../format'
import { BookmarkletPanel } from './bookmarklet-panel'
import { ExtensionPanel } from './extension-panel'
import { takeCapture, type Capture } from './pending-capture'
import { SaveLink } from './save-link'
import { addTaskFromResource, dismissSuggestion, fetchResource, fileResource, keepNovaLink, removeResource, retryProcessing, undoNovaLink } from './saved-api'
import { PageHeader } from '@/components/dashboard/page-states'

// What Nova found when it looked at a saved page, and what the learner can
// do about it. Every button here files a page or asks for another look;
// none of them says anything about what the learner knows.
function Connections({ resource, busy, act }: {
  resource: LearningResource
  busy:     boolean
  act:      (run: () => Promise<ResourceUpdateResponse>) => void
}) {
  // The web app deploys before the API. A server that does not send this yet
  // gets a row with nothing under it, not a broken page.
  const processing = resource.processing as LearningResource['processing'] | undefined
  if (!processing) return null
  const place = (c: ResourceConnection) => (c.topicName ? `${c.subjectName} · ${c.topicName}` : c.subjectName)
  const why = (c: ResourceConnection) =>
    c.basis === 'name_in_title' ? 'named in the title' : c.basis === 'name_in_selection' ? 'named in your selection' : 'Nova thinks it may be related'

  if (processing.status === 'pending' || processing.status === 'processing') {
    return <p className="mt-3 text-xs text-foreground/45" data-processing={processing.status} role="status">Nova is looking at what this connects to…</p>
  }

  return (
    <div className="mt-3 space-y-2.5" data-processing={processing.status}>
      {resource.filedBy === 'nova' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-foreground/60" data-nova-link>
          <span>Nova filed this here because the name appears in it. Not sure yet.</span>
          <button type="button" disabled={busy} onClick={() => act(() => keepNovaLink(resource.id))} className={CHIP}>Keep</button>
          <button type="button" disabled={busy} onClick={() => act(() => undoNovaLink(resource.id))} className={CHIP}>Undo</button>
        </p>
      )}

      {processing.suggestions.length > 0 && (
        <div data-suggestions>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/40">Might belong under</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {processing.suggestions.map(c => (
              <li key={`${c.subjectId}\n${c.topicName ?? ''}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/65">
                <span className="font-medium text-foreground/80">{place(c)}</span>
                <span className="text-foreground/40">{why(c)}</span>
                <button type="button" disabled={busy} onClick={() => act(() => fileResource(resource.id, c.subjectId, c.topicName))} className={CHIP} data-file-here>
                  File here
                </button>
                <button type="button" disabled={busy} onClick={() => act(() => dismissSuggestion(resource.id, c.subjectId, c.topicName))} className={CHIP} data-dismiss aria-label={`Not ${place(c)}`}>
                  Not this
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {processing.concepts.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground/45" data-concepts>
          <span>About:</span>
          {processing.concepts.map(c => <span key={c} className="rounded-full border border-white/10 px-2 py-0.5 text-foreground/60">{c}</span>)}
        </p>
      )}

      {processing.status === 'failed' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-foreground/55" role="status" data-processing-failed>
          <span>{processing.error} The page is saved either way.</span>
          <button type="button" disabled={busy} onClick={() => act(() => retryProcessing(resource.id))} className={CHIP} data-retry>Try again</button>
        </p>
      )}
      {processing.status === 'none' && (
        <button type="button" disabled={busy} onClick={() => act(() => retryProcessing(resource.id))} className={CHIP} data-retry>Find what this connects to</button>
      )}
    </div>
  )
}

const CHIP = 'rounded-md border border-white/12 px-2 py-1 text-xs text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-50'

function ResourceRow({ resource: initial, onRemoved, onChanged }: { resource: LearningResource; onRemoved: () => void; onChanged: () => void }) {
  // The row shows the page as the server last returned it: a change made here
  // is drawn from the server's answer, never assumed.
  const [resource, setResource] = useState(initial)
  useEffect(() => setResource(initial), [initial])
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy]         = useState(false)
  const [notice, setNotice]     = useState<string | null>(null)
  const filed = [resource.subjectName, resource.topicName].filter(Boolean).join(' · ')
  const passage = resource.eventType === 'selection_saved'
  // A link from the Knowledge Map names this page (?page=<id>): its row is
  // brought into view and marked.
  const [linked, setLinked] = useState(false)
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('page') !== resource.id) return
    setLinked(true)
    row.current?.scrollIntoView({ block: 'center' })
  }, [resource.id])

  async function remove() {
    if (!window.confirm(passage ? 'Remove this passage from Nova?' : 'Remove this page from Nova?')) return
    setRemoving(true)
    if (await removeResource(resource.id)) onRemoved()
    else setRemoving(false)
  }

  function act(run: () => Promise<ResourceUpdateResponse>) {
    setBusy(true); setNotice(null)
    void run().then(result => {
      setBusy(false)
      if (result.ok) { setResource(result.resource); onChanged() }
      else setNotice(result.message)
    })
  }

  async function addTask() {
    setBusy(true); setNotice(null)
    const made = await addTaskFromResource(resource)
    setBusy(false)
    setNotice(made ? 'Added to your tasks.' : "That task didn't save. Try again.")
  }

  // A page Nova has not finished looking at is asked about again, a few
  // times, so the row fills in without a reload. It stops by itself.
  const waiting = resource.processing?.status === 'pending' || resource.processing?.status === 'processing'
  const polls = useRef(0)
  useEffect(() => {
    if (!waiting || polls.current >= 5) return
    const timer = window.setTimeout(() => {
      polls.current++
      void fetchResource(resource.id).then(result => { if (result.ok) setResource(result.resource) })
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [waiting, resource])

  return (
    <li ref={row} data-resource={resource.id} data-resource-title={resource.title} data-resource-kind={passage ? 'passage' : 'page'} data-linked={linked || undefined}
      className={`px-4 py-4 sm:px-5 ${linked ? 'bg-keppel-400/5' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[15px] font-medium text-foreground/90 underline-offset-4 hover:text-keppel-200 hover:underline">
            <span className="truncate">{resource.title}</span>
            <ExternalLink className="size-3.5 shrink-0 text-foreground/35" aria-hidden />
          </a>
          <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-foreground/50">
            <span>{passage ? `Passage from ${resource.domain}` : resource.domain}</span>
            <span aria-hidden className="text-foreground/20">·</span>
            <span data-filed>{filed || 'Not filed under a subject'}</span>
            <span aria-hidden className="text-foreground/20">·</span>
            <span>{sentenceCase(relativeDay(resource.savedAt))}</span>
          </p>
          {resource.excerpt && (
            <blockquote className="mt-3 max-h-40 overflow-y-auto whitespace-pre-line border-l-2 border-keppel-400/50 pl-3 text-sm leading-relaxed text-foreground/70" data-excerpt>
              {resource.excerpt}
            </blockquote>
          )}
          <Connections resource={resource} busy={busy} act={act} />
          {notice && <p className="mt-2 text-xs text-foreground/60" role="status" data-notice>{notice}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={`/focus?study=${encodeURIComponent(resource.id)}`} className="inline-flex h-9 items-center justify-center rounded-lg bg-keppel-400 px-3 text-xs font-semibold text-keppel-950 transition-colors hover:bg-keppel-300" data-study>
            Study this
          </Link>
          {/* A new note on this page, filed where the page is and naming it as its source. Nothing is saved until the note is. */}
          <Link href={`/notes/new?${new URLSearchParams({
            title: resource.title.slice(0, 200), source: resource.url, sourceTitle: resource.title,
            ...(resource.subjectId ? { subjectId: resource.subjectId } : {}), ...(resource.subjectId && resource.topicName ? { topic: resource.topicName } : {}),
          }).toString()}`} className="inline-flex h-9 items-center justify-center rounded-lg border border-white/12 px-3 text-xs text-foreground/65 transition-colors hover:bg-white/5" data-write-note>
            Write a note
          </Link>
          <button type="button" onClick={() => void addTask()} disabled={busy} className="h-9 rounded-lg border border-white/12 px-3 text-xs text-foreground/65 transition-colors hover:bg-white/5 disabled:opacity-50" data-add-task>
            Add task
          </button>
          <button type="button" onClick={() => void remove()} disabled={removing} className="h-9 rounded-lg border border-white/12 px-3 text-xs text-foreground/65 transition-colors hover:bg-white/5 disabled:opacity-50" data-remove>
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}

// The Browser Extension page: connecting the extension, and the learner's
// inbox of saved pages and passages (pasted here, sent by the bookmark, or
// sent by the extension) with what Nova found each connects to. One page,
// because what the extension saves lands here; the address stays /saved. A saved page is a bookmark with a subject,
// nothing more: Nova learns nothing about the learner from it until they study it.
export function NovaSaved({ view, connect, onChanged }: { view: NovaSavedResourcesReady; connect: boolean; onChanged: () => void }) {
  // A page the bookmark brought, read once when the screen opens.
  // Taking it empties the address, so it is taken exactly once per visit.
  const [capture, setCapture] = useState<Capture | null>(null)
  const taken = useRef(false)
  useEffect(() => {
    if (taken.current) return
    taken.current = true
    setCapture(takeCapture())
  }, [])

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4" data-saved={view.resources.length > 0 ? 'ready' : 'empty'}>
      <PageHeader
        title="Browser Extension"
        description="Connect the extension to save pages and passages to Nova while you read. What you save is kept below, under the subject and topic it belongs to. Saving a page tells Nova it matters to you, not that you know it."
      />

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <ExtensionPanel open={connect} />
          <h2 className="pt-2 text-lg font-semibold tracking-tight text-foreground" data-saved-heading>Saved pages</h2>
          <SaveLink subjects={view.subjects} resources={view.resources} capture={capture} onSaved={onChanged} />
          {view.resources.length === 0 ? (
            <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-empty="saved">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Nothing saved yet</h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60">
                Paste a link above, or add the Save to Kivo bookmark and send pages here as you read. They will be waiting when you want to study them.
              </p>
            </section>
          ) : (
            <ul className="divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40" data-resources>
              {view.resources.map(r => <ResourceRow key={r.id} resource={r} onRemoved={onChanged} onChanged={onChanged} />)}
            </ul>
          )}
        </div>

        <aside className="space-y-6">
          <BookmarkletPanel />
          <section className="rounded-2xl border border-white/8 bg-card/50 p-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">What Nova keeps</h2>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/60">
              <li>The page&apos;s address and title, and the subject and topic you filed it under. From the page itself, only a passage you selected and chose to save.</li>
              <li>To suggest where a page belongs, Nova reads its title and your selected passage alongside the names of your subjects and topics. It never opens the page.</li>
              <li>Only pages you save or ask to study. Nova does not see your other tabs or your history.</li>
              <li>Saving a page changes nothing in Knowledge. A finished study session does.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

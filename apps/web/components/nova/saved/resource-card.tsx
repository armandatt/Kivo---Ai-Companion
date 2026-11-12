'use client'

// One saved page in the library, as a row (list) or a card (grid). What it
// is shows first: a preview (the page's own image, or its site's icon), its
// kind, and the facts that matter for that kind (a video's channel and
// length, an article's author and date, a paper's authors and venue). Then
// the learner's organisation (reading status, collection, tags, a note of
// their own) and, opened from More, what can be done with it. Every change
// is drawn from the server's answer, never assumed.
//
// Images come from other sites: loaded lazily, with no referrer, and a broken
// one falls back to the site's initial. Nothing here is evidence of learning.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookMarked, ChevronDown, ExternalLink, FileText, Globe, GraduationCap, ListChecks, Newspaper, PenLine, PlayCircle, Plus, Tag, X,
} from 'lucide-react'
import type { LearningResource, ResourceCollectionRef, ResourceConnection, ResourceUpdateResponse } from '@repo/api/nova/product/learning-events.types'
import { READING_STATUS_LABEL, RESOURCE_TYPE_LABEL, type ReadingStatus, type ResourceType } from '@repo/api/nova/product/resource-meta'
import { relativeDay } from '../format'
import { AddToNote } from './add-to-note'
import { addTaskFromResource, dismissSuggestion, fetchResource, fileResource, keepNovaLink, organizeResource, removeResource, retryProcessing, undoNovaLink } from './saved-api'

export const TYPE_ICON: Record<ResourceType, typeof Globe> = {
  article: FileText, video: PlayCircle, paper: GraduationCap, documentation: BookMarked,
  tutorial: ListChecks, blog: PenLine, news: Newspaper, page: Globe,
}

const CHIP = 'rounded-md border border-white/12 px-2 py-1 text-xs text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-50'
const SECONDARY = 'inline-flex h-8 items-center justify-center rounded-lg border border-white/12 px-3 text-xs text-foreground/75 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] disabled:opacity-50'
const SELECT = 'h-8 rounded-lg border border-white/10 bg-transparent px-2 text-xs text-foreground/80 focus:border-nova/60 focus:outline-none disabled:opacity-50'

export const durationLabel = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`)
const year = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

// The facts a kind of resource is known by, in order, whatever is known.
export function factsOf(r: LearningResource): string[] {
  const type = (r.resourceType ?? 'page') as ResourceType
  const site = r.siteName || r.domain
  const when = r.publishedAt ? year(r.publishedAt) : null
  switch (type) {
    case 'video': return [r.author || site, r.durationSeconds ? durationLabel(r.durationSeconds) : null, when].filter((x): x is string => !!x)
    case 'paper': return [r.author, site, when].filter((x): x is string => !!x)
    case 'documentation': case 'tutorial': return [site, r.author].filter((x): x is string => !!x)
    case 'page': return [site].filter(Boolean)
    default: return [r.author, site, when].filter((x): x is string => !!x)
  }
}

function Preview({ r, grid }: { r: LearningResource; grid: boolean }) {
  const [broken, setBroken] = useState(false)
  const type = (r.resourceType ?? 'page') as ResourceType
  const Icon = TYPE_ICON[type]
  const box = grid ? 'aspect-[16/9] w-full rounded-t-2xl' : 'h-[4.5rem] w-28 shrink-0 rounded-xl max-sm:hidden'
  if (r.imageUrl && !broken) return (
    <span className={`relative block overflow-hidden bg-white/[0.04] ${box}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a page's own preview image from its site, with no referrer */}
      <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" data-preview-image />
      {type === 'video' && r.durationSeconds ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">{durationLabel(r.durationSeconds)}</span> : null}
    </span>
  )
  // No picture: a slim band in a card (a 16:9 box of nothing wastes a phone's screen).
  return (
    <span className={`grid place-items-center bg-white/[0.035] text-foreground/45 ${grid ? 'h-14 w-full rounded-t-2xl' : box}`} aria-hidden>
      <span className={`flex items-center gap-1 ${grid ? 'flex-row gap-2' : 'flex-col'}`}>
        <Icon className={grid ? 'size-6' : 'size-5'} />
        <span className="max-w-24 truncate text-[10px] font-medium uppercase tracking-[0.12em]">{(r.siteName || r.domain).slice(0, 18)}</span>
      </span>
    </span>
  )
}

// What Nova found a page connects to, and what the learner can do about it.
// Every button files a page or asks for another look; none says anything about what they know.
function Connections({ resource, busy, act, onTag }: { resource: LearningResource; busy: boolean; act: (run: () => Promise<ResourceUpdateResponse>) => void; onTag: (t: string) => void }) {
  const processing = resource.processing as LearningResource['processing'] | undefined
  if (!processing) return null
  const place = (c: ResourceConnection) => (c.topicName ? `${c.subjectName} · ${c.topicName}` : c.subjectName)
  const why = (c: ResourceConnection) => (c.basis === 'name_in_title' ? 'named in the title' : c.basis === 'name_in_selection' ? 'named in your selection' : 'Nova thinks it may be related')
  if (processing.status === 'pending' || processing.status === 'processing') return <p className="text-xs text-subtle" data-processing={processing.status} role="status">Nova is looking at what this connects to…</p>
  const tags = new Set((resource.tags ?? []).map(t => t.toLowerCase()))
  const offered = processing.concepts.filter(c => !tags.has(c.toLowerCase()))
  return (
    <div className="space-y-2.5" data-processing={processing.status}>
      {resource.filedBy === 'nova' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-foreground/60" data-nova-link>
          <span>Nova filed this under {[resource.subjectName, resource.topicName].filter(Boolean).join(' · ')} because the name appears in it.</span>
          <button type="button" disabled={busy} onClick={() => act(() => keepNovaLink(resource.id))} className={CHIP}>Keep</button>
          <button type="button" disabled={busy} onClick={() => act(() => undoNovaLink(resource.id))} className={CHIP}>Undo</button>
        </p>
      )}
      {processing.suggestions.length > 0 && (
        <div data-suggestions>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">Might belong under</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {processing.suggestions.map(c => (
              <li key={`${c.subjectId}\n${c.topicName ?? ''}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/65">
                <span className="font-medium text-foreground/85">{place(c)}</span>
                <span className="text-subtle">{why(c)}</span>
                <button type="button" disabled={busy} onClick={() => act(() => fileResource(resource.id, c.subjectId, c.topicName))} className={CHIP} data-file-here>File here</button>
                <button type="button" disabled={busy} onClick={() => act(() => dismissSuggestion(resource.id, c.subjectId, c.topicName))} className={CHIP} data-dismiss aria-label={`Not ${place(c)}`}>Not this</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {offered.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-subtle" data-concepts>
          <span>Suggested tags:</span>
          {offered.map(c => <button key={c} type="button" disabled={busy} onClick={() => onTag(c)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 px-2 py-0.5 text-foreground/65 hover:border-nova/50 hover:text-foreground" data-suggested-tag={c}><Plus className="size-3" aria-hidden />{c}</button>)}
        </p>
      )}
      {processing.status === 'failed' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-foreground/55" role="status" data-processing-failed>
          <span>{processing.error} The page is saved either way.</span>
          <button type="button" disabled={busy} onClick={() => act(() => retryProcessing(resource.id))} className={CHIP} data-retry>Try again</button>
        </p>
      )}
      {processing.status === 'none' && <button type="button" disabled={busy} onClick={() => act(() => retryProcessing(resource.id))} className={CHIP} data-retry>Find what this connects to</button>}
    </div>
  )
}

function TagEditor({ tags, known, busy, onChange }: { tags: string[]; known: string[]; busy: boolean; onChange: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const listId = useRef(`tags-${Math.random().toString(36).slice(2)}`).current
  const add = () => { const t = text.trim(); setText(''); setAdding(false); if (t) onChange([...tags, t]) }
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-tags>
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-2 pr-1 text-[11px] text-foreground/75" data-tag={t}>
          {t}
          <button type="button" disabled={busy} onClick={() => onChange(tags.filter(x => x !== t))} aria-label={`Remove tag ${t}`} className="grid size-4 place-items-center rounded-full text-foreground/45 hover:bg-white/10 hover:text-foreground"><X className="size-3" /></button>
        </span>
      ))}
      {adding ? (
        <>
          <input autoFocus value={text} list={listId} maxLength={40} onChange={e => setText(e.target.value)} placeholder="Tag"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') { setAdding(false); setText('') } }} onBlur={add}
            className="h-6 w-28 rounded-full border border-white/12 bg-transparent px-2 text-[11px] text-foreground focus:border-nova/60 focus:outline-none" aria-label="New tag" data-tag-input />
          <datalist id={listId}>{known.filter(k => !tags.includes(k)).slice(0, 40).map(k => <option key={k} value={k} />)}</datalist>
        </>
      ) : tags.length < 12 && (
        <button type="button" disabled={busy} onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-subtle hover:bg-white/5 hover:text-foreground" data-add-tag><Tag className="size-3" aria-hidden /> Tag</button>
      )}
    </span>
  )
}

export function ResourceCard({ resource: initial, view, collections, knownTags, onRemoved, onChanged }: {
  resource: LearningResource
  view: 'list' | 'grid'
  collections: ResourceCollectionRef[]
  knownTags: string[]
  onRemoved: (id: string) => void
  onChanged: (r: LearningResource) => void
}) {
  const [resource, setResource] = useState(initial)
  useEffect(() => setResource(initial), [initial])
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [addingToNote, setAddingToNote] = useState(false)
  const [note, setNote] = useState(resource.personalNote ?? '')
  useEffect(() => setNote(resource.personalNote ?? ''), [resource.personalNote])
  const passage = resource.eventType === 'selection_saved'
  const grid = view === 'grid'
  const type = (resource.resourceType ?? 'page') as ResourceType
  const TypeIcon = TYPE_ICON[type]
  const status = (resource.readingStatus ?? 'unread') as ReadingStatus
  const filed = [resource.subjectName, resource.topicName].filter(Boolean).join(' · ')

  // A link from the Knowledge Map names this page (?page=<id>): brought into view, marked and opened.
  const [linked, setLinked] = useState(false)
  const row = useRef<HTMLElement>(null)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('page') !== resource.id) return
    setLinked(true); setOpen(true)
    row.current?.scrollIntoView({ block: 'center' })
  }, [resource.id])

  function act(run: () => Promise<ResourceUpdateResponse>) {
    setBusy(true); setNotice(null)
    void run().then(result => {
      setBusy(false)
      if (result.ok) { setResource(result.resource); onChanged(result.resource) }
      else setNotice(result.message)
    })
  }
  const organize = (o: Parameters<typeof organizeResource>[1]) => act(() => organizeResource(resource.id, o))

  async function remove() {
    if (!window.confirm(passage ? 'Remove this passage from Nova?' : 'Remove this page from Nova?')) return
    setRemoving(true)
    if (await removeResource(resource.id)) onRemoved(resource.id)
    else { setRemoving(false); setNotice("That didn't remove. Try again.") }
  }
  async function addTask() {
    setBusy(true); setNotice(null)
    const made = await addTaskFromResource(resource)
    setBusy(false)
    setNotice(made ? 'Added to your tasks.' : "That task didn't save. Try again.")
  }

  // A page Nova has not finished looking at is asked about again, a few times.
  const waiting = resource.processing?.status === 'pending' || resource.processing?.status === 'processing'
  const polls = useRef(0)
  useEffect(() => {
    if (!waiting || polls.current >= 5) return
    const timer = window.setTimeout(() => { polls.current++; void fetchResource(resource.id).then(r => { if (r.ok) setResource(r.resource) }) }, 4000)
    return () => window.clearTimeout(timer)
  }, [waiting, resource])

  const facts = factsOf(resource)
  return (
    <article ref={row} data-resource={resource.id} data-resource-title={resource.title} data-resource-kind={passage ? 'passage' : 'page'} data-resource-type={type} data-status={status} data-linked={linked || undefined}
      className={grid
        ? `group flex flex-col overflow-hidden rounded-2xl border bg-card/50 transition-colors hover:border-white/15 ${linked ? 'border-nova/40' : 'border-white/8'}`
        : `group flex gap-4 px-4 py-4 sm:px-5 ${linked ? 'bg-nova/[0.05]' : ''}`}>
      <a href={resource.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className={grid ? '' : 'pt-0.5'}><Preview r={resource} grid={grid} /></a>
      <div className={`min-w-0 flex-1 ${grid ? 'flex flex-col p-4' : ''}`}>
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">
          <TypeIcon className="size-3.5" aria-hidden />
          <span data-type-label>{passage ? 'Passage' : RESOURCE_TYPE_LABEL[type]}</span>
          {status !== 'unread' && <><span aria-hidden>·</span><span className={status === 'done' ? 'text-[color:var(--sem-positive-ink)]' : 'text-[color:var(--sem-warning-ink)]'}>{READING_STATUS_LABEL[status]}</span></>}
        </p>
        <a href={resource.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-start gap-1.5 text-[15px] font-semibold leading-snug text-foreground/90 underline-offset-4 hover:text-foreground hover:underline">
          <span className={grid ? 'line-clamp-2' : 'line-clamp-2 sm:line-clamp-1'}>{resource.title}</span>
          <ExternalLink className="mt-1 size-3.5 shrink-0 text-subtle" aria-hidden />
        </a>
        <p className="mt-1 flex flex-wrap gap-x-1.5 text-xs text-subtle">
          {facts.map((f, i) => <span key={i}>{i > 0 && <span aria-hidden className="mr-1.5">·</span>}{f}</span>)}
          <span>{facts.length > 0 && <span aria-hidden className="mr-1.5">·</span>}Saved {relativeDay(resource.savedAt).toLowerCase()}</span>
        </p>
        {resource.description && <p className={`mt-2 text-[13px] leading-relaxed text-foreground/65 ${grid ? 'line-clamp-3' : 'line-clamp-2'}`} data-description>{resource.description}</p>}
        {resource.excerpt && (
          <blockquote className="mt-2 max-h-32 overflow-y-auto whitespace-pre-line border-l-2 border-nova/50 pl-3 text-sm leading-relaxed text-foreground/70" data-excerpt>{resource.excerpt}</blockquote>
        )}

        <div className={`flex flex-wrap items-center gap-2 ${grid ? 'mt-auto pt-3' : 'mt-2.5'}`}>
          <label className="sr-only" htmlFor={`status-${resource.id}`}>Reading status</label>
          <select id={`status-${resource.id}`} value={status} disabled={busy} onChange={e => organize({ readingStatus: e.target.value })} className={SELECT} data-status-select>
            {(Object.keys(READING_STATUS_LABEL) as ReadingStatus[]).map(s => <option key={s} value={s}>{READING_STATUS_LABEL[s]}</option>)}
          </select>
          <label className="sr-only" htmlFor={`coll-${resource.id}`}>Collection</label>
          <select id={`coll-${resource.id}`} value={resource.collection?.id ?? ''} disabled={busy} onChange={e => organize({ collectionId: e.target.value || null })} className={`${SELECT} max-w-[11rem]`} data-collection-select>
            <option value="">No collection</option>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <TagEditor tags={resource.tags ?? []} known={knownTags} busy={busy} onChange={tags => organize({ tags })} />
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-foreground/70 hover:bg-white/5 hover:text-foreground" data-more>
            More <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </div>

        {open && (
          <div className="mt-3 space-y-3 border-t border-white/6 pt-3" data-details>
            <p className="text-xs text-subtle" data-filed>{filed ? `Filed under ${filed}` : 'Not filed under a subject'}{resource.collection ? ` · In ${resource.collection.name}` : ''}</p>
            <div className="flex flex-wrap gap-1.5">
              <Link href={`/focus?study=${encodeURIComponent(resource.id)}`} className="inline-flex h-8 items-center justify-center rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-study>Study this</Link>
              <Link href={`/notes/new?${new URLSearchParams({
                title: resource.title.slice(0, 200), source: resource.url, sourceTitle: resource.title,
                ...(resource.subjectId ? { subjectId: resource.subjectId } : {}), ...(resource.subjectId && resource.topicName ? { topic: resource.topicName } : {}),
              }).toString()}`} className={SECONDARY} data-write-note>Write a note</Link>
              {passage && resource.excerpt && <button type="button" onClick={() => setAddingToNote(v => !v)} aria-expanded={addingToNote} className={SECONDARY} data-add-to-note>Add to a note</button>}
              <button type="button" onClick={() => void addTask()} disabled={busy} className={SECONDARY} data-add-task>Add task</button>
              <button type="button" onClick={() => void remove()} disabled={removing} aria-label={`Remove ${resource.title}`} className="ml-auto inline-flex h-8 items-center rounded-lg px-2.5 text-xs text-subtle hover:bg-red-400/10 hover:text-[color:var(--sem-caution-ink)] disabled:opacity-50" data-remove>Remove</button>
            </div>
            <Connections resource={resource} busy={busy} act={act} onTag={t => organize({ tags: [...(resource.tags ?? []), t] })} />
            <div>
              <label htmlFor={`note-${resource.id}`} className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">Your note</label>
              <textarea id={`note-${resource.id}`} value={note} maxLength={2000} rows={2} onChange={e => setNote(e.target.value)}
                onBlur={() => { if (note.trim() !== (resource.personalNote ?? '')) organize({ personalNote: note }) }}
                placeholder="Why you saved it, what to look at…" className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-nova/60 focus:outline-none" data-personal-note />
            </div>
            {addingToNote && <AddToNote resource={resource} onClose={() => setAddingToNote(false)} onDone={() => onChanged(resource)} />}
          </div>
        )}
        {notice && <p className="mt-2 text-xs text-foreground/65" role="status" data-notice>{notice}</p>}
      </div>
    </article>
  )
}


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
  BookMarked, Check, ChevronDown, FileText, Globe, GraduationCap, ListChecks, MoreHorizontal, Newspaper, PenLine, PlayCircle, Plus, Tag, X,
} from 'lucide-react'
import type { LearningResource, ResourceCollectionRef, ResourceConnection, ResourceUpdateResponse } from '@repo/api/nova/product/learning-events.types'
import { READING_STATUS_LABEL, type ReadingStatus, type ResourceType } from '@repo/api/nova/product/resource-meta'
import { relativeDay } from '../format'
import { AddToNote } from './add-to-note'
import { addTaskFromResource, dismissSuggestion, fetchResource, fileResource, keepNovaLink, organizeResource, removeResource, retryProcessing, undoNovaLink } from './saved-api'

export const TYPE_ICON: Record<ResourceType, typeof Globe> = {
  article: FileText, video: PlayCircle, paper: GraduationCap, documentation: BookMarked,
  tutorial: ListChecks, blog: PenLine, news: Newspaper, page: Globe,
}

const CHIP = 'rounded-md border border-white/12 px-2 py-1 text-xs text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-50'

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

// A site's own colour, worked out from its name, so the same site always
// looks the same when it has no picture of its own.
export function siteHue(domain: string): number {
  let h = 0
  for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
const initialOf = (r: LearningResource) => ((r.siteName || r.domain || r.title || '?').replace(/^www\./, '').trim()[0] ?? '?').toUpperCase()

function Preview({ r, grid }: { r: LearningResource; grid: boolean }) {
  const [broken, setBroken] = useState(false)
  const type = (r.resourceType ?? 'page') as ResourceType
  const Icon = TYPE_ICON[type]
  const hue = siteHue(r.domain || r.title)
  const box = grid ? 'aspect-[16/9] w-full' : 'h-12 w-[4.5rem] shrink-0 rounded-lg'
  if (r.imageUrl && !broken) return (
    <span className={`relative block overflow-hidden bg-white/[0.04] ${box}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a page's own preview image from its site, with no referrer */}
      <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" data-preview-image />
      {type === 'video' && r.durationSeconds ? <span className={`absolute rounded bg-black/75 font-medium text-white ${grid ? 'bottom-2 right-2 px-1.5 py-px text-[11px]' : 'bottom-1 right-1 px-1 py-px text-[10px]'}`} data-duration>{durationLabel(r.durationSeconds)}</span> : null}
    </span>
  )
  // No picture: the site's initial on its own colour, with what kind it is.
  return (
    <span aria-hidden className={`relative grid place-items-center overflow-hidden ${grid ? 'aspect-[16/9] w-full' : 'size-12 shrink-0 rounded-lg'}`}
      style={{ background: `oklch(0.62 0.09 ${hue} / 0.16)`, color: `oklch(0.78 0.1 ${hue})` }} data-site-tile>
      <span className={grid ? 'text-4xl font-semibold opacity-90' : 'text-lg font-semibold'}>{initialOf(r)}</span>
      {type !== 'page' && <span className={`absolute grid place-items-center rounded-md bg-background/80 text-foreground/70 ${grid ? 'bottom-2 right-2 size-7' : '-bottom-px -right-px size-5'}`}><Icon className={grid ? 'size-4' : 'size-3'} /></span>}
      {grid && type === 'video' && r.durationSeconds ? <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-px text-[11px] font-medium text-white" data-duration>{durationLabel(r.durationSeconds)}</span> : null}
    </span>
  )
}

// A small menu under a button: closes on a choice, outside click or Escape.
function Menu({ label, children, wide = false }: { label: string; children: (close: () => void) => React.ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={label}
        className="grid size-8 place-items-center rounded-lg text-foreground/55 transition-colors hover:bg-white/[0.07] hover:text-foreground" data-more>
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className={`absolute right-0 top-9 z-30 rounded-xl border border-white/10 bg-card p-1 text-sm shadow-float motion-safe:animate-[subject-pop_140ms_ease-out] ${wide ? 'w-60' : 'w-52'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
const ITEM = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-foreground/85 hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50'
const MENU_LABEL = 'px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle'
const STATUS_TONE: Record<ReadingStatus, string> = {
  unread: 'text-foreground/55 bg-white/[0.06]',
  reading: 'text-[color:var(--sem-warning-ink)] bg-[color:var(--sem-warning-ink)]/10',
  done: 'text-[color:var(--sem-positive-ink)] bg-[color:var(--sem-positive-ink)]/10',
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

function TagEditor({ tags, known, busy, onChange, startOpen = false, onDone }: { tags: string[]; known: string[]; busy: boolean; onChange: (next: string[]) => void; startOpen?: boolean; onDone?: () => void }) {
  const [adding, setAdding] = useState(startOpen)
  useEffect(() => { if (startOpen) setAdding(true) }, [startOpen])
  const [text, setText] = useState('')
  const listId = useRef(`tags-${Math.random().toString(36).slice(2)}`).current
  const add = () => { const t = text.trim(); setText(''); setAdding(false); onDone?.(); if (t) onChange([...tags, t]) }
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-tags>
      {tags.map(t => (
        <span key={t} className="group/tag inline-flex items-center gap-0.5 rounded-full bg-white/[0.06] py-0.5 pl-2 pr-1.5 text-[11px] text-foreground/75" data-tag={t}>
          {t}
          <button type="button" disabled={busy} onClick={() => onChange(tags.filter(x => x !== t))} aria-label={`Remove tag ${t}`} className="grid h-4 w-0 place-items-center overflow-hidden rounded-full text-foreground/45 transition-[width] hover:bg-white/10 hover:text-foreground focus:w-4 group-hover/tag:w-4 [@media(hover:none)]:w-4"><X className="size-3" /></button>
        </span>
      ))}
      {adding ? (
        <>
          <input autoFocus value={text} list={listId} maxLength={40} onChange={e => setText(e.target.value)} placeholder="Tag"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') { setAdding(false); setText(''); onDone?.() } }} onBlur={add}
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
  const [tagging, setTagging] = useState(false)
  const [note, setNote] = useState(resource.personalNote ?? '')
  useEffect(() => setNote(resource.personalNote ?? ''), [resource.personalNote])
  const passage = resource.eventType === 'selection_saved'
  const grid = view === 'grid'
  const type = (resource.resourceType ?? 'page') as ResourceType
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
  const site = resource.siteName || resource.domain
  const meta = [...facts.filter(f => f !== site), `Saved ${relativeDay(resource.savedAt).toLowerCase()}`]
  const menu = (
    <Menu label={`Options for ${resource.title}`} wide>
      {close => <>
        <p className={MENU_LABEL}>Status</p>
        {(Object.keys(READING_STATUS_LABEL) as ReadingStatus[]).map(s => (
          <button key={s} type="button" role="menuitemradio" aria-checked={status === s} disabled={busy} onClick={() => { close(); if (s !== status) organize({ readingStatus: s }) }} className={ITEM} data-status-option={s}>
            <span className={`size-2 rounded-full ${s === 'done' ? 'bg-[color:var(--sem-positive-ink)]' : s === 'reading' ? 'bg-[color:var(--sem-warning-ink)]' : 'bg-foreground/30'}`} aria-hidden />{READING_STATUS_LABEL[s]}{status === s && <Check className="ml-auto size-3.5 text-foreground/60" aria-hidden />}
          </button>
        ))}
        {collections.length > 0 && <>
          <p className={MENU_LABEL}>Collection</p>
          {[{ id: '', name: 'No collection' }, ...collections].map(c => (
            <button key={c.id || 'none'} type="button" role="menuitemradio" aria-checked={(resource.collection?.id ?? '') === c.id} disabled={busy} onClick={() => { close(); if ((resource.collection?.id ?? '') !== c.id) organize({ collectionId: c.id || null }) }} className={ITEM} data-collection-option>
              <span className="truncate">{c.name}</span>{(resource.collection?.id ?? '') === c.id && <Check className="ml-auto size-3.5 shrink-0 text-foreground/60" aria-hidden />}
            </button>
          ))}
        </>}
        <div className="my-1 border-t border-white/6" />
        <button type="button" role="menuitem" onClick={() => { close(); setTagging(true) }} className={ITEM} data-add-tag><Tag className="size-3.5" aria-hidden /> Edit tags</button>
        <Link role="menuitem" onClick={close} href={`/notes/new?${new URLSearchParams({
          title: resource.title.slice(0, 200), source: resource.url, sourceTitle: resource.title,
          ...(resource.subjectId ? { subjectId: resource.subjectId } : {}), ...(resource.subjectId && resource.topicName ? { topic: resource.topicName } : {}),
        }).toString()}`} className={ITEM} data-write-note><PenLine className="size-3.5" aria-hidden /> Write a note</Link>
        {passage && resource.excerpt && <button type="button" role="menuitem" onClick={() => { close(); setAddingToNote(true); setOpen(true) }} className={ITEM} data-add-to-note><FileText className="size-3.5" aria-hidden /> Add to a note</button>}
        <button type="button" role="menuitem" onClick={() => { close(); void addTask() }} disabled={busy} className={ITEM} data-add-task><ListChecks className="size-3.5" aria-hidden /> Add as a task</button>
        <button type="button" role="menuitem" onClick={() => { close(); setOpen(o => !o) }} className={ITEM} data-details-toggle><ChevronDown className="size-3.5" aria-hidden /> {open ? 'Hide details' : 'Details and your note'}</button>
        <div className="my-1 border-t border-white/6" />
        <button type="button" role="menuitem" onClick={() => { close(); void remove() }} disabled={removing} aria-label={`Remove ${resource.title}`} className={`${ITEM} text-[color:var(--sem-caution-ink)]`} data-remove><X className="size-3.5" aria-hidden /> Remove</button>
      </>}
    </Menu>
  )
  const statusPill = (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${STATUS_TONE[status]}`} data-status-pill>{READING_STATUS_LABEL[status]}</span>
  )
  const tags = (resource.tags?.length || tagging) ? <TagEditor tags={resource.tags ?? []} known={knownTags} busy={busy} startOpen={tagging} onDone={() => setTagging(false)} onChange={tags => organize({ tags })} /> : null

  return (
    <article ref={row} data-resource={resource.id} data-resource-title={resource.title} data-resource-kind={passage ? 'passage' : 'page'} data-resource-type={type} data-status={status} data-linked={linked || undefined}
      className={grid
        ? `group flex flex-col overflow-visible rounded-2xl border bg-card/50 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-white/16 motion-reduce:hover:translate-y-0 ${linked ? 'border-nova/40' : 'border-white/8'}`
        : `group border-b border-white/6 px-3 py-3 transition-colors last:border-b-0 hover:bg-white/[0.02] sm:px-4 ${linked ? 'bg-nova/[0.05]' : ''}`}>
      {grid ? (
        <a href={resource.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className="block overflow-hidden rounded-t-2xl"><Preview r={resource} grid /></a>
      ) : null}
      <div className={grid ? 'flex flex-1 flex-col p-4' : 'flex items-start gap-3.5'}>
        {!grid && <a href={resource.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className="pt-0.5"><Preview r={resource} grid={false} /></a>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground/90 underline-offset-4 hover:text-foreground hover:underline">
              <span className={grid ? 'line-clamp-2' : 'line-clamp-2 sm:line-clamp-1'}>{passage && <span className="mr-1.5 rounded bg-nova/12 px-1.5 py-px align-[1px] text-[10.5px] font-medium uppercase tracking-wide text-nova-ink" data-type-label>Passage</span>}{resource.title}</span>
            </a>
            {!grid && <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
              <Link href={`/focus?study=${encodeURIComponent(resource.id)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-action-ink opacity-80 transition-opacity hover:bg-action/10 hover:opacity-100 group-hover:opacity-100" data-study><GraduationCap className="size-3.5" aria-hidden /> Study</Link>
              {menu}
            </div>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-subtle">
            <span className="font-medium text-foreground/60">{site}</span>
            {meta.map((f, i) => <span key={i}><span aria-hidden className="mr-1.5">·</span>{f}</span>)}
            {status !== 'unread' && <span className="ml-1">{statusPill}</span>}
            {resource.collection && <span className="ml-1 inline-flex h-5 items-center rounded-full bg-white/[0.05] px-2 text-[11px] text-foreground/60" data-collection-pill>{resource.collection.name}</span>}
          </p>
          {resource.description && <p className={`mt-1.5 text-[13px] leading-relaxed text-foreground/60 ${grid ? 'line-clamp-3' : 'line-clamp-1'}`} data-description>{resource.description}</p>}
          {resource.excerpt && (
            <blockquote className="mt-2 line-clamp-3 border-l-2 border-nova/50 pl-3 text-[13px] leading-relaxed text-foreground/70" data-excerpt>{resource.excerpt}</blockquote>
          )}
          {tags && <div className="mt-2">{tags}</div>}
          {/* On a phone, and in a card, the actions sit under the text. */}
          <div className={grid ? 'mt-auto flex items-center justify-between gap-2 pt-3' : 'mt-2 flex items-center justify-between gap-2 sm:hidden'}>
            {grid ? (status !== 'unread' ? statusPill : <span />) : <span />}
            <span className="flex items-center gap-1">
              <Link href={`/focus?study=${encodeURIComponent(resource.id)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action/10 px-3 text-xs font-semibold text-action-ink hover:bg-action/15" data-study><GraduationCap className="size-3.5" aria-hidden /> Study</Link>
              {menu}
            </span>
          </div>

          {open && (
            <div className="mt-3 space-y-3 border-t border-white/6 pt-3" data-details>
              <p className="text-xs text-subtle" data-filed>{filed ? `Filed under ${filed}` : 'Not filed under a subject'}{resource.collection ? ` · In ${resource.collection.name}` : ''}</p>
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
      </div>
    </article>
  )
}

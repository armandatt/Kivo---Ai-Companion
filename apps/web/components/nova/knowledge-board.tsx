'use client'

import Link from 'next/link'
import { ArrowRight, Bookmark, NotebookPen } from 'lucide-react'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaNotesView } from '@repo/api/nova/product/notes.types'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { dueMarks, recentPages, subjectCards } from './knowledge-board-data'
import { relativeDay } from './format'
import { LEVEL_LABEL, LEVEL_TONE } from './knowledge/labels'

// Today's view of everything the learner has on record, subject by subject,
// and what they wrote or saved last. Read from the Knowledge Map and Notes as
// they are; each panel loads, fails and is empty on its own, and Today's plan
// never waits for either.

type Loaded<T> = { view: T | null; loading: boolean; error: boolean; refresh: () => void }

const HEADING = 'text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/45'
const TOPICS_SHOWN = 12
const RECENT_SHOWN = 5


function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="status" className="text-sm text-foreground/55">
      {what} didn&apos;t load. Nothing is lost.{' '}
      <button type="button" onClick={onRetry} className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Try again</button>
    </p>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function KnowledgeBoard({ map, reviewDue }: { map: Loaded<NovaKnowledgeMapView>; reviewDue: NovaTodayReady['reviewDue'] }) {
  const ready = map.view?.status === 'ready' ? map.view : null
  const cards = ready ? subjectCards(ready) : []
  const due   = dueMarks(reviewDue)

  return (
    <section aria-labelledby="knowledge-board" data-section="knowledge-board">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="knowledge-board" className={HEADING}>Your knowledge</h2>
        <div className="flex items-center gap-4 text-xs font-medium text-foreground/55">
          <Link href="/knowledge" className="transition-colors hover:text-foreground">Knowledge</Link>
          <Link href="/map" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">Knowledge Map <ArrowRight aria-hidden className="size-3" /></Link>
        </div>
      </div>

      {ready && (
        <p className="mt-2 text-xs text-foreground/45">
          {plural(ready.counts.subject, 'subject', 'subjects')} · {plural(ready.counts.topic, 'topic', 'topics')} · {plural(ready.counts.note, 'note', 'notes')} · {plural(ready.counts.resource, 'saved page', 'saved pages')}
          {reviewDue.count > 0 && !due.complete && (
            <> · <Link href="/knowledge" className="font-medium text-amber-300 hover:underline">{plural(reviewDue.count, 'topic', 'topics')} due for review</Link></>
          )}
        </p>
      )}

      <div className="mt-3">
        {!ready && map.loading ? (
          <div aria-busy="true" aria-label="Loading your knowledge" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl border border-white/5 bg-white/3" />)}
          </div>
        ) : !ready && map.error ? (
          <Failed what="Your knowledge" onRetry={map.refresh} />
        ) : !ready ? null : cards.length === 0 ? (
          <p className="text-sm leading-relaxed text-foreground/55">
            No subjects on record yet. <Link href="/settings/study" className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Add them in study setup</Link> and they show here with their topics.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ subject, topics }) => (
              <li key={subject.id} className="flex flex-col rounded-2xl border border-white/8 bg-card/60 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  {subject.href
                    ? <Link href={subject.href} className="min-w-0 truncate text-sm font-semibold text-foreground hover:underline">{subject.label}</Link>
                    : <p className="min-w-0 truncate text-sm font-semibold text-foreground">{subject.label}</p>}
                  <p className="flex shrink-0 items-center gap-2.5 text-xs text-foreground/45">
                    <span className="inline-flex items-center gap-1" title={plural(subject.notes, 'note', 'notes')}><NotebookPen aria-hidden className="size-3" />{subject.notes}<span className="sr-only"> notes</span></span>
                    <span className="inline-flex items-center gap-1" title={plural(subject.resources, 'saved page', 'saved pages')}><Bookmark aria-hidden className="size-3" />{subject.resources}<span className="sr-only"> saved pages</span></span>
                  </p>
                </div>

                {topics.length === 0 ? (
                  <p className="mt-3 text-xs text-foreground/45">No topics yet.</p>
                ) : (
                  <ul aria-label={`Topics in ${subject.label}`} className="mt-3 flex flex-wrap gap-1.5">
                    {topics.slice(0, TOPICS_SHOWN).map(topic => {
                      // The map's level, worded and coloured as Knowledge does. A topic
                      // with no session behind it has none.
                      const level = topic.sessions > 0 && topic.level ? topic.level : null
                      const isDue = due.isDue(topic)
                      const body = (
                        <>
                          {level && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', LEVEL_TONE[level])} />}
                          <span className="truncate">{topic.label}</span>
                          <span className="sr-only">, {LEVEL_LABEL[level ?? 'unverified']}{isDue ? ', due for review' : ''}</span>
                          {isDue && <span aria-hidden className="text-[10px] font-medium uppercase tracking-wide text-amber-300">due</span>}
                        </>
                      )
                      const chip = cn(
                        'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                        level ? 'border-white/10 text-foreground/80' : 'border-dashed border-white/15 text-foreground/50',
                        topic.href && 'transition-colors hover:border-white/30 hover:text-foreground',
                      )
                      const title = level ? `${topic.label}: ${LEVEL_LABEL[level]}, from ${plural(topic.sessions, 'session', 'sessions')}` : `${topic.label}: ${LEVEL_LABEL.unverified}`
                      return (
                        <li key={topic.id} className="max-w-full">
                          {topic.href ? <Link href={topic.href} className={chip} title={title}>{body}</Link> : <span className={chip} title={title}>{body}</span>}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {topics.length > TOPICS_SHOWN && subject.href && (
                  <Link href={subject.href} className="mt-2 text-xs text-foreground/50 hover:text-foreground">
                    {topics.length - TOPICS_SHOWN} more on Knowledge
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {ready && cards.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-foreground/45">
          <p>
            {(['weak', 'developing', 'solid'] as const).map(l => (
              <span key={l} className="mr-3 inline-flex items-center gap-1.5"><span aria-hidden className={cn('size-1.5 rounded-full', LEVEL_TONE[l])} />{LEVEL_LABEL[l]}</span>
            ))}
            Dashed: {LEVEL_LABEL.unverified.toLowerCase()}. Levels come from how you said your sessions went.
          </p>
          {ready.unconnected > 0 && (
            <p>
              {plural(ready.unconnected, 'item on the map is', 'items on the map are')} not filed under anything.{' '}
              <Link href="/saved" className="underline decoration-white/20 underline-offset-4 hover:text-foreground">File saved pages on Saved</Link>
            </p>
          )}
          {(ready.notShown.notes > 0 || ready.notShown.resources > 0) && (
            <p>The counts cover your newest notes and saved pages; {[
              ready.notShown.notes > 0 ? plural(ready.notShown.notes, 'older note', 'older notes') : null,
              ready.notShown.resources > 0 ? plural(ready.notShown.resources, 'older saved page', 'older saved pages') : null,
            ].filter(Boolean).join(' and ')} are not counted here.</p>
          )}
        </div>
      )}
    </section>
  )
}

export function RecentlyCaptured({ notes, map }: { notes: Loaded<NovaNotesView>; map: Loaded<NovaKnowledgeMapView> }) {
  const noteList = notes.view?.status === 'ready' ? notes.view.notes.slice(0, RECENT_SHOWN) : null
  const mapReady = map.view?.status === 'ready' ? map.view : null
  const pages    = mapReady ? recentPages(mapReady, RECENT_SHOWN) : null
  const row = 'flex items-baseline justify-between gap-3 py-2.5 text-sm'

  return (
    <section aria-labelledby="recently-captured" data-section="recently-captured">
      <h2 id="recently-captured" className={HEADING}>Recently captured</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-card/60 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/60"><NotebookPen aria-hidden className="size-3.5" /> Notes</p>
            <Link href="/notes" className="text-xs text-foreground/50 hover:text-foreground">All notes</Link>
          </div>
          {noteList === null && notes.loading ? (
            <div aria-busy="true" aria-label="Loading your notes" className="mt-3 space-y-2"><div className="h-4 w-2/3 animate-pulse rounded bg-white/5" /><div className="h-4 w-1/2 animate-pulse rounded bg-white/4" /></div>
          ) : noteList === null && notes.error ? (
            <div className="mt-3"><Failed what="Your notes" onRetry={notes.refresh} /></div>
          ) : noteList === null ? null : noteList.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/55">No notes yet. <Link href="/notes/new" className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Write one</Link>.</p>
          ) : (
            <ul className="mt-1 divide-y divide-white/6">
              {noteList.map(note => (
                <li key={note.id} className={row}>
                  <Link href={`/notes/${note.id}`} className="min-w-0 truncate text-foreground/85 hover:underline">{note.title}</Link>
                  <span className="shrink-0 text-xs text-foreground/40">{note.subjectName ? `${note.subjectName} · ` : ''}edited {relativeDay(note.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-white/8 bg-card/60 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/60"><Bookmark aria-hidden className="size-3.5" /> Saved pages</p>
            <Link href="/saved" className="text-xs text-foreground/50 hover:text-foreground">All saved</Link>
          </div>
          {pages === null && map.loading ? (
            <div aria-busy="true" aria-label="Loading your saved pages" className="mt-3 space-y-2"><div className="h-4 w-2/3 animate-pulse rounded bg-white/5" /><div className="h-4 w-1/2 animate-pulse rounded bg-white/4" /></div>
          ) : pages === null && map.error ? (
            <div className="mt-3"><Failed what="Your saved pages" onRetry={map.refresh} /></div>
          ) : pages === null ? null : pages.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/55">Nothing saved yet. <Link href="/saved" className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Save a link</Link>.</p>
          ) : (
            <ul className="mt-1 divide-y divide-white/6">
              {pages.map(page => (
                <li key={page.id} className={row}>
                  {page.href
                    ? <Link href={page.href} className="min-w-0 truncate text-foreground/85 hover:underline">{page.label}</Link>
                    : <span className="min-w-0 truncate text-foreground/85">{page.label}</span>}
                  <span className="shrink-0 text-xs text-foreground/40">{page.domain} · {page.kind === 'study_requested' ? 'asked to study' : 'saved'} {relativeDay(page.savedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

'use client'

import Link from 'next/link'
import { ArrowRight, Bookmark, Library, NotebookPen, Inbox } from 'lucide-react'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaNotesView } from '@repo/api/nova/product/notes.types'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { dueMarks, levelCounts, recentPages, subjectCards, type LevelCounts } from './knowledge-board-data'
import { relativeDay } from './format'
import { LEVEL_LABEL, LEVEL_TONE } from './knowledge/labels'
import { LoadFailed, ROW, SectionHeading, Skeleton, TEXT_LINK } from './workspace/ui'
import { toneStyle } from './subject-color'

// Today's view of everything the learner has on record, subject by subject,
// and what they wrote or saved last. Read from the Knowledge Map and Notes as
// they are; each part loads, fails and is empty on its own, and Today's plan
// never waits for either.

type Loaded<T> = { view: T | null; loading: boolean; error: boolean; refresh: () => void }

const TOPICS_SHOWN = 8
const RECENT_SHOWN = 5

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// How a subject's topics stand, as one bar: a segment per level, sized by how
// many topics are at it. Counts, not scores.
function LevelBar({ counts, total }: { counts: LevelCounts; total: number }) {
  if (total === 0) return null
  const parts: Array<{ key: keyof LevelCounts; tone: string }> = [
    { key: 'solid', tone: LEVEL_TONE.solid }, { key: 'developing', tone: LEVEL_TONE.developing },
    { key: 'weak', tone: LEVEL_TONE.weak }, { key: 'unstudied', tone: 'bg-white/10' },
  ]
  const said = parts.filter(p => counts[p.key] > 0).map(p => `${counts[p.key]} ${p.key === 'unstudied' ? 'not studied yet' : LEVEL_LABEL[p.key].toLowerCase()}`).join(', ')
  return (
    <div className="w-full" title={said}>
      <div aria-hidden className="flex h-1.5 gap-px overflow-hidden rounded-full">
        {parts.map(p => counts[p.key] > 0 && <span key={p.key} className={p.tone} style={{ width: `${(counts[p.key] / total) * 100}%` }} />)}
      </div>
      <p className="sr-only">{said}</p>
    </div>
  )
}

export function KnowledgeBoard({ map, reviewDue }: { map: Loaded<NovaKnowledgeMapView>; reviewDue: NovaTodayReady['reviewDue'] }) {
  const ready = map.view?.status === 'ready' ? map.view : null
  const cards = ready ? subjectCards(ready) : []
  const due   = dueMarks(reviewDue)

  return (
    <section aria-labelledby="knowledge-board" data-section="knowledge-board">
      <SectionHeading id="knowledge-board" icon={Library} aside={
        <>
          <Link href="/knowledge" className={TEXT_LINK}>Knowledge Space</Link>
          <Link href="/map" className={TEXT_LINK}>Map <ArrowRight aria-hidden className="size-3" /></Link>
        </>
      }>
        Your knowledge
      </SectionHeading>

      {ready && (
        <p className="mt-1.5 text-xs text-foreground/60">
          {plural(ready.counts.subject, 'subject', 'subjects')} · {plural(ready.counts.topic, 'topic', 'topics')} · {plural(ready.counts.note, 'note', 'notes')} · {plural(ready.counts.resource, 'saved page', 'saved pages')}
          {reviewDue.count > 0 && !due.complete && (
            <> · <Link href="/knowledge" className="font-medium text-amber-300 hover:underline">{plural(reviewDue.count, 'topic', 'topics')} due for review</Link></>
          )}
        </p>
      )}

      <div className="mt-3">
        {!ready && map.loading ? (
          <div aria-busy="true" aria-label="Loading your knowledge" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className={cn('h-32 rounded-2xl', i === 0 && 'xl:col-span-2')} />)}
          </div>
        ) : !ready && map.error ? (
          <LoadFailed what="Your knowledge" onRetry={map.refresh} />
        ) : !ready ? null : cards.length === 0 ? (
          <p className="text-sm leading-relaxed text-foreground/60">
            No subjects on record yet. <Link href="/settings/study" className="underline decoration-white/25 underline-offset-4 hover:text-foreground">Add them in study setup</Link> and they show here with their topics.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ subject, topics }, index) => {
              const counts = levelCounts(topics)
              return (
                <li key={subject.id} style={toneStyle(subject.label)}
                  className={cn('subject-tone group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/8 bg-card p-4 transition-[box-shadow,border-color,transform] hover:-translate-y-0.5 hover:border-[var(--sc-edge)] hover:shadow-soft',
                    // The first subject leads the mosaic on wide screens.
                    index === 0 && cards.length > 2 && 'xl:col-span-2')}>
                  <span aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-br from-[var(--sc-soft)] via-transparent to-transparent opacity-80" />
                  <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-[var(--sc-soft)] blur-2xl transition-opacity group-hover:opacity-100 sm:opacity-60" />
                  <div className="relative min-w-0">
                    <p className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--sc)] ring-4 ring-[var(--sc-soft)]" />
                      {subject.href
                        ? <Link href={subject.href} className="truncate text-base font-semibold tracking-tight text-foreground hover:text-[var(--sc-ink)]">{subject.label}</Link>
                        : <span className="truncate text-base font-semibold tracking-tight text-foreground">{subject.label}</span>}
                    </p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-foreground/55">
                      <span>{plural(topics.length, 'topic', 'topics')}</span>
                      <span className="inline-flex items-center gap-1" title={plural(subject.notes, 'note', 'notes')}><NotebookPen aria-hidden className="size-3" />{subject.notes}<span className="sr-only"> notes</span></span>
                      <span className="inline-flex items-center gap-1" title={plural(subject.resources, 'saved page', 'saved pages')}><Bookmark aria-hidden className="size-3" />{subject.resources}<span className="sr-only"> saved pages</span></span>
                    </p>
                    <div className="mt-2 max-w-48"><LevelBar counts={counts} total={topics.length} /></div>
                  </div>

                  {topics.length === 0 ? (
                    <p className="relative text-xs text-foreground/55">No topics yet.</p>
                  ) : (
                    <ul aria-label={`Topics in ${subject.label}`} className="relative flex flex-wrap content-start gap-1.5">
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
                            {isDue && <span aria-hidden className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">due</span>}
                          </>
                        )
                        const chip = cn(
                          'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
                          level ? 'border-[var(--sc-edge)] bg-[var(--sc-faint)] text-foreground/85' : 'border-dashed border-white/15 bg-card/60 text-foreground/60',
                          topic.href && 'transition-colors hover:border-[var(--sc)] hover:text-foreground',
                        )
                        const title = level ? `${topic.label}: ${LEVEL_LABEL[level]}, from ${plural(topic.sessions, 'session', 'sessions')}` : `${topic.label}: ${LEVEL_LABEL.unverified}`
                        return (
                          <li key={topic.id} className="max-w-full">
                            {topic.href ? <Link href={topic.href} className={chip} title={title}>{body}</Link> : <span className={chip} title={title}>{body}</span>}
                          </li>
                        )
                      })}
                      {topics.length > TOPICS_SHOWN && subject.href && (
                        <li><Link href={subject.href} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-[var(--sc-ink)] hover:underline">+{topics.length - TOPICS_SHOWN} more</Link></li>
                      )}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {ready && cards.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-foreground/55">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(['solid', 'developing', 'weak'] as const).map(l => (
              <span key={l} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn('size-1.5 rounded-full', LEVEL_TONE[l])} />{LEVEL_LABEL[l]}</span>
            ))}
            <span>Dashed: {LEVEL_LABEL.unverified.toLowerCase()}. Levels come from how you said your sessions went.</span>
          </p>
          {ready.unconnected > 0 && (
            <p>
              {plural(ready.unconnected, 'item on the map is', 'items on the map are')} not filed under anything.{' '}
              <Link href="/saved" className="underline decoration-white/25 underline-offset-4 hover:text-foreground">File saved pages on Saved</Link>
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
  const row = cn('-mx-2 flex items-baseline justify-between gap-3 rounded-md px-2 py-2 text-sm', ROW)

  return (
    <section aria-labelledby="recently-captured" data-section="recently-captured">
      <SectionHeading id="recently-captured" icon={Inbox}>Recently captured</SectionHeading>
      <div className="mt-3 grid gap-x-10 gap-y-6 md:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-3 border-b border-white/8 pb-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/70"><NotebookPen aria-hidden className="size-3.5" /> Notes</p>
            <Link href="/notes" className={TEXT_LINK}>All notes</Link>
          </div>
          {noteList === null && notes.loading ? (
            <div aria-busy="true" aria-label="Loading your notes" className="mt-3 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
          ) : noteList === null && notes.error ? (
            <LoadFailed what="Your notes" onRetry={notes.refresh} className="mt-3" />
          ) : noteList === null ? null : noteList.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/60">No notes yet. <Link href="/notes/new" className="underline decoration-white/25 underline-offset-4 hover:text-foreground">Write one</Link>.</p>
          ) : (
            <ul className="mt-1">
              {noteList.map(note => (
                <li key={note.id} className={row}>
                  <Link href={`/notes/${note.id}`} className="min-w-0 truncate text-foreground/90 hover:underline">{note.title}</Link>
                  <span className="shrink-0 text-xs text-foreground/55">{note.subjectName ? `${note.subjectName} · ` : ''}{relativeDay(note.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3 border-b border-white/8 pb-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/70"><Bookmark aria-hidden className="size-3.5" /> Saved pages</p>
            <Link href="/saved" className={TEXT_LINK}>All saved</Link>
          </div>
          {pages === null && map.loading ? (
            <div aria-busy="true" aria-label="Loading your saved pages" className="mt-3 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
          ) : pages === null && map.error ? (
            <LoadFailed what="Your saved pages" onRetry={map.refresh} className="mt-3" />
          ) : pages === null ? null : pages.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/60">Nothing saved yet. <Link href="/saved" className="underline decoration-white/25 underline-offset-4 hover:text-foreground">Save a link</Link>.</p>
          ) : (
            <ul className="mt-1">
              {pages.map(page => (
                <li key={page.id} className={row}>
                  {page.href
                    ? <Link href={page.href} className="min-w-0 truncate text-foreground/90 hover:underline">{page.label}</Link>
                    : <span className="min-w-0 truncate text-foreground/90">{page.label}</span>}
                  <span className="shrink-0 text-xs text-foreground/55">{page.domain} · {page.kind === 'study_requested' ? 'asked to study' : 'saved'} {relativeDay(page.savedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

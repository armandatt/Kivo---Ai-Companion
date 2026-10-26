'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, LayoutGrid, Plus, Rows3, Search, Upload } from 'lucide-react'
import type { NovaNotesReady, NovaNotesView, NoteSummary } from '@repo/api/nova/product/notes.types'
import { relativeDay } from '../format'
import { subjectColor } from '../subject-color'
import { useNovaView } from '../use-nova-view'
import { notesUrl } from './notes-api'
import { groupNotes } from './notes-tree-data'
import { PageAction, PageFrame, PageHeader, PageLoading, PageNotice, RetryButton } from '@/components/dashboard/page-states'

const selectClass =
  'h-10 min-w-0 rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground/85 focus:border-keppel-400/60 focus:outline-none'

// The shared narrow frame; cards by subject get more room.
function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <PageFrame width="narrow" className={wide ? 'max-w-5xl' : undefined}>{children}</PageFrame>
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <PageNotice title={title} action={<PageAction href="/home">Go to Today</PageAction>}>{body}</PageNotice>
    </Frame>
  )
}

// A note as a card: its subject's colour along the edge, its opening lines.
function NoteCard({ note }: { note: NoteSummary }) {
  const color = subjectColor(note.subjectName)
  return (
    <li data-note={note.id} data-note-title={note.title}>
      <Link href={`/notes/${note.id}`}
        className={`group flex h-full flex-col rounded-2xl border border-white/8 border-l-[3px] bg-card/40 px-4 py-3.5 transition-colors hover:bg-white/[0.04] ${note.subjectId ? color.border : 'border-l-white/15'}`}>
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 size-4 shrink-0 text-foreground/30 group-hover:text-keppel-300" aria-hidden />
          <h3 className="line-clamp-2 min-w-0 flex-1 font-serif text-[16px] font-semibold leading-snug text-foreground/90">{note.title}</h3>
        </div>
        {note.preview && <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-foreground/50">{note.preview}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3 text-[11px]">
          <span className="min-w-0 truncate text-foreground/45">{note.topicName ?? ''}</span>
          <span className="shrink-0 text-foreground/35">{relativeDay(note.updatedAt)}</span>
        </div>
      </Link>
    </li>
  )
}

function NoteItem({ note }: { note: NoteSummary }) {
  const context = [note.subjectName, note.topicName].filter(Boolean).join(' · ')
  return (
    <li data-note={note.id} data-note-title={note.title}>
      <Link href={`/notes/${note.id}`} className="block px-4 py-4 transition-colors hover:bg-white/3 sm:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="min-w-0 truncate text-[15px] font-medium text-foreground/90">{note.title}</h3>
          <p className="shrink-0 text-xs text-foreground/40">{relativeDay(note.updatedAt)}</p>
        </div>
        <p className="mt-0.5 text-xs text-keppel-300/70">{context || <span className="text-foreground/35">No subject</span>}</p>
        {note.preview && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-foreground/50">{note.preview}</p>}
      </Link>
    </li>
  )
}

// The learner's notebook: their own notes, searchable, narrowed by the
// subjects and topics they are studying. Nothing here is generated.
export function NotesList() {
  const [search, setSearch]       = useState('')
  const [q, setQ]                 = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [topic, setTopic]         = useState('')

  // A subject named in the address (from a note's breadcrumb) is the filter.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('subjectId')
    if (id) setSubjectId(id)
  }, [])

  // Search as the learner types, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const url = useMemo(() => notesUrl({ q, subjectId, topic }), [q, subjectId, topic])
  const { view, loading, refreshing, error, refresh } = useNovaView<NovaNotesView>(url)

  if (loading) {
    return (
      <PageLoading label="Loading your notes" width="narrow">
        <div className="space-y-5">
          <div className="h-8 w-32 animate-pulse rounded-lg bg-white/5" />
          <div className="h-10 animate-pulse rounded-xl bg-white/4" />
          <div className="h-64 animate-pulse rounded-2xl bg-white/3" />
        </div>
      </PageLoading>
    )
  }

  if (!view) {
    return (
      <Frame>
        <PageNotice tone="error" title="Couldn't load your notes" action={<RetryButton onRetry={() => void refresh()} busy={refreshing} />}>
          The server didn&apos;t answer. Your notes are saved.
        </PageNotice>
      </Frame>
    )
  }

  if (view.status === 'not_nova') return <Notice title="Notes are part of Nova" body="This account uses a different companion, so there is no notebook here." />
  if (view.status === 'not_connected') return <Notice title="Connect Nova first" body="Nova has no learner linked to this account yet. Connect it on Today." />
  if (view.status === 'onboarding_incomplete') return <Notice title="Finish setting up with Nova" body="Your notebook opens once Nova knows what you are studying. Finish the short setup conversation on Today." />

  return <Ready view={view} search={search} onSearch={setSearch} subjectId={subjectId} onSubject={id => { setSubjectId(id); setTopic('') }} topic={topic} onTopic={setTopic} filtered={Boolean(q || subjectId || topic)} busy={refreshing} stale={error} />
}

function Ready({ view, search, onSearch, subjectId, onSubject, topic, onTopic, filtered, busy, stale }: {
  view: NovaNotesReady; search: string; onSearch: (v: string) => void
  subjectId: string; onSubject: (v: string) => void; topic: string; onTopic: (v: string) => void
  filtered: boolean; busy: boolean; stale: boolean
}) {
  // Topics offered are the chosen subject's, or every subject's when none is chosen.
  const topics = useMemo(() => {
    const names = (subjectId ? view.subjects.filter(s => s.id === subjectId) : view.subjects).flatMap(s => s.topics)
    return [...new Map(names.map(n => [n.toLowerCase(), n])).values()].sort((a, b) => a.localeCompare(b))
  }, [view.subjects, subjectId])
  const groups = useMemo(() => groupNotes(view.notes), [view.notes])

  // Cards by subject, or one list: this browser's choice, kept if it can be.
  const [layout, setLayout] = useState<'cards' | 'list'>('cards')
  useEffect(() => { try { if (window.localStorage.getItem('kivo-notes-list') === 'list') setLayout('list') } catch { /* storage off */ } }, [])
  const choose = (l: 'cards' | 'list') => { setLayout(l); try { window.localStorage.setItem('kivo-notes-list', l) } catch { /* storage off */ } }

  return (
    <Frame wide={layout === 'cards'}>
      <PageHeader
        title="Notes"
        description="Your learning notebook"
        actions={<>
          <Link href="/notes/capture" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5" data-notes-capture>
            <Upload aria-hidden className="size-4" /> Capture or import
          </Link>
          <PageAction href="/notes/new"><Plus aria-hidden className="size-4" /> New note</PageAction>
        </>}
      />

      {view.total > 0 && (
        <div className="mt-6 space-y-3">
          <label className="relative block">
            <span className="sr-only">Search notes</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <input
              type="search"
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search notes…"
              className="h-11 w-full rounded-xl border border-white/10 bg-transparent pl-10 pr-3 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Subject" value={subjectId} onChange={e => onSubject(e.target.value)} className={selectClass}>
              <option value="">All subjects</option>
              {view.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select aria-label="Topic" value={topic} onChange={e => onTopic(e.target.value)} className={selectClass} disabled={topics.length === 0}>
              <option value="">All topics</option>
              {topics.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div role="radiogroup" aria-label="Show notes as" className="ml-auto inline-flex rounded-xl border border-white/10 p-0.5">
              {([['cards', LayoutGrid, 'Cards by subject'], ['list', Rows3, 'One list']] as const).map(([l, Icon, label]) => (
                <button key={l} type="button" role="radio" aria-checked={layout === l} onClick={() => choose(l)} title={label} aria-label={label}
                  className={`inline-flex size-9 items-center justify-center rounded-lg transition-colors ${layout === l ? 'bg-white/10 text-foreground' : 'text-foreground/45 hover:text-foreground'}`}>
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {stale && <p role="status" className="mt-4 text-xs text-amber-300/80">Showing what loaded last. Reconnecting…</p>}

      <div className="mt-6" aria-live="polite">
        {view.total === 0 ? (
          <section className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center" data-empty="notes">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Nothing written yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-foreground/55">
              Write down what you are learning, in your own words. Give a note a subject and topic and you can study straight from it.
            </p>
            <Link href="/notes/new" className="mt-6 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
              <Plus className="size-4" /> Write your first note
            </Link>
          </section>
        ) : view.notes.length === 0 ? (
          <p className="rounded-2xl border border-white/8 bg-card/40 px-5 py-6 text-sm text-foreground/55" data-empty="results">
            No notes match{filtered ? ' that search' : ''}.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-foreground/40" data-count>
              {filtered ? `${view.notes.length} of ${view.total} notes` : `${view.total} note${view.total === 1 ? '' : 's'}`}
            </p>
            {layout === 'cards' ? (
              <div className={`space-y-8 transition-opacity ${busy ? 'opacity-70' : ''}`} data-notes-cards>
                {groups.map(g => {
                  const color = subjectColor(g.subjectName)
                  return (
                    <section key={g.subjectId ?? 'none'} aria-label={g.subjectName ?? 'No subject'}>
                      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground/80">
                        <span className={`size-2 rounded-full ${g.subjectId ? color.dot : 'bg-foreground/25'}`} aria-hidden />
                        {g.subjectName ?? 'No subject'}
                        <span className="text-xs font-normal text-foreground/35">{g.count}</span>
                      </h2>
                      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {g.topics.flatMap(t => t.notes).map(note => <NoteCard key={note.id} note={note} />)}
                      </ul>
                    </section>
                  )
                })}
              </div>
            ) : (
              <ul className={`divide-y divide-white/6 overflow-hidden rounded-2xl border border-white/8 bg-card/40 transition-opacity ${busy ? 'opacity-70' : ''}`}>
                {view.notes.map(note => <NoteItem key={note.id} note={note} />)}
              </ul>
            )}
          </>
        )}
      </div>
    </Frame>
  )
}

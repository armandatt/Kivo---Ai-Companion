'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import type { NovaNotesReady, NovaNotesView, NoteSummary } from '@repo/api/nova/product/notes.types'
import { relativeDay } from '../format'
import { useNovaView } from '../use-nova-view'
import { notesUrl } from './notes-api'

const selectClass =
  'h-10 min-w-0 rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground/85 focus:border-keppel-400/60 focus:outline-none'

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">{children}</div>
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

  // Search as the learner types, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const url = useMemo(() => notesUrl({ q, subjectId, topic }), [q, subjectId, topic])
  const { view, loading, refreshing, error, refresh } = useNovaView<NovaNotesView>(url)

  if (loading) {
    return (
      <Frame>
        <div aria-busy="true" aria-label="Loading your notes" className="space-y-5">
          <div className="h-8 w-32 animate-pulse rounded-lg bg-white/5" />
          <div className="h-10 animate-pulse rounded-xl bg-white/4" />
          <div className="h-64 animate-pulse rounded-2xl bg-white/3" />
        </div>
      </Frame>
    )
  }

  if (!view) {
    return (
      <Frame>
        <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your notes</h1>
          <p className="mt-3 text-sm leading-relaxed text-foreground/65">The server didn&apos;t answer. Your notes are saved.</p>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-60">
            {refreshing ? 'Trying…' : 'Try again'}
          </button>
        </section>
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

  return (
    <Frame>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Notes</h1>
          <p className="mt-1.5 text-sm text-foreground/55">Your learning notebook</p>
        </div>
        <Link href="/notes/new" className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
          <Plus className="size-4" /> New note
        </Link>
      </header>

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
          <div className="flex flex-wrap gap-2">
            <select aria-label="Subject" value={subjectId} onChange={e => onSubject(e.target.value)} className={selectClass}>
              <option value="">All subjects</option>
              {view.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select aria-label="Topic" value={topic} onChange={e => onTopic(e.target.value)} className={selectClass} disabled={topics.length === 0}>
              <option value="">All topics</option>
              {topics.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
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
            <ul className={`divide-y divide-white/6 overflow-hidden rounded-2xl border border-white/8 bg-card/40 transition-opacity ${busy ? 'opacity-70' : ''}`}>
              {view.notes.map(note => <NoteItem key={note.id} note={note} />)}
            </ul>
          </>
        )}
      </div>
    </Frame>
  )
}

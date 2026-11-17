'use client'

// The one place to choose where something is filed in Kivo: Drafts (a
// passage, a new note), paper import, Save a link and Notes all use this
// picker; the extension's Capture follows the same steps (apps/extension
// lib/places.js).
//
//   1. Search, or browse: subjects → the topics inside a subject → the topics
//      inside a topic, with a breadcrumb back up.
//   2. Every name is shown in full (it wraps; nothing is cut to "…"), and a
//      search result shows its whole path, so two "Introduction" topics in
//      different subjects never look the same.
//   3. Kivo's own suggestion, when there is one, is chosen to start with and
//      marked as such; whatever the user picks replaces it and stays.
//   4. Only existing subjects and topics can be chosen. A new topic is made
//      only by the explicit "Create new topic …" row, in the subject being
//      browsed (Subject Studio's batch, paper-api.ts). Typing a name that
//      matches nothing never files under a new name.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, FolderClosed, Hash, Inbox, Loader2, Plus, Search, Sparkles } from 'lucide-react'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { NOTE_TOPIC_MAX } from '@repo/api/nova/product/notes.types'
import { NO_SUBJECT, ancestorsOf, childrenOf, destinationLabel, destinationParents, destinationsOf, existingTopic, searchDestinations, type Destination } from './note-destinations'
import { createTopic } from './paper-api'

const ICON = { none: Inbox, subject: FolderClosed, topic: Hash } as const

type Row =
  | { kind: 'dest'; dest: Destination; note?: string; showPath: boolean }
  | { kind: 'create'; subjectId: string; subjectLabel: string; name: string }

export function DestinationPicker({ subjects, value, onChange, onSubjectsChanged, suggestion = null, allowNone = true }: {
  subjects: NoteSubjectOption[]
  value: Destination
  onChange: (d: Destination) => void
  // The subjects again, after a topic was made.
  onSubjectsChanged: () => Promise<NoteSubjectOption[] | null>
  // Kivo's own filing suggestion, shown first and marked (the caller starts `value` on it).
  suggestion?: Destination | null
  allowNone?: boolean
}) {
  const listId = useId()
  const all = useMemo(() => destinationsOf(subjects), [subjects])
  const parents = useMemo(() => destinationParents(subjects), [subjects])
  const byKey = useMemo(() => new Map(all.map(d => [d.key, d] as const)), [all])
  const [query, setQuery] = useState('')
  // Where the list is browsing: null is the top level. It opens on the chosen place's parent.
  const [at, setAt] = useState<string | null>(() => (value.kind === 'none' ? null : parents.get(value.key) ?? null))
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => { if (at && !byKey.has(at)) setAt(null) }, [at, byKey])

  const typed = query.trim()
  const hasKids = (key: string) => childrenOf(all, parents, key).length > 0
  const crumbs = ancestorsOf(parents, at).map(k => byKey.get(k)).filter((d): d is Destination => !!d)
  // The subject a new topic would go into: the one being browsed, else the chosen one.
  const subjectKey = [...crumbs].reverse().find(d => d.kind === 'subject')?.key ?? (value.subjectId ? `s:${value.subjectId}` : null)
  const subject = subjectKey ? byKey.get(subjectKey) ?? null : null

  const rows: Row[] = useMemo(() => {
    if (typed) {
      const found = searchDestinations(all, typed).filter(d => allowNone || d.kind !== 'none').slice(0, 60).map(dest => ({ kind: 'dest' as const, dest, showPath: true }))
      const canCreate = subject && typed.length <= NOTE_TOPIC_MAX && !existingTopic(all, subject.subjectId!, typed)
      return canCreate ? [...found, { kind: 'create' as const, subjectId: subject.subjectId!, subjectLabel: destinationLabel(subject), name: typed }] : found
    }
    const out: Row[] = []
    if (at === null) {
      if (suggestion && byKey.has(suggestion.key)) out.push({ kind: 'dest', dest: suggestion, note: 'Kivo’s suggestion', showPath: true })
      if (allowNone) out.push({ kind: 'dest', dest: NO_SUBJECT, showPath: false })
    } else {
      const here = byKey.get(at)
      if (here) out.push({ kind: 'dest', dest: here, note: here.kind === 'subject' ? 'This subject itself' : 'This topic itself', showPath: false })
    }
    for (const d of childrenOf(all, parents, at)) out.push({ kind: 'dest', dest: d, showPath: false })
    return out
  }, [typed, all, at, byKey, parents, suggestion, subject, allowNone])

  const current = Math.min(active, Math.max(rows.length - 1, 0))
  useEffect(() => { listRef.current?.querySelector(`[data-row="${current}"]`)?.scrollIntoView({ block: 'nearest' }) }, [current])

  function open(key: string) { setAt(key); setQuery(''); setActive(0) }
  function up() { setAt(at ? parents.get(at) ?? null : null); setActive(0) }
  function pick(row: Row) {
    if (row.kind === 'create') return void create(row)
    setError(null)
    onChange(row.dest)
  }

  async function create(row: Extract<Row, { kind: 'create' }>) {
    if (creating) return
    setCreating(true); setError(null)
    const r = await createTopic(row.subjectId, row.name)
    if (!r.ok) { setCreating(false); setError(r.message); return }
    const next = await onSubjectsChanged()
    setCreating(false)
    const made = next ? existingTopic(destinationsOf(next), row.subjectId, row.name) : null
    if (made) { onChange(made); setQuery('') }
    else setError('The topic was made, but the list didn’t refresh. Close and reopen this to see it.')
  }

  const chosenIsSuggestion = !!suggestion && value.key === suggestion.key
  return (
    <div data-destination-picker>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-foreground/60">
        <span>Save to</span>
        <span className="min-w-0 break-words font-medium text-foreground" data-destination-chosen>{destinationLabel(value)}</span>
        {chosenIsSuggestion && <span className="inline-flex items-center gap-1 rounded-full border border-nova/30 px-1.5 py-px text-[10.5px] text-nova-ink" data-destination-suggested><Sparkles className="size-3" aria-hidden /> Kivo’s suggestion</span>}
      </div>
      <div className="rounded-xl border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/8 px-3">
          <Search className="size-3.5 shrink-0 text-subtle" aria-hidden />
          <input value={query} onChange={e => { setQuery(e.target.value); setActive(0); setError(null) }}
            role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label="Search your subjects and topics"
            aria-activedescendant={rows.length ? `${listId}-${current}` : undefined}
            onKeyDown={e => {
              const row = rows[current]
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, rows.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); if (row) pick(row) }
              else if (e.key === 'ArrowRight' && !typed && row?.kind === 'dest' && row.dest.kind !== 'none' && !row.note && hasKids(row.dest.key)) { e.preventDefault(); open(row.dest.key) }
              else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && !typed && at) { e.preventDefault(); up() }
            }}
            placeholder="Search subjects and topics…" className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35" data-destination-search />
        </div>
        {!typed && at && (
          <nav aria-label="Where you are" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-white/8 px-2.5 py-1.5 text-xs" data-destination-crumbs>
            <button type="button" onClick={up} className="inline-flex items-center rounded px-1 py-0.5 text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Up one level" data-destination-up><ChevronLeft className="size-3.5" /></button>
            <button type="button" onClick={() => { setAt(null); setActive(0) }} className="rounded px-1 py-0.5 text-subtle hover:bg-white/6 hover:text-foreground">All subjects</button>
            {crumbs.map((d, i) => (
              <span key={d.key} className="inline-flex items-center gap-1">
                <span className="text-subtle">›</span>
                {i === crumbs.length - 1
                  ? <span className="break-words font-medium text-foreground">{d.path[d.path.length - 1]}</span>
                  : <button type="button" onClick={() => open(d.key)} className="break-words rounded px-1 py-0.5 text-subtle hover:bg-white/6 hover:text-foreground">{d.path[d.path.length - 1]}</button>}
              </span>
            ))}
          </nav>
        )}
        <ul id={listId} ref={listRef} role="listbox" aria-label="Where to save it" className="max-h-60 overflow-y-auto p-1">
          {rows.length === 0 && <li role="presentation" className="px-2.5 py-2 text-xs text-subtle">{typed ? 'Nothing by that name. Pick a subject to create a topic in it.' : 'Nothing inside yet.'}</li>}
          {rows.map((row, i) => {
            if (row.kind === 'create') {
              return (
                <li key="create" id={`${listId}-${i}`} data-row={i} role="option" aria-selected={false} onMouseMove={() => setActive(i)} onClick={() => pick(row)}
                  className={`mt-1 flex cursor-pointer items-start gap-2 rounded-lg border border-dashed border-nova/35 px-2.5 py-1.5 text-sm ${i === current ? 'bg-nova/10' : ''}`} data-destination-create>
                  {creating ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-nova-ink" /> : <Plus className="mt-0.5 size-3.5 shrink-0 text-nova-ink" aria-hidden />}
                  <span className="min-w-0 flex-1 break-words">
                    <span className="mr-1.5 rounded bg-nova/15 px-1 py-px text-[10.5px] font-semibold uppercase tracking-wide text-nova-ink">New topic</span>
                    Create “{row.name}” in {row.subjectLabel}
                    <span className="block text-xs text-subtle">No topic has this name. It will be made as a top-level topic of this subject.</span>
                  </span>
                </li>
              )
            }
            const d = row.dest
            const Icon = ICON[d.kind]
            const chosen = d.key === value.key
            const name = d.path[d.path.length - 1]!
            const kids = !typed && !row.note && d.kind !== 'none' && hasKids(d.key)
            return (
              <li key={`${d.key}-${row.note ?? ''}`} id={`${listId}-${i}`} data-row={i} role="option" aria-selected={chosen} onMouseMove={() => setActive(i)}
                className={`flex items-start gap-1 rounded-lg text-sm ${i === current ? 'bg-white/7' : ''}`} data-destination={d.key}>
                <button type="button" onClick={() => pick(row)} title={destinationLabel(d)} className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-1.5 text-left">
                  {row.note === 'Kivo’s suggestion' ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-nova-ink" aria-hidden /> : <Icon className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />}
                  <span className="min-w-0 flex-1 break-words">
                    {row.showPath && d.path.length > 1 && <span className="text-subtle">{d.path.slice(0, -1).join(' › ')} › </span>}
                    <span className="text-foreground">{name}</span>
                    {row.note && <span className="block text-xs text-subtle">{row.note}</span>}
                  </span>
                  {chosen && <Check className="mt-0.5 size-3.5 shrink-0 text-nova-ink" aria-label="Chosen" />}
                </button>
                {kids && (
                  <button type="button" onClick={() => open(d.key)} aria-label={`Show what is inside ${name}`} title={`Inside ${name}`}
                    className="my-0.5 mr-0.5 grid size-7 shrink-0 place-items-center rounded-md text-subtle hover:bg-white/8 hover:text-foreground" data-destination-open>
                    <ChevronRight className="size-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      {subjects.length === 0 && <p className="mt-1.5 text-xs text-subtle">You have no subjects yet, so it is saved with no subject. Add subjects in Knowledge to file things there.</p>}
      {error && <p role="alert" className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  )
}

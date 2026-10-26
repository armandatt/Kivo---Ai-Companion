'use client'

// Choosing where a note goes: one of the learner's subjects or topics, shown
// with the whole path (Semester Five › Operating Systems › Deadlocks), or no
// subject. Search matches any part of the path. A new topic is made only by
// the learner's own "Create topic" (Subject Studio's batch, paper-api.ts),
// in the subject chosen; nothing is created by typing.

import { useId, useMemo, useState } from 'react'
import { Check, FolderClosed, Hash, Inbox, Loader2, Plus, Search } from 'lucide-react'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { NOTE_TOPIC_MAX } from '@repo/api/nova/product/notes.types'
import { destinationLabel, destinationsOf, searchDestinations, type Destination } from './note-destinations'
import { createTopic } from './paper-api'

const ICON = { none: Inbox, subject: FolderClosed, topic: Hash } as const

export function DestinationPicker({ subjects, value, onChange, onSubjectsChanged }: {
  subjects: NoteSubjectOption[]
  value: Destination
  onChange: (d: Destination) => void
  // The subjects again, after a topic was made.
  onSubjectsChanged: () => Promise<NoteSubjectOption[] | null>
}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const all = useMemo(() => destinationsOf(subjects), [subjects])
  const shown = useMemo(() => searchDestinations(all, query).slice(0, 60), [all, query])
  const typed = query.trim()
  // "Create topic" only names a subject the learner chose, and only for a
  // name no topic of that subject has.
  const subject = value.subjectId ? all.find(d => d.kind === 'subject' && d.subjectId === value.subjectId) ?? null : null
  const canCreate = !!subject && typed.length > 0 && typed.length <= NOTE_TOPIC_MAX
    && !all.some(d => d.subjectId === subject.subjectId && d.topicName?.toLowerCase() === typed.toLowerCase())
  const current = Math.min(active, Math.max(shown.length - 1, 0))

  async function create() {
    if (!subject || !canCreate || creating) return
    setCreating(true); setError(null)
    const r = await createTopic(subject.subjectId!, typed)
    if (!r.ok) { setCreating(false); setError(r.message); return }
    const next = await onSubjectsChanged()
    setCreating(false)
    const made = next ? destinationsOf(next).find(d => d.subjectId === subject.subjectId && d.topicName?.toLowerCase() === typed.toLowerCase()) : null
    if (made) { onChange(made); setQuery('') }
    else setError('The topic was made, but the list didn’t refresh. Close and reopen this to see it.')
  }

  return (
    <div data-destination-picker>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs text-foreground/60">Save to <span className="min-w-0 truncate font-medium text-foreground" data-destination-chosen>{destinationLabel(value)}</span></p>
      <div className="rounded-xl border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/8 px-3">
          <Search className="size-3.5 shrink-0 text-subtle" aria-hidden />
          <input value={query} onChange={e => { setQuery(e.target.value); setActive(0); setError(null) }}
            role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label="Search your subjects and topics"
            aria-activedescendant={shown.length ? `${listId}-${current}` : undefined}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); if (shown[current]) onChange(shown[current]!) }
            }}
            placeholder="Search subjects and topics…" className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35" data-destination-search />
        </div>
        <ul id={listId} role="listbox" aria-label="Where to save it" className="max-h-44 overflow-y-auto p-1">
          {shown.length === 0 && <li role="presentation" className="px-2.5 py-2 text-xs text-subtle">Nothing by that name.</li>}
          {shown.map((d, i) => {
            const Icon = ICON[d.kind]
            const chosen = d.key === value.key
            return (
              <li key={d.key} id={`${listId}-${i}`} role="option" aria-selected={chosen} onMouseMove={() => setActive(i)} onClick={() => onChange(d)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${i === current ? 'bg-white/7' : ''}`} data-destination={d.key}>
                <Icon className="size-3.5 shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {d.path.slice(0, -1).map((p, k) => <span key={k} className="text-subtle">{p} › </span>)}
                  <span className="text-foreground">{d.path[d.path.length - 1]}</span>
                </span>
                {chosen && <Check className="size-3.5 shrink-0 text-nova-ink" aria-label="Chosen" />}
              </li>
            )
          })}
        </ul>
        {canCreate && (
          <div className="border-t border-white/8 px-2 py-1.5">
            <button type="button" onClick={() => void create()} disabled={creating} className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-nova-ink hover:bg-nova/10 disabled:opacity-60" data-destination-create>
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Create topic “{typed}” in {destinationLabel(subject!)}
            </button>
          </div>
        )}
      </div>
      {subjects.length === 0 && <p className="mt-1.5 text-xs text-subtle">You have no subjects yet, so it is saved with no subject. Add subjects in Knowledge to file papers there.</p>}
      {error && <p role="alert" className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  )
}

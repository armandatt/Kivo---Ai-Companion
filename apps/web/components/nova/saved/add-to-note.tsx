'use client'

// A saved passage, into a note the learner already has: find the note by its
// title, see where it is, and add. The passage becomes a new section at the end
// of the note, with where it came from; what is there stays (product/note-append.ts).
// One id for this passage and note: Try again repeats it, and adds nothing twice.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, Search } from 'lucide-react'
import type { NoteChoice, SaveToNoteResult } from '@repo/api/nova/product/note-append'
import type { LearningResource } from '@repo/api/nova/product/learning-events.types'

const FAILED = 'Could not reach the server. Check your connection and try again.'
type Choices = { ok: true; notes: NoteChoice[]; total: number; hasMore: boolean }

export function AddToNote({ resource, onClose, onDone }: { resource: LearningResource; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Choices | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<NoteChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Extract<SaveToNoteResult, { success: true }> | null>(null)
  const eventId = useRef(crypto.randomUUID())
  const latest = useRef(0)

  const load = useCallback(async (q: string, skip: number) => {
    const asked = ++latest.current
    setError(null)
    try {
      const res = await fetch(`/api/nova/notes/append?${new URLSearchParams({ q, skip: String(skip) })}`, { cache: 'no-store' })
      const data = await res.json() as Choices
      if (asked !== latest.current) return
      if (!data?.ok) { setError(FAILED); return }
      setFound(prev => (skip > 0 && prev ? { ...data, notes: [...prev.notes, ...data.notes] } : data))
    } catch { if (asked === latest.current) setError(FAILED) }
  }, [])
  useEffect(() => { const t = window.setTimeout(() => void load(query, 0), 200); return () => window.clearTimeout(t) }, [query, load])

  async function add() {
    if (!chosen || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/nova/notes/append', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: chosen.id, clientEventId: eventId.current, url: resource.url, title: resource.title, excerpt: resource.excerpt, capturedAt: new Date().toISOString() }),
      })
      const data = await res.json() as SaveToNoteResult
      if (data.success) { setDone(data); onDone() } else setError(data.message)
    } catch { setError(`${FAILED} Nothing was added.`) }
    setBusy(false)
  }

  if (done) {
    return (
      <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-keppel-400/25 bg-keppel-400/5 px-3 py-2.5 text-sm" data-add-note-done={done.action}>
        <Check aria-hidden className="size-4 text-keppel-300" />
        <span className="min-w-0 flex-1 text-foreground/85">{done.action === 'already_in_note' ? `Already in ${done.note.title}. Nothing was added.` : `Added to ${done.note.title}.`}</span>
        <Link href={`/notes/${encodeURIComponent(done.note.id)}`} className="font-medium text-keppel-300 hover:underline">Open the note</Link>
        <button type="button" onClick={onClose} className="text-foreground/60 hover:text-foreground">Close</button>
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-card/60 p-3" data-add-note>
      {chosen ? (
        <>
          <p className="text-sm font-medium text-foreground">{chosen.title}</p>
          <p className="mt-0.5 text-xs text-foreground/55">{chosen.path || 'Not filed under a subject'}</p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/60">This passage goes at the end as a new section, with the page it came from. You can edit it like the rest of the note.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void add()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-keppel-400 px-3 text-xs font-semibold text-keppel-950 hover:bg-keppel-300 disabled:opacity-60" data-add-note-confirm>
              {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}{error ? 'Try again' : 'Add to this note'}
            </button>
            <button type="button" onClick={() => setChosen(null)} className="h-9 rounded-lg px-3 text-xs text-foreground/70 hover:bg-white/5">Choose another</button>
          </div>
        </>
      ) : (
        <>
          <label className="relative block">
            <span className="sr-only">Search your notes by title</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
            <input value={query} autoFocus onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose() }} placeholder="Search your notes by title"
              className="h-9 w-full rounded-lg border border-white/10 bg-transparent pl-8 pr-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-keppel-400/60 focus:outline-none" data-add-note-search />
          </label>
          {found && found.notes.length === 0 && <p className="mt-2 text-xs text-foreground/55">{query.trim() ? 'No notes with that title.' : 'You have no notes yet.'}</p>}
          {found && found.notes.length > 0 && (
            <ul className="mt-2 max-h-56 divide-y divide-white/6 overflow-y-auto rounded-lg border border-white/8">
              {found.notes.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => setChosen(n)} title={n.title} className="block w-full px-3 py-2 text-left hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none" data-add-note-choice={n.id}>
                    <span className="block truncate text-sm text-foreground/90">{n.title}</span>
                    <span className="block truncate text-xs text-foreground/50">{n.path || 'Not filed under a subject'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-3">
            {found?.hasMore && <button type="button" onClick={() => void load(query, found.notes.length)} className="text-xs font-medium text-foreground/70 hover:text-foreground">Show more</button>}
            <button type="button" onClick={onClose} className="ml-auto text-xs text-foreground/60 hover:text-foreground">Cancel</button>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-amber-300/90">{error}</p>}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2, Pencil, Trash2 } from 'lucide-react'
import type { NoteDetail, NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from '@repo/api/nova/product/notes.types'
import { minutesLabel, relativeDay } from '../format'
import { useStartSession } from '../use-start-session'
import { createNote, deleteNote, fetchNote, fetchNotes, updateNote } from './notes-api'

type Draft = { title: string; body: string; subjectId: string; topicName: string }

const EMPTY: Draft = { title: '', body: '', subjectId: '', topicName: '' }
const draftOf = (note: NoteDetail): Draft =>
  ({ title: note.title, body: note.body, subjectId: note.subjectId ?? '', topicName: note.topicName ?? '' })
const same = (a: Draft, b: Draft) =>
  a.title === b.title && a.body === b.body && a.subjectId === b.subjectId && a.topicName === b.topicName

const LEAVE = 'You have changes that are not saved. Leave without saving?'
const field =
  'w-full rounded-xl border border-white/10 bg-transparent px-3.5 text-foreground placeholder:text-foreground/30 focus:border-keppel-400/60 focus:outline-none'
const primary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-60'
const quiet =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5 disabled:opacity-60'

// One note: read it, edit it, delete it, study from it.
// The text is the learner's. This page only ever saves what they typed, when
// they press Save; nothing rewrites it and nothing is sent anywhere else.
export function NoteEditor({ noteId }: { noteId: string | null }) {
  const router = useRouter()
  const { start, starting, error: startError } = useStartSession()

  const [note, setNote]         = useState<NoteDetail | null>(null)
  const [subjects, setSubjects] = useState<NoteSubjectOption[]>([])
  const [running, setRunning]   = useState<{ topicName: string | null } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [missing, setMissing]   = useState<string | null>(null)

  const [editing, setEditing]   = useState(noteId === null)
  const [draft, setDraft]       = useState<Draft>(EMPTY)
  const [saved, setSaved]       = useState<Draft>(EMPTY)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const dirty = editing && !same(draft, saved)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [list, loaded] = await Promise.all([fetchNotes(), noteId ? fetchNote(noteId) : Promise.resolve(null)])
      if (cancelled) return
      if (list?.status === 'ready') { setSubjects(list.subjects); setRunning(list.activeSession) }
      else if (list) setMissing('Notes are part of Nova, and this account is not set up with it yet.')

      if (noteId) {
        if (loaded?.ok) { setNote(loaded.note); setDraft(draftOf(loaded.note)); setSaved(draftOf(loaded.note)) }
        else setMissing(loaded?.error === 'not_found' ? "That note doesn't exist. It may have been deleted." : loaded?.message ?? 'Could not load that note.')
      } else {
        // A new note can arrive with its context already chosen (from Knowledge).
        const params  = new URLSearchParams(window.location.search)
        const subject = list?.status === 'ready' ? list.subjects.find(s => s.id === params.get('subjectId')) : undefined
        const initial = { ...EMPTY, subjectId: subject?.id ?? '', topicName: subject ? (params.get('topic') ?? '').slice(0, NOTE_TOPIC_MAX) : '' }
        setDraft(initial); setSaved(initial)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [noteId])

  // Closing the tab or reloading with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const leave = useCallback((e: React.MouseEvent) => {
    if (dirty && !window.confirm(LEAVE)) e.preventDefault()
  }, [dirty])

  const topicOptions = useMemo(
    () => subjects.find(s => s.id === draft.subjectId)?.topics ?? [],
    [subjects, draft.subjectId],
  )

  async function save() {
    setSaving(true)
    setError(null)
    const input = { title: draft.title, body: draft.body, subjectId: draft.subjectId || null, topicName: draft.topicName.trim() || null }
    const res = note ? await updateNote(note.id, input) : await createNote(input)
    setSaving(false)
    if (!res.ok) { setError(res.message); return }
    setNote(res.note); setDraft(draftOf(res.note)); setSaved(draftOf(res.note)); setEditing(false)
    if (!note) router.replace(`/notes/${res.note.id}`)
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your changes?')) return
    if (!note) { router.push('/notes'); return }
    setDraft(saved); setEditing(false); setError(null)
  }

  async function remove() {
    if (!note) return
    setDeleting(true)
    const res = await deleteNote(note.id)
    if (res.ok) { router.push('/notes'); return }
    setDeleting(false); setConfirmDelete(false); setError(res.message)
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <Link href="/notes" onClick={leave} className="inline-flex items-center gap-1.5 text-sm text-foreground/50 transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Notes
      </Link>
      {children}
    </div>
  )

  if (loading) {
    return shell(
      <div aria-busy="true" aria-label="Loading note" className="mt-8 space-y-5">
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-white/5" />
        <div className="h-4 w-48 animate-pulse rounded bg-white/4" />
        <div className="h-72 animate-pulse rounded-2xl bg-white/3" />
      </div>,
    )
  }

  if (missing) {
    return shell(
      <section className="mt-8 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-note-missing>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nothing to open</h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/65">{missing}</p>
        <Link href="/notes" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">Back to Notes</Link>
      </section>,
    )
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  if (editing) {
    return shell(
      <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); void save() }} data-note-form>
        <div>
          <label htmlFor="note-title" className="sr-only">Title</label>
          <input
            id="note-title" value={draft.title} maxLength={NOTE_TITLE_MAX} autoFocus={!note}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="Title"
            className={`${field} h-12 text-lg font-semibold`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="note-subject" className="mb-1.5 block text-xs text-foreground/50">Subject</label>
            <select
              id="note-subject" value={draft.subjectId}
              onChange={e => setDraft(d => ({ ...d, subjectId: e.target.value, topicName: e.target.value ? d.topicName : '' }))}
              className={`${field} h-11 text-sm`}
            >
              <option value="">No subject</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="note-topic" className="mb-1.5 block text-xs text-foreground/50">Topic</label>
            <input
              id="note-topic" value={draft.topicName} maxLength={NOTE_TOPIC_MAX} list="note-topics"
              disabled={!draft.subjectId}
              onChange={e => setDraft(d => ({ ...d, topicName: e.target.value }))}
              placeholder={draft.subjectId ? 'e.g. Deadlocks' : 'Choose a subject first'}
              className={`${field} h-11 text-sm disabled:opacity-50`}
            />
            <datalist id="note-topics">{topicOptions.map(t => <option key={t} value={t} />)}</datalist>
          </div>
        </div>
        {subjects.length === 0 && (
          <p className="text-xs text-foreground/45">Nova doesn&apos;t know your subjects yet, so this note can&apos;t be filed under one. You can still write it.</p>
        )}

        <div>
          <label htmlFor="note-body" className="sr-only">Note</label>
          <textarea
            id="note-body" value={draft.body} maxLength={NOTE_BODY_MAX}
            onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
            placeholder="Write what you're learning, in your own words."
            className={`${field} min-h-[22rem] resize-y py-3 text-[15px] leading-relaxed`}
          />
          {draft.body.length > NOTE_BODY_MAX * 0.9 && (
            <p className="mt-1 text-xs text-amber-300/80">{(NOTE_BODY_MAX - draft.body.length).toLocaleString()} characters left</p>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={cancel} disabled={saving} className={quiet}>Cancel</button>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs text-foreground/45" data-unsaved>Not saved</span>}
            <button type="submit" disabled={saving || !draft.title.trim()} className={`${primary} flex-1 sm:flex-none`}>
              {saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Save'}
            </button>
          </div>
        </div>
      </form>,
    )
  }

  // ── Reading ────────────────────────────────────────────────────────────────
  if (!note) return shell(null)
  const context = [note.subjectName, note.topicName].filter(Boolean).join(' · ')

  return shell(
    <article className="mt-6" data-note-view={note.id}>
      <p className="text-xs text-keppel-300/75" data-note-context>{context || <span className="text-foreground/40">No subject</span>}</p>
      <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{note.title}</h1>
      <p className="mt-2 text-xs text-foreground/40">Last updated {relativeDay(note.updatedAt)}</p>

      <section className="mt-6 rounded-2xl border border-white/8 bg-card/50 p-4 sm:p-5" data-study>
        {running ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground/65">
              A session is already running{running.topicName ? <> on <span className="text-foreground/90">{running.topicName}</span></> : null}. Finish it to study from this note.
            </p>
            <Link href="/focus" className={quiet}>Resume session</Link>
          </div>
        ) : note.study.available ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-foreground/65">
              Study <span className="text-foreground/90">{note.topicName}</span> from this note. The session, and how you say it went, is what updates your Knowledge. The note itself does not.
            </p>
            <button
              type="button"
              disabled={starting !== null}
              onClick={() => void start({ topicName: note.topicName!, subjectName: note.subjectName!, durationMinutes: note.study.minutes }, note.id)}
              className={`${primary} shrink-0`}
            >
              {starting ? <><Loader2 className="size-4 animate-spin" /> Starting…</> : <>Study this · {minutesLabel(note.study.minutes)} <ArrowRight className="size-4" /></>}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-foreground/60" data-study-blocked={note.study.blockedBy ?? ''}>
              {note.study.blockedBy === 'no_subject'
                ? 'Study this is unavailable: the note has no subject, and Nova won’t guess one. Add a subject and topic to study from it.'
                : 'Study this is unavailable: the note has no topic. Add one to study from it.'}
            </p>
            <button type="button" onClick={() => setEditing(true)} className={`${quiet} shrink-0`}>Add {note.study.blockedBy === 'no_subject' ? 'subject' : 'topic'}</button>
          </div>
        )}
        {startError && <p role="alert" className="mt-3 text-sm text-red-300">{startError}</p>}
      </section>

      <div className="mt-6 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/85" data-note-body>
        {note.body || <span className="text-foreground/35">This note is empty.</span>}
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-white/8 pt-5">
        <button type="button" onClick={() => setEditing(true)} className={quiet}><Pencil className="size-4" /> Edit</button>
        {confirmDelete ? (
          <>
            <button type="button" onClick={() => void remove()} disabled={deleting} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-400/40 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-60">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete for good'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="text-sm text-foreground/55 hover:text-foreground">Keep it</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex h-11 items-center gap-2 px-2 text-sm text-foreground/50 transition-colors hover:text-red-300">
            <Trash2 className="size-4" /> Delete
          </button>
        )}
      </div>
    </article>,
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Link2, Loader2, Pencil, Trash2 } from 'lucide-react'
import type { NoteDetail, NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from '@repo/api/nova/product/notes.types'
import { TASK_TITLE_MAX } from '@repo/api/nova/product/tasks.types'
import { noteTemplatesFor, type NoteTemplate } from '@repo/api/nova/product/templates'
import { normalizeLearningContexts } from '@repo/api/nova/product/learning-context'
import { minutesLabel, relativeDay } from '../format'
import { useStartSession } from '../use-start-session'
import { NoteBody, linkHref } from './note-body'
import { NoteAssistPanel } from './note-assist-panel'
import { createNote, deleteNote, fetchNote, fetchNotes, updateNote } from './notes-api'

// Unsaved text is kept in this browser while it is typed, so a crash, a
// closed tab or a failed save loses nothing. One entry per note ("new" for
// a note not yet saved), removed once the note is saved or the change is
// discarded. It never leaves the browser.
type StoredDraft = { draft: Draft; base: string | null; at: number }
const draftKey = (id: string | null) => `kivo-note-draft:${id ?? 'new'}`
function readDraft(id: string | null): StoredDraft | null {
  try { const raw = window.localStorage.getItem(draftKey(id)); return raw ? JSON.parse(raw) as StoredDraft : null } catch { return null }
}
function writeDraft(id: string | null, value: StoredDraft | null) {
  try { if (value) window.localStorage.setItem(draftKey(id), JSON.stringify(value)); else window.localStorage.removeItem(draftKey(id)) } catch { /* storage off: nothing to keep */ }
}

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
  const [preview, setPreview]   = useState(false)
  const [contexts, setContexts] = useState<string[]>([])
  // Unsaved text found in this browser from an earlier visit.
  const [recovered, setRecovered] = useState<StoredDraft | null>(null)
  // The note as it now stands, when a save was refused because it changed elsewhere.
  const [conflict, setConflict] = useState<NoteDetail | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const dirty = editing && !same(draft, saved)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [list, loaded] = await Promise.all([fetchNotes(), noteId ? fetchNote(noteId) : Promise.resolve(null)])
      if (cancelled) return
      if (list?.status === 'ready') { setSubjects(list.subjects); setRunning(list.activeSession); setContexts(list.learningContexts ?? []) }
      else if (list) setMissing('Notes are part of Nova, and this account is not set up with it yet.')

      if (noteId) {
        if (loaded?.ok) {
          setNote(loaded.note); setDraft(draftOf(loaded.note)); setSaved(draftOf(loaded.note))
          if (new URLSearchParams(window.location.search).get('saved') === '1') setJustSaved(true)
          const kept = readDraft(noteId)
          if (kept && !same(kept.draft, draftOf(loaded.note))) setRecovered(kept)
          else if (kept) writeDraft(noteId, null)
        }
        else setMissing(loaded?.error === 'not_found' ? "That note doesn't exist. It may have been deleted." : loaded?.message ?? 'Could not load that note.')
      } else {
        // A new note can arrive with its context already chosen (from Knowledge).
        const params  = new URLSearchParams(window.location.search)
        const subject = list?.status === 'ready' ? list.subjects.find(s => s.id === params.get('subjectId')) : undefined
        // A [[link]] to a note not written yet opens here with its title.
        const initial = { ...EMPTY, title: (params.get('title') ?? '').slice(0, NOTE_TITLE_MAX), subjectId: subject?.id ?? '', topicName: subject ? (params.get('topic') ?? '').slice(0, NOTE_TOPIC_MAX) : '' }
        // From a saved page: the source-notes template, naming the page.
        const source = params.get('source')
        const sourceUrl = (() => { try { const u = new URL(source ?? ''); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null } catch { return null } })()
        if (sourceUrl) {
          const t = noteTemplatesFor([]).find(x => x.id === 'source')
          const titleLine = (params.get('sourceTitle') ?? '').slice(0, NOTE_TITLE_MAX)
          if (t) initial.body = t.body.replace('Source: ', `Source: ${titleLine ? `${titleLine} ` : ''}${sourceUrl}`)
        }
        setDraft(initial); setSaved({ ...initial, body: sourceUrl ? '' : initial.body })
        const kept = readDraft(null)
        if (kept && (kept.draft.title || kept.draft.body)) setRecovered(kept)
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

  // Keep what is typed, a moment after typing stops.
  useEffect(() => {
    if (!dirty || loading) return
    const timer = window.setTimeout(() => writeDraft(note?.id ?? null, { draft, base: note?.updatedAt ?? null, at: Date.now() }), 600)
    return () => window.clearTimeout(timer)
  }, [draft, dirty, loading, note])

  const leave = useCallback((e: React.MouseEvent) => {
    if (dirty && !window.confirm(LEAVE)) e.preventDefault()
  }, [dirty])

  const topicOptions = useMemo(
    () => subjects.find(s => s.id === draft.subjectId)?.topics ?? [],
    [subjects, draft.subjectId],
  )

  // base: the version this edit started from. A save over a newer version is
  // refused by the server, and both texts stay on screen.
  async function save(base: string | null = note?.updatedAt ?? null) {
    if (saving || !draft.title.trim()) return
    setSaving(true)
    setError(null)
    const input = {
      title: draft.title, body: draft.body, subjectId: draft.subjectId || null, topicName: draft.topicName.trim() || null,
      ...(note && base ? { baseUpdatedAt: base } : {}),
    }
    const res = note ? await updateNote(note.id, input) : await createNote(input)
    setSaving(false)
    if (!res.ok) {
      if (res.error === 'conflict' && res.current) { setConflict(res.current); return }
      setError(`${res.message} Your text is still here and kept in this browser.`)
      return
    }
    writeDraft(note?.id ?? null, null)
    setConflict(null); setRecovered(null)
    setNote(res.note); setDraft(draftOf(res.note)); setSaved(draftOf(res.note)); setEditing(false); setPreview(false)
    setJustSaved(true)
    // A new note moves to its own address; it says it was saved there too.
    if (!note) router.replace(`/notes/${res.note.id}?saved=1`)
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your changes?')) return
    writeDraft(note?.id ?? null, null)
    if (!note) { router.push('/notes'); return }
    setDraft(saved); setEditing(false); setError(null); setPreview(false)
  }

  // A save was refused because the note changed elsewhere: take the saved
  // version (what was typed here is dropped, after asking), or save this one
  // over it on purpose.
  function useTheirs() {
    if (!conflict) return
    if (!window.confirm('Replace what you typed here with the version saved elsewhere?')) return
    writeDraft(conflict.id, null)
    setNote(conflict); setDraft(draftOf(conflict)); setSaved(draftOf(conflict)); setConflict(null)
  }

  function applyTemplate(t: NoteTemplate) {
    if (draft.body.trim() && !window.confirm('Replace the text of this note with the template?')) return
    setDraft(d => ({ ...d, body: t.body, title: d.title || t.name }))
  }

  // A task on the learner's own board to come back to this note: filed where
  // the note is, made once however often the button is pressed (clientKey).
  // It is only a task: it moves nothing in Knowledge and changes no plan.
  const [taskState, setTaskState] = useState<'idle' | 'adding' | 'added' | 'failed'>('idle')
  async function reviewTask() {
    if (!note) return
    setTaskState('adding')
    try {
      const res = await fetch('/api/nova/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Review: ${note.title}`.slice(0, TASK_TITLE_MAX), subjectId: note.subjectId, topicName: note.subjectId ? note.topicName : null, clientKey: `note:${note.id}:review` }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean } | null
      setTaskState(res.ok && data?.ok ? 'added' : 'failed')
    } catch { setTaskState('failed') }
  }

  // Ctrl or Cmd + S saves while editing.
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 2500)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  const templates = useMemo(() => noteTemplatesFor(normalizeLearningContexts(contexts) ?? []), [contexts])

  async function remove() {
    if (!note) return
    setDeleting(true)
    const res = await deleteNote(note.id)
    if (res.ok) { router.push('/notes'); return }
    setDeleting(false); setConfirmDelete(false); setError(res.message)
  }

  const banners = (
    <>
      {recovered && (
        <div role="status" className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" data-note-recovered>
          <p className="text-foreground/75">Unsaved changes to this note were kept in this browser {relativeDay(new Date(recovered.at).toISOString())}. They are not saved yet.</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={quiet} onClick={() => { setDraft(recovered.draft); setEditing(true); setRecovered(null) }}>Restore</button>
            <button type="button" className={quiet} onClick={() => { writeDraft(note?.id ?? null, null); setRecovered(null) }}>Discard</button>
          </div>
        </div>
      )}
      {conflict && (
        <div role="alert" className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/5 p-4 text-sm" data-note-conflict>
          <p className="text-foreground/80">This note was changed somewhere else ({relativeDay(conflict.updatedAt)}) after you opened it. Nothing was overwritten, and what you typed is still here.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={quiet} disabled={saving} onClick={() => void save(conflict.updatedAt)}>Save mine over it</button>
            <button type="button" className={quiet} disabled={saving} onClick={useTheirs}>Use the saved version</button>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-foreground/55">See the saved version</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 p-3 text-xs text-foreground/70">{conflict.title}{'\n\n'}{conflict.body}</pre>
          </details>
        </div>
      )}
    </>
  )

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <Link href="/notes" onClick={leave} className="inline-flex items-center gap-1.5 text-sm text-foreground/50 transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Notes
      </Link>
      {banners}
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

        {!note && !draft.body.trim() && templates.length > 0 && (
          <div data-note-templates>
            <p className="mb-2 text-xs text-foreground/50">Start from a template (optional)</p>
            <div className="flex flex-wrap gap-2">
              {templates.map(t => (
                <button key={t.id} type="button" onClick={() => applyTemplate(t)} title={t.description}
                  className="rounded-full border border-white/12 px-3 py-1.5 text-xs text-foreground/75 transition-colors hover:border-keppel-400/50 hover:text-foreground">
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div role="tablist" aria-label="Write or preview" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
              <button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)} className={`rounded-md px-2.5 py-1 ${!preview ? 'bg-white/10 text-foreground' : 'text-foreground/55'}`}>Write</button>
              <button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)} className={`rounded-md px-2.5 py-1 ${preview ? 'bg-white/10 text-foreground' : 'text-foreground/55'}`}>Preview</button>
            </div>
            <p className="text-[11px] text-foreground/40">[[Title]] links a note · # heading · - list</p>
          </div>
          <label htmlFor="note-body" className="sr-only">Note</label>
          {preview ? (
            <div className={`${field} min-h-[22rem] py-1`} data-note-preview>
              {draft.body.trim() ? <NoteBody body={draft.body} links={note?.links.outgoing ?? []} /> : <p className="py-3 text-sm text-foreground/35">Nothing to preview yet.</p>}
            </div>
          ) : (
          <textarea
            id="note-body" value={draft.body} maxLength={NOTE_BODY_MAX}
            onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
            placeholder="Write what you're learning, in your own words."
            className={`${field} min-h-[22rem] resize-y py-3 text-[15px] leading-relaxed`}
          />
          )}
          {draft.body.length > NOTE_BODY_MAX * 0.9 && (
            <p className="mt-1 text-xs text-amber-300/80">{(NOTE_BODY_MAX - draft.body.length).toLocaleString()} characters left</p>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={cancel} disabled={saving} className={quiet}>Cancel</button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground/45" role="status" data-save-state={saving ? 'saving' : dirty ? 'unsaved' : 'clean'}>
              {saving ? 'Saving…' : dirty ? 'Not saved · kept in this browser' : ''}
            </span>
            <button type="submit" disabled={saving || !draft.title.trim()} className={`${primary} flex-1 sm:flex-none`} title="Save (Ctrl or Cmd + S)">
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
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/6 pt-3">
          <button type="button" onClick={() => void reviewTask()} disabled={taskState === 'adding'} className="text-sm text-keppel-300 hover:underline disabled:opacity-50" data-review-task>
            {taskState === 'adding' ? 'Adding…' : 'Make a review task'}
          </button>
          {taskState === 'added' && <span role="status" className="text-xs text-foreground/60">On your task board. <Link href="/planner?view=board" className="underline">Open it</Link></span>}
          {taskState === 'failed' && <span role="alert" className="text-xs text-red-300">That task didn&apos;t save. Try again.</span>}
        </div>
      </section>

      {justSaved && <p role="status" className="mt-4 flex items-center gap-1.5 text-sm text-foreground/70" data-note-saved><Check className="size-4 text-keppel-300" /> Saved</p>}

      <div className="mt-6">
        {note.body ? <NoteBody body={note.body} links={note.links.outgoing} /> : <p className="text-[15px] text-foreground/35">This note is empty.</p>}
      </div>

      {note.body.trim() && (
        <NoteAssistPanel
          note={note}
          onNoteSaved={n => { setNote(n); setDraft(draftOf(n)); setSaved(draftOf(n)) }}
          onUseDraft={body => { setDraft(d => ({ ...d, body })); setEditing(true); setPreview(true) }}
        />
      )}

      <section aria-labelledby="note-links-heading" className="mt-10 rounded-2xl border border-white/8 bg-card/40 p-4 sm:p-5" data-note-links>
        <div className="flex items-center justify-between gap-3">
          <h2 id="note-links-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground"><Link2 className="size-4 text-keppel-300" /> Connections</h2>
          <Link href={`/map?focus=${encodeURIComponent(`note:${note.id}`)}`} className="text-xs text-keppel-300 hover:underline" data-see-on-map>See on the map</Link>
        </div>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Links from this note</p>
            {note.links.outgoing.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-foreground/50">None yet. Write a title in double brackets, like [[Deadlocks]], to link another note.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {note.links.outgoing.map(l => {
                  const { href, missing } = linkHref(l, l.title)
                  return (
                    <li key={l.title}>
                      <Link href={href} className={missing ? 'text-foreground/60 underline decoration-dashed underline-offset-2 hover:text-foreground' : 'text-keppel-300 hover:underline'}>{l.title}</Link>
                      <span className="ml-2 text-xs text-foreground/40">{missing ? 'not written yet' : l.noteId ? 'note' : 'topic'}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Linked from</p>
            {note.links.backlinks.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-foreground/50">No other note links here yet. Notes that write [[{note.title}]] appear here.</p>
            ) : (
              <ul className="mt-2 space-y-2.5 text-sm">
                {note.links.backlinks.map(b => (
                  <li key={b.noteId}>
                    <Link href={`/notes/${encodeURIComponent(b.noteId!)}`} className="text-keppel-300 hover:underline">{b.title}</Link>
                    {b.subjectName && <span className="ml-2 text-xs text-foreground/40">{b.subjectName}</span>}
                    {b.context && <p className="mt-0.5 text-xs leading-relaxed text-foreground/50">{b.context}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

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

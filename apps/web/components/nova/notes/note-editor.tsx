'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowRight, Bold, Check, ChevronLeft, ChevronRight, Code, Columns2, ExternalLink, FileText, Hash, Heading1, Heading2,
  HelpCircle, Highlighter, Italic, Lightbulb, Link2, List, ListOrdered, ListTree, Loader2, Minus, PanelLeft, Pencil,
  Quote, Sparkles, Trash2, Type, Undo2, X,
} from 'lucide-react'
import type { NoteDetail, NoteSubjectOption, NoteSummary } from '@repo/api/nova/product/notes.types'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from '@repo/api/nova/product/notes.types'
import { TASK_TITLE_MAX } from '@repo/api/nova/product/tasks.types'
import { TUTOR_MODES, TUTOR_SELECTION_MAX, type TutorMode } from '@repo/api/nova/product/note-tutor.types'
import { noteTemplatesFor, type NoteTemplate } from '@repo/api/nova/product/templates'
import { normalizeLearningContexts } from '@repo/api/nova/product/learning-context'
import { minutesLabel, relativeDay } from '../format'
import { subjectColor } from '../subject-color'
import { useStartSession } from '../use-start-session'
import { NoteBody, linkHref } from './note-body'
import { InsertPreview, type InsertWhere, type PendingInsert } from './insert-preview'
import { NovaTutor, type Passage } from './nova-tutor'
import { NovaEditor, type ApplyResult, type EditAsk } from './nova-editor'
import { Identity, ModeSwitch, type NovaMode } from './nova-modes'
import { placeInto, placementHint, type InsertPart } from './tutor-session'
import type { TutorReply } from '@repo/api/nova/product/note-tutor.types'
import { alreadyIn, applyEdits, insertAt, locateChange, placementFor, resolvePlacement, resolveRef, type EditChange, type NoteRef } from '@repo/api/nova/product/note-outline'
import { outline, parseBlocks, sourceOf, tagsOf, wordCount } from './note-blocks'
import { callout, divider, noteLink, prefixLines, tag, wrap, type Edited } from './note-format'
import { NotesTree } from './notes-tree'
import { novaModeCommands, useNotesCommands } from './notes-commands'
import { modLabel } from './notes-shortcuts'
import { paperPlacement } from '@repo/api/nova/product/paper-source'
import { createNote, deleteNote, fetchNote, fetchNotes, updateNote } from './notes-api'
import { BOARD_PATH } from '@repo/api/nova/product/companion'

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

// How this browser likes the notebook laid out. A convenience only: without
// storage the defaults below are used.
type Layout = 'write' | 'split' | 'preview'
// tutor: Nova's panel beside the note on a wide screen, at tutorWidth pixels.
// nova: which of Nova's two jobs the panel is on (nova-modes.tsx).
type Prefs = { tree: boolean; outline: boolean; serif: boolean; layout: Layout; tutor: boolean; tutorWidth: number; nova: NovaMode }
const PREFS_KEY = 'kivo-notes-layout'
const DEFAULT_PREFS: Prefs = { tree: true, outline: true, serif: true, layout: 'split', tutor: true, tutorWidth: 420, nova: 'tutor' }
// How long a passage Nova points at stays highlighted in the note.
const FLASH_MS = 4500
const TUTOR_MIN = 320, TUTOR_MAX = 720
const clampTutor = (w: number) => Math.round(Math.min(Math.max(w, TUTOR_MIN), typeof window === 'undefined' ? TUTOR_MAX : Math.min(TUTOR_MAX, window.innerWidth * 0.55)))

// Typing stops, then the note is saved a moment later, guarded on the version
// it was opened at like any other save. A failed save is tried again.
const AUTOSAVE_MS = 1500
const AUTOSAVE_RETRY_MS = 8000

// Whether the screen is wide enough for the note and Nova side by side
// (1024px), and for the notebook and a split editor beside them too (1600px).
function useWide(query = '(min-width: 1024px)'): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const q = window.matchMedia(query)
    const on = () => setWide(q.matches)
    on(); q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [query])
  return wide
}
function readPrefs(): Prefs {
  try { const raw = window.localStorage.getItem(PREFS_KEY); return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) as Partial<Prefs> } : DEFAULT_PREFS } catch { return DEFAULT_PREFS }
}
function writePrefs(p: Prefs) { try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage off */ } }

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
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-60'
const quiet =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5 disabled:opacity-60'
const iconButton = (on = false) =>
  `inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${on ? 'bg-white/8 text-foreground' : 'text-foreground/50 hover:bg-white/6 hover:text-foreground'}`

// One note: read it, edit it, delete it, study from it — in a workspace with
// the notebook beside it, the note's outline, and the source it came from.
// The text is the learner's. This page only ever saves what they typed, when
// they press Save; nothing rewrites it and nothing is sent anywhere else.
export function NoteEditor({ noteId }: { noteId: string | null }) {
  const router = useRouter()
  const { start, starting, error: startError } = useStartSession()

  const [note, setNote]         = useState<NoteDetail | null>(null)
  const [notes, setNotes]       = useState<NoteSummary[]>([])
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
  const [contexts, setContexts] = useState<string[]>([])
  // Unsaved text found in this browser from an earlier visit.
  const [recovered, setRecovered] = useState<StoredDraft | null>(null)
  // The note as it now stands, when a save was refused because it changed elsewhere.
  const [conflict, setConflict] = useState<NoteDetail | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const [prefs, setPrefsState]  = useState<Prefs>(DEFAULT_PREFS)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [treeOnPhone, setTreeOnPhone] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const tutorInput = useRef<HTMLTextAreaElement>(null)
  const wide = useWide()
  const roomy = useWide('(min-width: 1600px)')

  // Nova beside the note: the passage being discussed, what it offers to add
  // (shown and confirmed first), and the last addition, which can be undone.
  const [passage, setPassage] = useState<Passage | null>(null)
  const [tutorOnPhone, setTutorOnPhone] = useState(false)
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null)
  const [undo, setUndo] = useState<{ before: string; after: string; label: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selChip, setSelChip] = useState<{ text: string; x: number; y: number; tooLong: boolean } | null>(null)
  const [autoAsk, setAutoAsk] = useState<TutorMode | null>(null)
  const [autoError, setAutoError] = useState<{ message: string; at: number } | null>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const caret = useRef<number | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  // What the tutor hands the editor to work into the note.
  const [editorSeed, setEditorSeed] = useState<EditAsk | null>(null)
  const [live, setLive] = useState('')

  const setPrefs = useCallback((change: Partial<Prefs>) => setPrefsState(p => { const n = { ...p, ...change }; writePrefs(n); return n }), [])
  useEffect(() => { setPrefsState(readPrefs()) }, [])

  // ⌘P imports a paper, ⌘K finds a note or switches Nova, ? lists the keys.
  const reloadSubjects = useCallback(async () => {
    const list = await fetchNotes()
    if (list?.status !== 'ready') return null
    setSubjects(list.subjects); setNotes(list.notes)
    return list.subjects
  }, [])
  const modeCommands = useMemo(() => novaModeCommands(m => {
    setPrefs({ nova: m, tutor: true })
    if (!window.matchMedia('(min-width: 1024px)').matches) setTutorOnPhone(true)
  }), [setPrefs])
  const commands = useNotesCommands({
    notes, subjects, reloadSubjects, extra: modeCommands,
    here: { subjectId: note?.subjectId ?? null, topicName: note?.topicName ?? null },
    onImported: () => void reloadSubjects(),
  })

  const dirty = editing && !same(draft, saved)
  // The latest of each, for saves started from a timer or from Nova's panel.
  const draftRef = useRef(draft); draftRef.current = draft
  const noteRef  = useRef(note);  noteRef.current = note
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const editingRef = useRef(editing); editingRef.current = editing
  const inFlight = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [list, loaded] = await Promise.all([fetchNotes(), noteId ? fetchNote(noteId) : Promise.resolve(null)])
      if (cancelled) return
      if (list?.status === 'ready') { setSubjects(list.subjects); setRunning(list.activeSession); setContexts(list.learningContexts ?? []); setNotes(list.notes) }
      else if (list) setMissing('Notes are part of Nova, and this account is not set up with it yet.')

      if (noteId) {
        if (loaded?.ok) {
          setNote(loaded.note); setDraft(draftOf(loaded.note)); setSaved(draftOf(loaded.note))
          const params = new URLSearchParams(window.location.search)
          if (params.get('saved') === '1') setJustSaved(true)
          // From the capture page: "Organise with Nova" opens Nova and asks once.
          const ask = params.get('tutor')
          if (ask && (TUTOR_MODES as readonly string[]).includes(ask)) { setAutoAsk(ask as TutorMode); setPrefsState(p => ({ ...p, tutor: true })) }
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
  // stay: an autosave (or a save before Nova reads the note): editing goes on,
  // and what was typed while it was on its way is kept as typed.
  function save(base: string | null = noteRef.current?.updatedAt ?? null, opts: { stay?: boolean } = {}): Promise<boolean> {
    if (inFlight.current) return inFlight.current.then(() => false)
    const sent = draftRef.current
    const current = noteRef.current
    if (!sent.title.trim()) return Promise.resolve(false)
    const run = (async () => {
      setSaving(true)
      if (!opts.stay) setError(null)
      const input = {
        title: sent.title, body: sent.body, subjectId: sent.subjectId || null, topicName: sent.topicName.trim() || null,
        ...(current && base ? { baseUpdatedAt: base } : {}),
      }
      const res = current ? await updateNote(current.id, input) : await createNote(input)
      setSaving(false)
      if (!res.ok) {
        if (res.error === 'conflict' && res.current) { setConflict(res.current); return false }
        if (opts.stay) setAutoError({ message: res.message, at: Date.now() })
        else setError(`${res.message} Your text is still here and kept in this browser.`)
        return false
      }
      setAutoError(null); setConflict(null); setRecovered(null)
      setNote(res.note)
      setNotes(list => [res.note, ...list.filter(n => n.id !== res.note.id)])
      if (opts.stay && current) {
        // What was sent is what is saved; anything typed since stays unsaved.
        setSaved(sent)
        if (same(draftRef.current, sent)) writeDraft(current.id, null)
        return true
      }
      writeDraft(current?.id ?? null, null)
      setDraft(draftOf(res.note)); setSaved(draftOf(res.note)); setEditing(false)
      setJustSaved(true)
      // A new note moves to its own address; it says it was saved there too.
      if (!current) router.replace(`/notes/${res.note.id}?saved=1`)
      return true
    })()
    inFlight.current = run
    void run.finally(() => { inFlight.current = null })
    return run
  }

  // Autosave: a moment after typing stops, while editing a note that exists.
  // Not over a conflict (the learner chooses), and not without a title.
  useEffect(() => {
    if (!editing || !note || !dirty || conflict || !draft.title.trim()) return
    const timer = window.setTimeout(() => { void save(note.updatedAt, { stay: true }) }, autoError ? AUTOSAVE_RETRY_MS : AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, editing, note, dirty, conflict, autoError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Before Nova reads the note: what is on screen is saved first.
  const ensureSaved = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current
    if (!dirtyRef.current) return true
    if (!noteRef.current || !draftRef.current.title.trim()) return false
    return save(noteRef.current.updatedAt, { stay: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const version = useCallback(() => noteRef.current?.updatedAt ?? null, [])

  // The note's text as it is on screen: what is being typed, else what is saved.
  const currentBody = useCallback(() => (editingRef.current ? draftRef.current.body : noteRef.current?.body ?? ''), [])

  // ── Showing a passage in the note ────────────────────────────────────────
  // A range of the text on screen, brought into view and highlighted for a
  // moment: in the rendered note (reading, or the preview beside the
  // editor), by the blocks that hold it (note-body.tsx data-at); in the
  // editor alone, by selecting it there. Nothing in the note changes.
  const flashed = useRef<{ els: Element[]; timer: number } | null>(null)
  const revealRange = useCallback((start: number, end: number) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const rendered = editingRef.current ? previewRef.current : articleRef.current
    const blocks = rendered ? [...rendered.querySelectorAll('[data-at]')].filter(el => {
      // Only the note's own top-level blocks, not Nova's or a callout's inside.
      const at = Number(el.getAttribute('data-at')), to = Number(el.getAttribute('data-to'))
      return el.parentElement?.closest('[data-at]') === null && at < Math.max(end, start + 1) && to > start
    }) : []
    if (blocks.length && rendered && rendered.offsetParent !== null) {
      if (flashed.current) { window.clearTimeout(flashed.current.timer); flashed.current.els.forEach(el => el.classList.remove('note-flash')) }
      blocks[0]!.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
      // Restarted, so a second press on the same passage shows it again.
      for (const el of blocks) { el.classList.remove('note-flash'); void (el as HTMLElement).offsetWidth; el.classList.add('note-flash') }
      flashed.current = { els: blocks, timer: window.setTimeout(() => { blocks.forEach(el => el.classList.remove('note-flash')); flashed.current = null }, FLASH_MS) }
      setLive('Showing the passage in your note.')
      return true
    }
    const el = bodyRef.current
    if (editingRef.current && el) {
      // The editor alone is on screen: the passage is selected there.
      const lines = el.value.slice(0, start).split('\n').length - 1, all = el.value.split('\n').length
      el.focus({ preventScroll: true })
      el.setSelectionRange(start, end)
      el.scrollTop = Math.max(0, (lines / Math.max(all, 1)) * el.scrollHeight - el.clientHeight / 3)
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
      setLive('The passage is selected in the editor.')
      return true
    }
    return false
  }, [])
  // A passage a tutor reply rests on, found in the note as it is now. One
  // that changed since is said to have changed; nothing else is highlighted.
  const revealPassage = useCallback((ref: NoteRef) => {
    const found = resolveRef(currentBody(), ref)
    if (found.status === 'stale') { setNotice('That passage has changed in your note since Nova answered, so it can’t be shown.'); return }
    if (!wide) setTutorOnPhone(false)
    window.setTimeout(() => { if (!revealRange(found.start, found.end)) setNotice('Open the note to see that passage.') }, wide ? 0 : 80)
  }, [currentBody, revealRange, wide])

  // ── Adding from Nova ─────────────────────────────────────────────────────
  // Shown first (InsertPreview) with where it will go, worked out from the
  // note's structure (note-outline.ts placementFor), then added on lines of
  // its own, in the editor, where autosave keeps it. Nothing is replaced.
  const offerInsert = useCallback((markdown: string, label: string, from?: { reply: TutorReply; part: InsertPart; index?: number }) => {
    const body = currentBody()
    if (alreadyIn(body, markdown)) { setNotice('That is already in your note.'); return }
    // In a note holding a paper, never into the paper's own text: the same
    // place in the learner's "My notes" (paper-source.ts paperPlacement).
    const place = paperPlacement(body, placementFor(body, from ? placementHint(from.reply, body, from.part, from.index ?? 0) : { kind: 'other', title: label }))
    setPendingInsert({ markdown, label, place })
  }, [currentBody])
  const offerTitle  = useCallback((to: string) => setPendingInsert({ markdown: '', label: 'Title', title: { from: draftRef.current.title, to: to.slice(0, NOTE_TITLE_MAX) } }), [])
  function confirmInsert(where: InsertWhere) {
    const p = pendingInsert
    setPendingInsert(null)
    if (!p || !note) return
    // On a narrow screen Nova's drawer covers the note: close it to show
    // what was added (and its Undo).
    if (!wide) setTutorOnPhone(false)
    if (p.title) {
      setDraft(d => ({ ...d, title: p.title!.to })); setEditing(true)
      setNotice('Title changed. It saves in a moment.')
      return
    }
    const before = currentBody()
    let after: string, range: { start: number; end: number } | null = null
    if (where === 'cursor') after = placeInto(before, p.markdown, caret.current)
    else {
      // Found again in the note as it is now: a section changed or gone
      // since the preview opened is chosen again, never guessed.
      const at = resolvePlacement(before, where)
      if (at === null) { setPendingInsert({ ...p, place: paperPlacement(before, placementFor(before, { kind: 'other', title: p.label })), moved: true }); return }
      const put = insertAt(before, at, p.markdown, where.how === 'newSection' ? where.heading : null)
      after = put.body; range = { start: put.start, end: put.end }
    }
    if (after.length > NOTE_BODY_MAX) { setNotice('That would make the note longer than a note can be. Nothing was added.'); return }
    if (!editing) setDraft(draftOf(note))
    setDraft(d => ({ ...d, body: after })); setEditing(true)
    setUndo({ before, after, label: p.label })
    setNotice(null)
    if (range) { const r = range; window.setTimeout(() => revealRange(r.start, r.end), 120) }
  }

  // ── Nova's editor ────────────────────────────────────────────────────────
  // The changes the learner kept, applied to the note itself: the draft is
  // the one copy the editor, the preview and the reader all draw, so every
  // view shows the change at once. Each change goes where its words still
  // are (note-outline.ts applyEdits); if any no longer fits, nothing is
  // applied, and one already made is not made twice. The note is then saved
  // straight away through its guarded save, and the result says whether it
  // was: "applied" is only said of a saved note. Undo puts it back.
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current
    const n = noteRef.current
    if (!n || !draftRef.current.title.trim()) return false
    return save(n.updatedAt, { stay: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const applyEditChanges = useCallback(async (changes: EditChange[], label: string): Promise<ApplyResult> => {
    const n = noteRef.current
    if (!n) return { ok: false, conflicts: [], message: 'Save the note first.' }
    if (inFlight.current) await inFlight.current
    const before = currentBody()
    const r = applyEdits(before, changes)
    if (!r.ok) return { ok: false, conflicts: r.conflicts, message: `Your note has changed where ${r.conflicts.length === 1 ? 'one of these changes goes' : `${r.conflicts.length} of these changes go`}, so nothing was applied.` }
    if (r.applied.length === 0) return { ok: true, saved: !dirtyRef.current, already: true }
    if (r.body.length > NOTE_BODY_MAX) return { ok: false, conflicts: [], message: 'That would make the note longer than a note can be. Nothing was applied.' }
    // The draft the save reads is set here, not after the next render.
    const next = { ...(editingRef.current ? draftRef.current : draftOf(n)), body: r.body }
    draftRef.current = next
    setDraft(next); setEditing(true)
    // Undo is what the toast shows now, whatever it said before.
    setUndo({ before, after: r.body, label }); setNotice(null)
    const first = changes.find(c => r.applied.includes(c.id) && c.after)
    const at = first ? r.body.indexOf(first.after.trim()) : -1
    if (at !== -1) window.setTimeout(() => revealRange(at, at + first!.after.trim().length), 120)
    const saved = await saveNow()
    return { ok: true, saved }
  }, [currentBody, revealRange, saveNow])
  const showChange = useCallback((c: EditChange) => {
    const at = locateChange(currentBody(), c)
    if (!at) { setNotice('That part of your note has changed since Nova proposed this.'); return }
    if (!wide) setTutorOnPhone(false)
    window.setTimeout(() => { revealRange(c.op === 'insert' ? Math.max(0, at.start - 1) : at.start, c.op === 'insert' ? at.start : at.end) }, wide ? 0 : 80)
  }, [currentBody, revealRange, wide])
  // The tutor hands a request to the editor (its text to work in, a
  // structure, or an edit the learner asked the tutor for): the panel
  // switches to the editor, which sends it.
  const toEditor = useCallback((ask: EditAsk) => {
    setEditorSeed({ ...ask, material: ask.material?.slice(0, 6_000) }); setPrefs({ nova: 'editor' })
  }, [setPrefs])

  function undoInsert() {
    if (!undo) return
    if (draftRef.current.body !== undo.after) { setNotice('The note has changed since that was added, so it can’t be undone in one step. Remove it by hand.'); setUndo(null); return }
    setDraft(d => ({ ...d, body: undo.before })); setUndo(null)
    setNotice('Removed. Your note is as it was.')
  }
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 6000); return () => window.clearTimeout(t) }, [notice])
  useEffect(() => { if (!undo) return; const t = window.setTimeout(() => setUndo(null), 20_000); return () => window.clearTimeout(t) }, [undo])

  // Asking Nova about a passage: chosen while reading (the floating button)
  // or while writing (the toolbar). The passage stays until it is cleared, so
  // follow-up questions are about it too.
  const openTutor = useCallback(() => {
    if (wide) setPrefsState(p => { const n = { ...p, tutor: true }; writePrefs(n); return n })
    else setTutorOnPhone(true)
    window.setTimeout(() => tutorInput.current?.focus(), 60)
  }, [wide])
  const askAbout = useCallback((text: string) => {
    setPassage({ text: text.trim() }); setSelChip(null); openTutor()
  }, [openTutor])
  useEffect(() => {
    if (editing) { setSelChip(null); return }
    let timer = 0
    const read = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const sel = window.getSelection()
        const text = sel?.toString().trim() ?? ''
        const inNote = !!sel && sel.rangeCount > 0 && !!articleRef.current?.contains(sel.anchorNode) && !!articleRef.current?.contains(sel.focusNode)
        if (!text || !inNote) { setSelChip(null); return }
        const rect = sel!.getRangeAt(0).getBoundingClientRect()
        setSelChip({ text, x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80), y: Math.max(rect.top - 44, 8), tooLong: text.length > TUTOR_SELECTION_MAX })
      }, 160)
    }
    document.addEventListener('selectionchange', read)
    return () => { document.removeEventListener('selectionchange', read); window.clearTimeout(timer) }
  }, [editing])
  const editorSelection = () => {
    const el = bodyRef.current
    return el ? draft.body.slice(el.selectionStart, el.selectionEnd).trim() : ''
  }

  function cancel() {
    if (dirty && !window.confirm('Discard the changes that are not saved yet?')) return
    writeDraft(note?.id ?? null, null)
    if (!note) { router.push('/notes'); return }
    setDraft(saved); setEditing(false); setError(null)
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

  // The toolbar: one change to the text at the selection, which stays where
  // the change puts it.
  function format(change: (text: string, start: number, end: number) => Edited) {
    const el = bodyRef.current
    if (!el) return
    const next = change(draft.body, el.selectionStart, el.selectionEnd)
    if (next.text.length > NOTE_BODY_MAX) return
    setDraft(d => ({ ...d, body: next.text }))
    window.requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.start, next.end) })
  }
  function onBodyKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return
    const key = e.key.toLowerCase()
    if (key === 'b') { e.preventDefault(); format((t, s, x) => wrap(t, s, x, '**', 'bold')) }
    else if (key === 'i') { e.preventDefault(); format((t, s, x) => wrap(t, s, x, '*', 'italic')) }
    else if (key === 'e' && e.shiftKey) { e.preventDefault(); format((t, s, x) => wrap(t, s, x, '==', 'highlight')) }
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

  // Ctrl or Cmd + S saves while editing; E opens a note to edit, Escape
  // closes the source beside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() }
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      if (!editing && !typing && note && e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setEditing(true) }
      if (e.key === 'Escape' && sourceOpen && !typing) setSourceOpen(false)
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

  // What the open note is made of, for its outline, its status line and the
  // source beside it. While editing, the text being typed.
  const body = editing ? draft.body : note?.body ?? ''
  const sections = useMemo(() => outline(parseBlocks(body)), [body])
  const source   = useMemo(() => sourceOf(body), [body])
  const tags     = useMemo(() => tagsOf(body), [body])
  const words    = useMemo(() => wordCount(body), [body])
  useEffect(() => { if (!source) setSourceOpen(false) }, [source])

  const banners = (
    <>
      {recovered && (
        <div role="status" className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" data-note-recovered>
          <p className="text-foreground/75">Unsaved changes to this note were kept in this browser {relativeDay(new Date(recovered.at).toISOString())}. They are not saved yet.</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={quiet} onClick={() => { setDraft(recovered.draft); setEditing(true); setRecovered(null) }}>Restore</button>
            <button type="button" className={quiet} onClick={() => { writeDraft(note?.id ?? null, null); setRecovered(null) }}>Discard</button>
          </div>
        </div>
      )}
      {conflict && (
        <div role="alert" className="mb-5 rounded-2xl border border-red-400/30 bg-red-400/5 p-4 text-sm" data-note-conflict>
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

  // The plain page, while loading or when there is nothing to open.
  const simple = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <Link href="/notes" onClick={leave} className="inline-flex items-center gap-1.5 text-sm text-foreground/50 transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Notes
      </Link>
      {children}
    </div>
  )

  if (loading) {
    return simple(
      <div aria-busy="true" aria-label="Loading note" className="mt-8 space-y-5">
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-white/5" />
        <div className="h-4 w-48 animate-pulse rounded bg-white/4" />
        <div className="h-72 animate-pulse rounded-2xl bg-white/3" />
      </div>,
    )
  }

  if (missing) {
    return simple(
      <section className="mt-8 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-note-missing>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nothing to open</h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/65">{missing}</p>
        <Link href="/notes" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">Back to Notes</Link>
      </section>,
    )
  }

  // ── The workspace ──────────────────────────────────────────────────────────
  const subjectName = editing ? subjects.find(s => s.id === draft.subjectId)?.name ?? null : note?.subjectName ?? null
  const topicName   = editing ? (draft.subjectId ? draft.topicName.trim() || null : null) : note?.topicName ?? null
  const title       = (editing ? draft.title : note?.title)?.trim() || 'Untitled'
  const color       = subjectColor(subjectName)
  const showSource  = sourceOpen && source !== null
  const showOutline = prefs.outline && !showSource

  // With Nova docked on a screen under 1600px, the note keeps the room: the
  // notebook opens over it instead of beside it, and the editor shows one
  // pane (Write or Preview), not both.
  const tutorDocked = wide && prefs.tutor
  const treeDocked = prefs.tree && !showSource && (roomy || !tutorDocked)
  const splitFits = roomy || !tutorDocked

  const crumbs = (
    <nav aria-label="Where this note is" className="flex min-w-0 items-center gap-1.5 text-[13px]" data-note-breadcrumb>
      <Link href="/notes" onClick={leave} className="shrink-0 text-keppel-300/80 hover:text-keppel-200">Notes</Link>
      {subjectName && (<>
        <span className="hidden text-foreground/25 sm:inline">/</span>
        <Link href={`/notes?subjectId=${encodeURIComponent((editing ? draft.subjectId : note?.subjectId) ?? '')}`} onClick={leave} className={`hidden shrink-0 hover:underline sm:inline ${color.text}`}>{subjectName}</Link>
      </>)}
      {topicName && (<><span className="hidden text-foreground/25 md:inline">/</span><span className="hidden shrink-0 text-foreground/50 md:inline">{topicName}</span></>)}
      <span className="text-foreground/25">/</span>
      <span className="min-w-0 truncate text-foreground/75">{editing && !note ? (draft.title.trim() || 'New note') : title}</span>
    </nav>
  )

  const topBar = (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-white/6 pl-14 pr-3 lg:pl-3">
      <button type="button" onClick={() => (roomy || !tutorDocked ? setPrefs({ tree: !prefs.tree }) : setTreeOnPhone(true))} className={`${iconButton(treeDocked)} max-lg:hidden`} title={treeDocked ? 'Hide the notebook' : 'Show the notebook'} aria-pressed={treeDocked}>
        <PanelLeft className="size-4" />
      </button>
      <button type="button" onClick={() => setTreeOnPhone(true)} className={`${iconButton()} lg:hidden`} title="Show the notebook">
        <PanelLeft className="size-4" />
      </button>
      <button type="button" onClick={e => { leave(e); if (!e.defaultPrevented) router.back() }} className={`${iconButton()} max-sm:hidden`} title="Back"><ChevronLeft className="size-4" /></button>
      <button type="button" onClick={e => { leave(e); if (!e.defaultPrevented) window.history.forward() }} className={`${iconButton()} max-sm:hidden`} title="Forward"><ChevronRight className="size-4" /></button>
      <div className="ml-1.5 min-w-0 flex-1">{crumbs}</div>
      {source && (
        <button type="button" onClick={() => setSourceOpen(o => !o)} aria-pressed={showSource}
          className={`hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors md:inline-flex ${showSource ? 'bg-sky-400/15 text-sky-200' : 'text-foreground/60 hover:bg-white/6 hover:text-foreground'}`}
          title="Open the source beside this note" data-note-source-toggle>
          <Columns2 className="size-3.5" /> Source
        </button>
      )}
      {!editing && (
        <button type="button" onClick={() => setPrefs({ serif: !prefs.serif })} className={iconButton(prefs.serif)} title={prefs.serif ? 'Read in sans-serif' : 'Read in serif'} aria-pressed={prefs.serif}>
          <Type className="size-4" />
        </button>
      )}
      <button type="button" onClick={() => setPrefs({ outline: !prefs.outline })} className={`${iconButton(prefs.outline)} max-xl:hidden`} title={prefs.outline ? 'Hide the outline' : 'Show the outline'} aria-pressed={prefs.outline}>
        <ListTree className="size-4" />
      </button>
      {!editing && note && (
        <button type="button" onClick={() => setEditing(true)} className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/5" title="Edit (E)">
          <Pencil className="size-3.5" /> Edit
        </button>
      )}
      <button type="button" onClick={commands.openImport} className={`${iconButton()} max-sm:hidden`} title={`Import a research paper (${modLabel(commands.mac)}P)`} aria-label="Import a research paper" aria-keyshortcuts={commands.mac ? 'Meta+P' : 'Control+P'} data-note-import-paper>
        <FileText className="size-4" />
      </button>
      <button type="button" onClick={() => (wide ? setPrefs({ tutor: !prefs.tutor }) : setTutorOnPhone(true))} aria-pressed={wide ? prefs.tutor : tutorOnPhone}
        className={`ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${(wide ? prefs.tutor : tutorOnPhone) ? 'bg-nova/15 text-nova-ink' : 'border border-nova/30 text-nova-ink hover:bg-nova/10'}`}
        title={wide && prefs.tutor ? 'Hide Nova' : 'Study this note with Nova'} data-tutor-toggle>
        <Sparkles className="size-3.5" /> Nova
      </button>
    </header>
  )

  const statusBar = (
    <footer className="flex h-8 shrink-0 items-center gap-3 overflow-x-auto border-t border-white/6 px-4 text-[11px] text-foreground/45" data-note-status>
      {note && <a href="#note-connections" className="shrink-0 hover:text-keppel-300" data-note-backlinks={note.links.backlinks.length}>{note.links.backlinks.length} backlink{note.links.backlinks.length === 1 ? '' : 's'}</a>}
      {note && <span className="shrink-0">{note.links.outgoing.length} link{note.links.outgoing.length === 1 ? '' : 's'}</span>}
      <span className="shrink-0">{words.toLocaleString()} word{words === 1 ? '' : 's'}</span>
      {tags.length > 0 && <span className="hidden shrink-0 sm:inline">{tags.length} tag{tags.length === 1 ? '' : 's'}</span>}
      <span className="ml-auto shrink-0">
        {editing
          ? (saving ? 'Saving…' : conflict ? 'Not saved · changed elsewhere' : autoError ? 'Not saved · trying again' : dirty ? (note ? 'Editing · saves as you pause' : 'Not saved yet · kept in this browser') : note ? `Saved ${relativeDay(note.updatedAt)}` : 'No changes')
          : note ? `Updated ${relativeDay(note.updatedAt)}` : ''}
      </span>
    </footer>
  )

  const tree = (
    <NotesTree notes={notes} currentId={note?.id ?? null} onNavigate={e => { leave(e); if (!e.defaultPrevented) setTreeOnPhone(false) }} />
  )

  const outlinePanel = (
    <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-white/6 px-4 py-5 xl:block" aria-label="Outline" data-note-outline>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">On this note</p>
      {sections.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-foreground/45">Headings you write with # appear here.</p>
      ) : (
        <ul className="mt-2 space-y-0.5 text-[13px]">
          {sections.map(s => (
            <li key={s.id} style={{ paddingLeft: `${(s.level - 1) * 0.75}rem` }}>
              <button type="button" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="w-full truncate rounded px-1.5 py-1 text-left text-foreground/60 transition-colors hover:bg-white/4 hover:text-foreground" disabled={editing && prefs.layout === 'write'}>
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {tags.length > 0 && (
        <>
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Tags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map(t => <span key={t} className="rounded-full bg-orange-400/12 px-2 py-0.5 text-[11px] font-medium text-orange-300">#{t}</span>)}
          </div>
        </>
      )}
      {note && (
        <>
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Linked from</p>
          {note.links.backlinks.length === 0 ? <p className="mt-2 text-xs text-foreground/45">No other note yet.</p> : (
            <ul className="mt-2 space-y-1 text-[13px]">
              {note.links.backlinks.slice(0, 8).map(b => (
                <li key={b.noteId}><Link href={`/notes/${encodeURIComponent(b.noteId!)}`} onClick={leave} className="block truncate text-keppel-300 hover:underline">{b.title}</Link></li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  )

  const sourcePane = source && (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-white/6 bg-white/[0.015]" aria-label="Source" data-note-source>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/6 px-3 text-xs">
        <Quote className="size-3.5 text-sky-300" />
        <span className="min-w-0 flex-1 truncate text-foreground/70">{source.label}</span>
        <a href={source.url} target="_blank" rel="noopener noreferrer" className={iconButton()} title="Open in a new tab"><ExternalLink className="size-3.5" /></a>
        <button type="button" onClick={() => setSourceOpen(false)} className={iconButton()} title="Close the source (Esc)"><X className="size-3.5" /></button>
      </div>
      {/* A web page is sandboxed: it can't navigate this tab or open
          dialogs. A PDF can't be: the browser's PDF viewer does not run in a
          sandboxed frame. Either way it is another site's page, which
          cannot read this one. */}
      <iframe key={source.view} src={source.view} title={`Source: ${source.label}`} className="min-h-0 w-full flex-1 bg-white"
        sandbox={source.pdf ? undefined : 'allow-scripts allow-same-origin allow-popups allow-forms'} referrerPolicy="no-referrer" />
      <p className="shrink-0 border-t border-white/6 px-3 py-1.5 text-[11px] text-foreground/45">
        Some sites don&apos;t allow being shown inside another page. If this stays blank, <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-keppel-300 underline">open it in a new tab</a>.
      </p>
    </section>
  )

  // Nova beside the note: a resizable panel on a wide screen, a drawer on a
  // phone or a narrow tablet. One is mounted at a time, so the conversation
  // is one conversation.
  const tutorWidth = dragWidth ?? clampTutor(prefs.tutorWidth)
  // Nova's two jobs in one panel: both mounted, one shown, so switching keeps
  // each conversation and both read the same note.
  const novaHeader = (onClose?: () => void) => function NovaHeader(status: React.ReactNode, working: boolean, clear: (() => void) | null = null) {
  return (
    <header className="shrink-0 border-b border-white/6 px-3.5 pb-2 pt-2.5">
      <div className="flex items-center gap-2">
        <Identity working={working} />
        <ModeSwitch mode={prefs.nova} onMode={m => setPrefs({ nova: m })} />
        <span className="flex-1" />
        {clear && <button type="button" onClick={clear} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" title="New conversation" aria-label="New conversation"><Trash2 className="size-4" /></button>}
        {onClose && <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" title="Close Nova" aria-label="Close Nova"><X className="size-4" /></button>}
      </div>
      <p className="mt-1 flex items-center gap-1.5 truncate pl-9 text-[11px] text-subtle" role="status" data-nova-status>{status}</p>
    </header>
  )
  }
  const tutor = (onClose?: () => void) => (
    <>
      <div className={prefs.nova === 'tutor' ? 'nova-pane-in flex min-h-0 flex-1 flex-col' : 'hidden'} data-nova-pane="tutor">
        <NovaTutor
          note={note} passage={passage} onClearPassage={() => setPassage(null)}
          ensureSaved={ensureSaved} version={version} onInsert={offerInsert} onUseTitle={offerTitle}
          onReveal={revealPassage} onEditor={toEditor} header={novaHeader(onClose)}
          autoAsk={autoAsk} onAutoAsked={() => { setAutoAsk(null); router.replace(`/notes/${note?.id ?? ''}`) }}
          inputRef={tutorInput}
        />
      </div>
      <div className={prefs.nova === 'editor' ? 'nova-pane-in flex min-h-0 flex-1 flex-col' : 'hidden'} data-nova-pane="editor">
        <NovaEditor
          note={note} passage={passage} onClearPassage={() => setPassage(null)}
          ensureSaved={ensureSaved} version={version} onApply={applyEditChanges} onRetrySave={saveNow} onShow={showChange}
          seed={editorSeed} onSeedUsed={() => setEditorSeed(null)} header={novaHeader(onClose)}
        />
      </div>
    </>
  )
  const splitter = (
    <div role="separator" aria-orientation="vertical" aria-label="Resize Nova's panel" tabIndex={0}
      aria-valuemin={TUTOR_MIN} aria-valuemax={TUTOR_MAX} aria-valuenow={tutorWidth}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPrefs({ tutorWidth: clampTutor(tutorWidth + (e.key === 'ArrowLeft' ? 24 : -24)) }) }
      }}
      onPointerDown={e => {
        e.preventDefault()
        const startX = e.clientX, startW = tutorWidth
        const move = (ev: PointerEvent) => setDragWidth(clampTutor(startW + (startX - ev.clientX)))
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
          setDragWidth(null); setPrefs({ tutorWidth: clampTutor(startW + (startX - ev.clientX)) })
        }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      }}
      className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent outline-none focus-visible:bg-nova/40" data-tutor-splitter>
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/8 transition-colors group-hover:bg-nova/50" />
    </div>
  )

  const workspace = (main: React.ReactNode) => (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0" data-note-workspace>
      {treeDocked && <div className="hidden w-64 shrink-0 border-r border-white/6 py-3 lg:block">{tree}</div>}
      {treeOnPhone && (
        <div className={`fixed inset-0 z-40 ${tutorDocked && !roomy ? '' : 'lg:hidden'}`} role="dialog" aria-label="Your notebook">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close the notebook" onClick={() => setTreeOnPhone(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/8 bg-background py-3 shadow-float">{tree}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {topBar}
        <div className="relative flex min-h-0 flex-1">
          {showSource && sourcePane}
          {main}
          {showOutline && !(wide && prefs.tutor) && outlinePanel}
          {wide && prefs.tutor && (
            <>
              {splitter}
              <aside className="flex min-h-0 shrink-0 flex-col" style={{ width: tutorWidth }} data-tutor-panel>{tutor(() => setPrefs({ tutor: false }))}</aside>
            </>
          )}
          <p className="sr-only" aria-live="polite">{live}</p>
          {(undo || notice) && (
            <div role="status" style={{ left: tutorDocked ? `calc((100% - ${tutorWidth}px) / 2)` : '50%' }} className="absolute bottom-20 z-30 flex w-max max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-background px-4 py-2.5 text-sm text-foreground/85 shadow-float" data-insert-toast>
              <span>{notice ?? `Added to your note: ${undo!.label}. ${saving ? 'Saving…' : dirty ? 'Saves in a moment.' : 'Saved.'}`}</span>
              {undo && !notice && <button type="button" onClick={undoInsert} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-insert-undo><Undo2 className="size-3.5" /> Undo</button>}
            </div>
          )}
        </div>
        {statusBar}
      </div>
      {!wide && tutorOnPhone && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Nova, your tutor" data-tutor-drawer>
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close Nova" onClick={() => setTutorOnPhone(false)} />
          <div className="absolute inset-x-0 bottom-0 top-[8vh] overflow-hidden rounded-t-2xl border-t border-white/10 shadow-float sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[min(28rem,92vw)] sm:rounded-none sm:border-l sm:border-t-0">
            {tutor(() => setTutorOnPhone(false))}
          </div>
        </div>
      )}
      {selChip && !editing && (
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => !selChip.tooLong && askAbout(selChip.text)} disabled={selChip.tooLong}
          style={{ left: selChip.x, top: selChip.y }}
          className="fixed z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-action px-3 py-1.5 text-xs font-semibold text-action-foreground shadow-float transition-colors hover:bg-action-hover disabled:bg-white/15 disabled:text-foreground/70"
          data-ask-selection>
          <Sparkles className="size-3.5" /> {selChip.tooLong ? `Select under ${TUTOR_SELECTION_MAX.toLocaleString()} characters to ask Nova` : 'Ask Nova'}
        </button>
      )}
      {commands.element}
      {pendingInsert && (
        <InsertPreview pending={pendingInsert} canPlaceAtCursor={editing && caret.current !== null} onConfirm={confirmInsert} onCancel={() => setPendingInsert(null)} />
      )}
    </div>
  )

  // ── Editing ────────────────────────────────────────────────────────────────
  if (editing) {
    const layout: Layout = prefs.layout === 'split' && !splitFits ? 'write' : prefs.layout
    const tools: Array<{ label: string; icon: typeof Bold; run: () => void; keys?: string } | 'gap'> = [
      { label: 'Heading', icon: Heading1, run: () => format((t, s, x) => prefixLines(t, s, x, '# ')) },
      { label: 'Subheading', icon: Heading2, run: () => format((t, s, x) => prefixLines(t, s, x, '## ')) },
      'gap',
      { label: 'Bold', icon: Bold, keys: 'Cmd/Ctrl B', run: () => format((t, s, x) => wrap(t, s, x, '**', 'bold')) },
      { label: 'Italic', icon: Italic, keys: 'Cmd/Ctrl I', run: () => format((t, s, x) => wrap(t, s, x, '*', 'italic')) },
      { label: 'Highlight', icon: Highlighter, keys: 'Cmd/Ctrl Shift E', run: () => format((t, s, x) => wrap(t, s, x, '==', 'highlight')) },
      { label: 'Code', icon: Code, run: () => format((t, s, x) => wrap(t, s, x, '`', 'code')) },
      'gap',
      { label: 'Quote from the source', icon: Quote, run: () => format((t, s, x) => callout(t, s, x, 'quote')) },
      { label: 'Idea callout', icon: Lightbulb, run: () => format((t, s, x) => callout(t, s, x, 'idea')) },
      { label: 'Question callout', icon: HelpCircle, run: () => format((t, s, x) => callout(t, s, x, 'question')) },
      'gap',
      { label: 'Bulleted list', icon: List, run: () => format((t, s, x) => prefixLines(t, s, x, '- ')) },
      { label: 'Numbered list', icon: ListOrdered, run: () => format((t, s, x) => prefixLines(t, s, x, '1. ')) },
      { label: 'Link a note', icon: Link2, run: () => format(noteLink) },
      { label: 'Tag', icon: Hash, run: () => format(tag) },
      { label: 'Divider', icon: Minus, run: () => format((t, s) => divider(t, s)) },
      'gap',
      { label: 'Ask Nova about the selection', icon: Sparkles, run: () => {
        const text = editorSelection()
        if (!text) { setNotice('Select some text in the note first, then ask Nova about it.'); return }
        if (text.length > TUTOR_SELECTION_MAX) { setNotice(`Select less: Nova takes up to ${TUTOR_SELECTION_MAX.toLocaleString()} characters at a time.`); return }
        askAbout(text)
      } },
    ]
    const editor = (
      <textarea
        id="note-body" ref={bodyRef} value={draft.body} maxLength={NOTE_BODY_MAX}
        onChange={e => { caret.current = e.target.selectionStart; setDraft(d => ({ ...d, body: e.target.value })) }}
        onSelect={e => { caret.current = e.currentTarget.selectionEnd }}
        onKeyDown={onBodyKey}
        placeholder={'Write what you\'re learning, in your own words.\n\nPaste a passage from what you\'re reading, select it and press the quote button: it becomes a callout, and your own thoughts go under it.'}
        className="min-h-[24rem] w-full flex-1 resize-none bg-transparent px-1 py-2 font-mono text-[14px] leading-[1.7] text-foreground/90 placeholder:font-sans placeholder:text-foreground/30 focus:outline-none"
        spellCheck
      />
    )
    const preview = (
      <div ref={previewRef} className="min-h-[24rem] px-1 py-2" data-note-preview>
        {draft.body.trim() ? <NoteBody body={draft.body} links={note?.links.outgoing ?? []} serif={prefs.serif} title={draft.title} /> : <p className="py-3 text-sm text-foreground/35">Nothing to preview yet.</p>}
      </div>
    )

    return workspace(
      <form className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={e => { e.preventDefault(); void save() }} data-note-form>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto w-full px-5 pb-10 pt-6 sm:px-8 ${layout === 'split' ? 'max-w-6xl' : 'max-w-3xl'}`}>
            {banners}
            <label htmlFor="note-title" className="sr-only">Title</label>
            <input
              id="note-title" value={draft.title} maxLength={NOTE_TITLE_MAX} autoFocus={!note}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Title"
              className="w-full bg-transparent font-serif text-2xl font-semibold leading-tight tracking-tight text-keppel-200 placeholder:text-foreground/25 focus:outline-none sm:text-4xl"
            />

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="note-subject" className="mb-1.5 block text-xs text-foreground/50">Subject</label>
                <select
                  id="note-subject" value={draft.subjectId}
                  onChange={e => setDraft(d => ({ ...d, subjectId: e.target.value, topicName: e.target.value ? d.topicName : '' }))}
                  className={`${field} h-10 text-sm`}
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
                  className={`${field} h-10 text-sm disabled:opacity-50`}
                />
                <datalist id="note-topics">{topicOptions.map(t => <option key={t} value={t} />)}</datalist>
              </div>
            </div>
            {subjects.length === 0 && (
              <p className="mt-2 text-xs text-foreground/45">Nova doesn&apos;t know your subjects yet, so this note can&apos;t be filed under one. You can still write it.</p>
            )}

            {!note && !draft.body.trim() && templates.length > 0 && (
              <div className="mt-4" data-note-templates>
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

            <div className="sticky top-0 z-10 -mx-2 mt-5 flex flex-wrap items-center gap-0.5 rounded-xl border border-white/8 bg-background/90 px-1.5 py-1 backdrop-blur" role="toolbar" aria-label="Formatting" data-note-toolbar>
              {tools.map((tool, n) => tool === 'gap'
                ? <span key={`g${n}`} className="mx-1 h-5 w-px bg-white/10" aria-hidden />
                : (
                  <button key={tool.label} type="button" onClick={tool.run} disabled={layout === 'preview'} className={iconButton()}
                    title={tool.keys ? `${tool.label} (${tool.keys})` : tool.label} aria-label={tool.label}>
                    <tool.icon className="size-4" />
                  </button>
                ))}
              <div role="tablist" aria-label="Write or preview" className="ml-auto inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                {(['write', 'split', 'preview'] as const).map(l => (
                  <button key={l} type="button" role="tab" aria-selected={layout === l} onClick={() => setPrefs({ layout: l })}
                    className={`rounded-md px-2.5 py-1 ${l === 'split' ? (splitFits ? 'max-lg:hidden' : 'hidden') : ''} ${layout === l || (l === 'write' && layout === 'split') ? `${layout === l ? '' : 'lg:bg-transparent lg:text-foreground/55'} bg-white/10 text-foreground` : 'text-foreground/55 hover:text-foreground'}`}>
                    {l === 'write' ? 'Write' : l === 'split' ? 'Split' : 'Preview'}
                  </button>
                ))}
              </div>
            </div>

            <label htmlFor="note-body" className="sr-only">Note</label>
            {layout === 'preview' ? <div className="mt-3">{preview}</div>
              : layout === 'split' ? (
                // Below lg there is no room for two panes: the editor alone.
                <div className="mt-3 grid gap-6 lg:grid-cols-2">
                  {/* Which side is typed into and which is drawn from it: one text, two views. */}
                  <div className="flex flex-col lg:border-r lg:border-white/6 lg:pr-6">
                    <p className="mb-1 hidden items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle lg:flex" data-pane="write"><Pencil className="size-3" aria-hidden /> Markdown · you type here</p>
                    {editor}
                  </div>
                  <div className="hidden lg:block">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle" data-pane="preview">Preview · drawn from the text, as saved notes look</p>
                    {preview}
                  </div>
                </div>
              )
              : <div className="mt-3 flex flex-col">{editor}</div>}
            {draft.body.length > NOTE_BODY_MAX * 0.9 && (
              <p className="mt-1 text-xs text-amber-300/80">{(NOTE_BODY_MAX - draft.body.length).toLocaleString()} characters left</p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-foreground/40">
              # heading · **bold** · ==highlight== · [[Title]] links a note · #tag · &gt; [!quote] starts a callout ([!idea], [!question], [!warning], [!summary], [!definition])
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-white/6 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          {error ? <p role="alert" className="text-sm text-red-300 sm:order-none">{error}</p> : <span className="hidden sm:block" />}
          <div className="flex items-center gap-3">
            <span className="sr-only" role="status" data-save-state={saving ? 'saving' : dirty ? 'unsaved' : 'clean'}>
              {saving ? 'Saving…' : dirty ? 'Not saved · kept in this browser' : ''}
            </span>
            <button type="button" onClick={cancel} disabled={saving} className={quiet}>{dirty || !note ? 'Cancel' : 'Done'}</button>
            <button type="submit" disabled={saving || !draft.title.trim()} className={`${primary} flex-1 sm:flex-none`} title="Save (Ctrl or Cmd + S)">
              {saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Save'}
            </button>
          </div>
        </div>
      </form>,
    )
  }

  // ── Reading ────────────────────────────────────────────────────────────────
  if (!note) return simple(null)
  const context = [note.subjectName, note.topicName].filter(Boolean).join(' · ')

  return workspace(
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" onScroll={() => setSelChip(null)} data-note-scroll>
      <article ref={articleRef} className="mx-auto w-full max-w-3xl px-5 pb-20 pt-8 sm:px-10" data-note-view={note.id}>
        {banners}
        <p className={`flex items-center gap-1.5 text-xs ${note.subjectName ? color.text : ''}`} data-note-context>
          {note.subjectName && <span className={`size-1.5 rounded-full ${color.dot}`} aria-hidden />}
          {context || <span className="text-foreground/40">No subject</span>}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-keppel-200 sm:text-[2.6rem]">{note.title}</h1>
        <p className="mt-2 text-xs text-foreground/40">
          Last updated {relativeDay(note.updatedAt)}{source && <> · from <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sky-300/80 hover:underline">{source.label}</a></>}
        </p>

        {justSaved && <p role="status" className="mt-4 flex items-center gap-1.5 text-sm text-foreground/70" data-note-saved><Check className="size-4 text-keppel-300" /> Saved</p>}

        <div className="mt-8">
          {note.body ? <NoteBody body={note.body} links={note.links.outgoing} serif={prefs.serif} title={note.title} /> : (
            <button type="button" onClick={() => setEditing(true)} className="w-full rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-foreground/45 transition-colors hover:border-keppel-400/40 hover:text-foreground/70">
              This note is empty. Press E or click here to write it.
            </button>
          )}
        </div>

        <section className="mt-12 rounded-2xl border border-white/8 bg-card/50 p-4 sm:p-5" data-study>
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
            {taskState === 'added' && <span role="status" className="text-xs text-foreground/60">On your task board. <Link href={BOARD_PATH} className="underline">Open it</Link></span>}
            {taskState === 'failed' && <span role="alert" className="text-xs text-red-300">That task didn&apos;t save. Try again.</span>}
          </div>
        </section>

        <section id="note-connections" aria-labelledby="note-links-heading" className="mt-10 scroll-mt-6 rounded-2xl border border-white/8 bg-card/40 p-4 sm:p-5" data-note-links>
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
              <button type="button" onClick={() => void remove()} disabled={deleting} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-400/40 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-60">
                {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete for good'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="text-sm text-foreground/55 hover:text-foreground">Keep it</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex h-10 items-center gap-2 px-2 text-sm text-foreground/50 transition-colors hover:text-red-300">
              <Trash2 className="size-4" /> Delete
            </button>
          )}
        </div>
      </article>
    </div>,
  )
}

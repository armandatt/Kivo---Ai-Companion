'use client'

// Bringing material into Notes: a passage the extension or the bookmarklet
// sent, text pasted from another app, or a file (Markdown, text, PDF, a
// photo of a page). It becomes an ordinary note through the ordinary notes
// route, or is added to the end of one that exists: one notes system, the
// learner's Save, nothing replaced. What arrived is kept as it arrived
// (product/note-capture.ts); a PDF or photo is transcribed by Nova only when
// the learner imports it, and the note says it is a transcription.
//
// Before saving, the page looks for a note that already has this source or
// this title and offers to add to it instead; it never merges by itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Check, ClipboardPaste, FileText, Loader2, Smartphone, Sparkles, Square, Upload } from 'lucide-react'
import type { NoteDetail, NoteSubjectOption, NoteSummary } from '@repo/api/nova/product/notes.types'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from '@repo/api/nova/product/notes.types'
import {
  CAPTURE_TEXT_MAX, appendToBody, captureBody, captureTitle, importBody, noteCaptureBookmarklet, type CaptureVia,
} from '@repo/api/nova/product/note-capture'
import type { NoteImportResponse } from '@repo/api/nova/product/note-import'
import { normalizeResourceUrl } from '@repo/api/nova/product/resource-link'
import { PageFrame, PageHeader } from '@/components/dashboard/page-states'
import { NoteBody } from './note-body'
import { createNote, fetchNote, fetchNotes, updateNote } from './notes-api'
import { takeNoteCapture } from './pending-note-capture'
import { transcribeFile } from './tutor-api'

const TEXT_TYPES = ['.md', '.markdown', '.txt', '.text']
const MODEL_TYPES = ['.pdf', '.png', '.jpg', '.jpeg', '.webp']
const TEXT_BYTES_MAX = 1024 * 1024
const MODEL_BYTES_MAX = 3 * 1024 * 1024

const field = 'w-full rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-nova/60 focus:outline-none'
const primary = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50'
const quiet = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5 disabled:opacity-50'

const today = () => new Date().toLocaleDateString('en-CA')
const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i === -1 ? '' : name.slice(i).toLowerCase() }

type FileState =
  | { status: 'idle' }
  | { status: 'reading' | 'transcribing'; name: string; since: number }
  | { status: 'ready'; name: string; text: string; transcription?: Extract<NoteImportResponse, { ok: true }> }
  | { status: 'error'; name: string; message: string; file?: File }

type Duplicate = { note: NoteSummary; reason: 'source' | 'title' }

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  return <span className="tabular-nums">{Math.max(0, Math.round((now - since) / 1000))}s</span>
}

export function NoteCaptureScreen() {
  const [ready, setReady] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [subjects, setSubjects] = useState<NoteSubjectOption[]>([])
  const [tab, setTab] = useState<'paste' | 'file' | 'setup'>('paste')

  // What is being brought in.
  const [via, setVia] = useState<CaptureVia>('paste')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [pageTitle, setPageTitle] = useState('')
  const [file, setFile] = useState<FileState>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)

  // Where it goes.
  const [dest, setDest] = useState<'new' | 'existing'>('new')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [topicName, setTopicName] = useState('')
  const [target, setTarget] = useState<NoteSummary | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NoteSummary[]>([])
  const [duplicates, setDuplicates] = useState<Duplicate[]>([])
  const [dupDismissed, setDupDismissed] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ note: NoteDetail; appended: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    // The fragment is taken once; a reload does not bring it back. A capture
    // sent to this page while it is open (same tab) arrives as a new fragment.
    const take = () => {
      const capture = takeNoteCapture()
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
      if (!capture) return
      setSaved(null); setTab('paste'); setFile({ status: 'idle' }); setDest('new'); setTarget(null); setTitleTouched(false); setDupDismissed(false); setError(null)
      setVia(capture.via); setText(capture.text); setUrl(capture.url ?? ''); setPageTitle(capture.title)
    }
    take()
    window.addEventListener('hashchange', take)
    void fetchNotes().then(list => {
      if (cancelled) return
      if (list?.status === 'ready') { setSubjects(list.subjects); setReady('ready') }
      else setReady('unavailable')
    })
    return () => { cancelled = true; abort.current?.abort(); window.removeEventListener('hashchange', take) }
  }, [])

  // What the note will hold: built from what arrived, the way it arrived.
  const cleanUrl = useMemo(() => (url.trim() ? normalizeResourceUrl(url.trim())?.url ?? null : null), [url])
  const urlBad = url.trim() !== '' && cleanUrl === null
  const addition = useMemo(() => {
    if (tab === 'file') {
      if (file.status !== 'ready') return ''
      const t = file.transcription
      return importBody({ fileName: file.name, text: file.text, transcription: t ? { pages: t.pages, quality: t.quality, complete: t.complete, illegible: t.illegible } : undefined }, today())
    }
    if (!text.trim() && !cleanUrl) return ''
    return captureBody({ url: cleanUrl, title: pageTitle, text: text.trim(), via }, today())
  }, [tab, file, text, cleanUrl, pageTitle, via])
  const suggestedTitle = useMemo(() => (tab === 'file'
    ? (file.status === 'ready' ? captureTitle({ text: file.text, fileName: file.name }) : '')
    : captureTitle({ title: pageTitle, text, url: cleanUrl })), [tab, file, pageTitle, text, cleanUrl])
  useEffect(() => { if (!titleTouched) setTitle(suggestedTitle) }, [suggestedTitle, titleTouched])

  // A note that may already hold this: the same source address, or the same
  // title. Offered, never merged.
  useEffect(() => {
    if (ready !== 'ready' || saved) return
    const timer = window.setTimeout(() => {
      void (async () => {
        const found: Duplicate[] = []
        if (cleanUrl && tab === 'paste') {
          const bySource = await fetchNotes({ q: cleanUrl })
          if (bySource?.status === 'ready') for (const n of bySource.notes.slice(0, 3)) found.push({ note: n, reason: 'source' })
        }
        const t = title.trim()
        if (t) {
          const byTitle = await fetchNotes({ q: t })
          if (byTitle?.status === 'ready') {
            for (const n of byTitle.notes) if (n.title.trim().toLowerCase() === t.toLowerCase() && !found.some(f => f.note.id === n.id)) found.push({ note: n, reason: 'title' })
          }
        }
        setDuplicates(found.slice(0, 3))
      })()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [cleanUrl, title, tab, ready, saved])

  // Finding a note to add to.
  useEffect(() => {
    if (dest !== 'existing') return
    const timer = window.setTimeout(() => {
      void fetchNotes(query.trim() ? { q: query.trim() } : {}).then(list => setResults(list?.status === 'ready' ? list.notes.slice(0, 8) : []))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [dest, query])

  const takeFile = useCallback(async (f: File) => {
    setError(null); setSaved(null)
    const ext = extOf(f.name)
    abort.current?.abort()
    if (TEXT_TYPES.includes(ext) || f.type === 'text/plain' || f.type === 'text/markdown') {
      if (f.size > TEXT_BYTES_MAX) { setFile({ status: 'error', name: f.name, message: 'That file is larger than a note can hold. Split it, or import part of it.' }); return }
      setFile({ status: 'reading', name: f.name, since: Date.now() })
      try {
        const body = (await f.text()).split('\r\n').join('\n')
        if (!body.trim()) { setFile({ status: 'error', name: f.name, message: `${f.name} is empty.` }); return }
        if (body.length > NOTE_BODY_MAX - 400) { setFile({ status: 'error', name: f.name, message: `${f.name} has more text than one note can hold (${NOTE_BODY_MAX.toLocaleString()} characters). Split it into parts.` }); return }
        setFile({ status: 'ready', name: f.name, text: body })
      } catch { setFile({ status: 'error', name: f.name, message: `${f.name} couldn't be read on this device.`, file: f }) }
      return
    }
    if (!MODEL_TYPES.includes(ext)) {
      setFile({ status: 'error', name: f.name, message: 'Kivo can import Markdown or text files, PDFs, and photos (PNG, JPEG, WebP). From Goodnotes, Notability or Apple Notes, export or share the page as a PDF first.' })
      return
    }
    if (f.size > MODEL_BYTES_MAX) { setFile({ status: 'error', name: f.name, message: 'That file is over 3 MB. Export fewer pages, or a smaller image.' }); return }
    const controller = new AbortController()
    abort.current = controller
    setFile({ status: 'transcribing', name: f.name, since: Date.now() })
    const res = await transcribeFile(f, controller.signal)
    if (controller.signal.aborted) return
    if (!res.ok) { setFile({ status: 'error', name: f.name, message: res.message, file: f }); return }
    setFile({ status: 'ready', name: f.name, text: res.text, transcription: res })
  }, [])

  const canSave = !!addition && !saving && !urlBad && (dest === 'new' ? !!title.trim() : !!target)

  async function save() {
    if (!canSave) return
    setSaving(true); setError(null)
    try {
      if (dest === 'new') {
        const res = await createNote({ title: title.trim().slice(0, NOTE_TITLE_MAX), body: addition, subjectId: subjectId || null, topicName: subjectId ? topicName.trim() || null : null, once: true })
        if (!res.ok) { setError(res.message); return }
        setSaved({ note: res.note, appended: false })
        return
      }
      // Added to the end of the note as it now stands; a note that changed on
      // the way is read again, and something already added is not added twice.
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await fetchNote(target!.id)
        if (!current.ok) { setError(current.message); return }
        if (current.note.body.includes(addition)) { setSaved({ note: current.note, appended: true }); return }
        const next = appendToBody(current.note.body, addition, today())
        if (next === null) { setError(`That would make “${current.note.title}” longer than a note can be. Save it as a new note instead.`); return }
        const res = await updateNote(current.note.id, { body: next, baseUpdatedAt: current.note.updatedAt })
        if (res.ok) { setSaved({ note: res.note, appended: true }); return }
        if (res.error !== 'conflict') { setError(res.message); return }
      }
      setError('That note kept changing while this was being added. Nothing was added; try again.')
    } finally { setSaving(false) }
  }

  function reset() {
    setSaved(null); setText(''); setUrl(''); setPageTitle(''); setFile({ status: 'idle' }); setTitle(''); setTitleTouched(false)
    setDest('new'); setTarget(null); setDuplicates([]); setDupDismissed(false); setVia('paste'); setError(null)
  }

  if (ready === 'loading') return <PageFrame><div className="mt-10 h-40 animate-pulse rounded-2xl bg-white/4" aria-busy="true" aria-label="Loading" /></PageFrame>
  if (ready === 'unavailable') return (
    <PageFrame>
      <PageHeader title="Capture" description="Notes are part of Nova, and this account is not set up with it yet." />
      <Link href="/home" className={`${primary} mt-6`}>Go to Today</Link>
    </PageFrame>
  )

  if (saved) return (
    <PageFrame>
      <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-white/8 bg-card/60 p-6 sm:p-8" role="status" data-capture-saved={saved.note.id}>
        <p className="flex items-center gap-2 text-sm font-semibold text-nova-ink"><Check className="size-4" /> {saved.appended ? 'Added to your note' : 'Saved as a note'}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{saved.note.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground/65">It is in Notes now: searchable, editable, on the Knowledge Map where it is filed, and Nova can teach you from it.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/notes/${encodeURIComponent(saved.note.id)}`} className={primary}>Open the note</Link>
          <Link href={`/notes/${encodeURIComponent(saved.note.id)}?tutor=organize`} className={quiet} data-capture-organize><Sparkles className="size-4" /> Organise it with Nova</Link>
          <button type="button" onClick={reset} className={quiet}>Capture another</button>
        </div>
        <p className="mt-4 text-xs text-subtle">Organising suggests a title, overview, headings and questions. You choose what to add; your text stays as it is.</p>
      </div>
    </PageFrame>
  )

  const busyFile = file.status === 'reading' || file.status === 'transcribing'

  return (
    <PageFrame>
      <Link href="/notes" className="inline-flex items-center gap-1.5 text-sm text-foreground/50 hover:text-foreground"><ArrowLeft className="size-4" /> Notes</Link>
      <PageHeader className="mt-4" title="Capture into Notes" description="Bring in what you wrote or read elsewhere. It's kept as it arrived, in a note of its own or added to one you have." />

      <div role="tablist" aria-label="What to bring in" className="mt-6 inline-flex rounded-xl border border-white/10 p-1 text-sm">
        {([['paste', 'Paste or capture', ClipboardPaste], ['file', 'Import a file', Upload], ['setup', 'From other apps and iPad', Smartphone]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${tab === k ? 'bg-white/10 text-foreground' : 'text-foreground/60 hover:text-foreground'}`} data-capture-tab={k}>
            <Icon className="size-3.5" /> <span className="max-sm:sr-only">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'setup' ? <CaptureSetup /> : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            {tab === 'paste' ? (
              <section className="space-y-3" data-capture-paste>
                {via !== 'paste' && <p className="rounded-xl bg-nova/[0.06] px-3 py-2 text-xs text-foreground/70">Sent {via === 'extension' ? 'from the Nova extension' : 'by the bookmarklet'}. Check it, then save.</p>}
                <div>
                  <label htmlFor="capture-text" className="mb-1.5 block text-xs text-foreground/55">Text</label>
                  <textarea id="capture-text" rows={9} value={text} maxLength={CAPTURE_TEXT_MAX} onChange={e => setText(e.target.value)}
                    placeholder="Paste a passage, your typed notes, or what you copied from another app."
                    className={`${field} py-3 leading-relaxed`} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="capture-url" className="mb-1.5 block text-xs text-foreground/55">Where it came from (optional)</label>
                    <input id="capture-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" inputMode="url" className={`${field} h-10`} aria-invalid={urlBad} />
                    {urlBad && <p className="mt-1 text-xs text-amber-300">That isn&apos;t a web address Kivo can keep (http or https).</p>}
                  </div>
                  <div>
                    <label htmlFor="capture-page" className="mb-1.5 block text-xs text-foreground/55">Its title (optional)</label>
                    <input id="capture-page" value={pageTitle} maxLength={NOTE_TITLE_MAX} onChange={e => setPageTitle(e.target.value)} className={`${field} h-10`} />
                  </div>
                </div>
              </section>
            ) : (
              <FilePicker file={file} busy={busyFile} onFile={f => void takeFile(f)} onStop={() => { abort.current?.abort(); setFile({ status: 'idle' }) }} />
            )}

            <section className="space-y-3 rounded-2xl border border-white/8 p-4" data-capture-destination>
              <div role="radiogroup" aria-label="Where it goes" className="flex flex-wrap gap-2 text-sm">
                {(['new', 'existing'] as const).map(d => (
                  <label key={d} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${dest === d ? 'border-nova/50 bg-nova/10 text-foreground' : 'border-white/10 text-foreground/70'}`}>
                    <input type="radio" name="dest" className="accent-[var(--nova)]" checked={dest === d} onChange={() => setDest(d)} /> {d === 'new' ? 'A new note' : 'Add to a note I have'}
                  </label>
                ))}
              </div>
              {dest === 'new' ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="capture-title" className="mb-1.5 block text-xs text-foreground/55">Note title</label>
                    <input id="capture-title" value={title} maxLength={NOTE_TITLE_MAX} onChange={e => { setTitle(e.target.value); setTitleTouched(true) }} className={`${field} h-10`} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="capture-subject" className="mb-1.5 block text-xs text-foreground/55">Subject</label>
                      <select id="capture-subject" value={subjectId} onChange={e => { setSubjectId(e.target.value); if (!e.target.value) setTopicName('') }} className={`${field} h-10`}>
                        <option value="">No subject</option>
                        {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="capture-topic" className="mb-1.5 block text-xs text-foreground/55">Topic</label>
                      <input id="capture-topic" list="capture-topics" value={topicName} maxLength={NOTE_TOPIC_MAX} disabled={!subjectId} onChange={e => setTopicName(e.target.value)} placeholder={subjectId ? 'Optional' : 'Choose a subject first'} className={`${field} h-10 disabled:opacity-50`} />
                      <datalist id="capture-topics">{(subjects.find(s => s.id === subjectId)?.topics ?? []).map(t => <option key={t} value={t} />)}</datalist>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="capture-find" className="mb-1.5 block text-xs text-foreground/55">Find the note</label>
                  <input id="capture-find" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your notes" className={`${field} h-10`} />
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" role="listbox" aria-label="Your notes">
                    {results.map(n => (
                      <li key={n.id}>
                        <button type="button" role="option" aria-selected={target?.id === n.id} onClick={() => setTarget(n)}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${target?.id === n.id ? 'bg-nova/12 text-foreground' : 'text-foreground/75 hover:bg-white/4'}`}>
                          <span className="block truncate font-medium">{n.title}</span>
                          {n.subjectName && <span className="block text-xs text-subtle">{[n.subjectName, n.topicName].filter(Boolean).join(' › ')}</span>}
                        </button>
                      </li>
                    ))}
                    {results.length === 0 && <li className="px-3 py-2 text-xs text-subtle">No notes match.</li>}
                  </ul>
                  <p className="mt-2 text-xs text-subtle">It is added at the end, under a divider and the date. Nothing in the note is changed.</p>
                </div>
              )}
            </section>

            {duplicates.length > 0 && !dupDismissed && !(dest === 'existing' && duplicates.some(d => d.note.id === target?.id)) && (
              <section role="status" className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.04] p-4 text-sm" data-capture-duplicates>
                <p className="flex items-center gap-2 font-medium text-foreground"><AlertTriangle className="size-4 text-amber-300" /> You may have this already</p>
                <ul className="mt-2 space-y-2">
                  {duplicates.map(d => (
                    <li key={d.note.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-foreground/80">“{d.note.title}” <span className="text-xs text-subtle">{d.reason === 'source' ? 'has this source' : 'has this title'}</span></span>
                      <button type="button" className="text-xs font-medium text-nova-ink hover:underline" onClick={() => { setDest('existing'); setTarget(d.note) }} data-duplicate-append>Add to it</button>
                      <Link href={`/notes/${encodeURIComponent(d.note.id)}`} className="text-xs text-foreground/60 hover:underline">Open it</Link>
                    </li>
                  ))}
                </ul>
                <button type="button" className="mt-3 text-xs text-foreground/60 hover:text-foreground" onClick={() => setDupDismissed(true)} data-duplicate-keep>Keep it as a separate note</button>
              </section>
            )}

            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void save()} disabled={!canSave} className={primary} data-capture-save>
                {saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : dest === 'new' ? 'Save as a note' : target ? `Add to “${target.title.slice(0, 40)}”` : 'Choose a note'}
              </button>
              <span className="text-xs text-subtle">Saved to your account only. You can edit it afterwards.</span>
            </div>
          </div>

          <aside className="min-w-0" aria-label="Preview" data-capture-preview>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">{dest === 'existing' && target ? `Added to the end of “${target.title}”` : 'The note'}</p>
            <div className="mt-2 min-h-40 rounded-2xl border border-white/8 bg-card/40 px-5 py-4">
              {addition ? (
                <>
                  {dest === 'new' && title.trim() && <h2 className="mb-3 font-serif text-2xl font-semibold text-keppel-200">{title}</h2>}
                  <NoteBody body={addition} links={[]} />
                </>
              ) : <p className="text-sm text-subtle">{tab === 'file' ? 'Choose a file to see what will be saved.' : 'Paste something, or open this page from the extension or the bookmarklet.'}</p>}
            </div>
          </aside>
        </div>
      )}
    </PageFrame>
  )
}

function FilePicker({ file, busy, onFile, onStop }: { file: FileState; busy: boolean; onFile: (f: File) => void; onStop: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <section className="space-y-3" data-capture-file={file.status}>
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
        className={`rounded-2xl border border-dashed px-5 py-8 text-center transition-colors ${over ? 'border-nova/60 bg-nova/[0.06]' : 'border-white/15'}`}>
        <FileText className="mx-auto size-6 text-subtle" aria-hidden />
        <p className="mt-2 text-sm text-foreground/75">Drop a file here, or</p>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className={`${quiet} mt-3`}><Upload className="size-4" /> Choose a file</button>
        <input ref={input} type="file" className="sr-only" accept={[...TEXT_TYPES, ...MODEL_TYPES, 'text/plain', 'text/markdown', 'application/pdf', 'image/*'].join(',')}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} aria-label="Choose a file to import" />
        <p className="mt-3 text-xs leading-relaxed text-subtle">Markdown or text, kept exactly. PDF or a photo (up to 3 MB, 20 pages): Nova transcribes it for you to check.</p>
      </div>

      {(file.status === 'reading' || file.status === 'transcribing') && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2.5 text-sm text-foreground/75" data-file-working>
          <Loader2 className="size-4 animate-spin text-nova-ink" />
          <span className="min-w-0 flex-1 truncate">{file.status === 'reading' ? `Reading ${file.name}` : `Sending ${file.name} and transcribing it with Nova`} · <Elapsed since={file.since} /></span>
          {file.status === 'transcribing' && <button type="button" onClick={onStop} className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground"><Square className="size-3" /> Stop</button>}
        </div>
      )}
      {file.status === 'error' && (
        <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/[0.05] px-3 py-2.5 text-sm text-foreground/80" data-file-error>
          <p>{file.message}</p>
          {file.file && <button type="button" onClick={() => onFile(file.file!)} className="mt-2 text-xs font-medium text-nova-ink hover:underline">Try again</button>}
        </div>
      )}
      {file.status === 'ready' && (
        <div className="rounded-xl border border-white/8 px-3 py-2.5 text-sm" data-file-ready={file.transcription ? (file.transcription.complete ? file.transcription.quality : 'partial') : 'text'}>
          <p className="flex items-center gap-2 font-medium text-foreground"><Check className="size-4 text-nova-ink" /> {file.name}</p>
          {!file.transcription ? <p className="mt-1 text-xs text-subtle">Read on this device and kept exactly as written.</p> : (
            <ul className="mt-1 space-y-0.5 text-xs text-foreground/70">
              <li>Transcribed by Nova{file.transcription.pages ? ` · ${file.transcription.pages} page${file.transcription.pages === 1 ? '' : 's'}` : ''} · {file.transcription.kind}</li>
              {file.transcription.quality !== 'clear' && <li className="text-amber-300">Nova was unsure of {file.transcription.quality === 'poor' ? 'much of it' : 'some places'}. Check it against your original.</li>}
              {file.transcription.illegible > 0 && <li>{file.transcription.illegible} place{file.transcription.illegible === 1 ? '' : 's'} marked [illegible].</li>}
              {!file.transcription.complete && <li className="text-amber-300">It stops before the end of the file. Save what is here, then import the rest separately.</li>}
              <li className="text-subtle">Kivo does not keep the file itself: keep your original.</li>
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// How to bring things in from elsewhere, as it works today.
function CaptureSetup() {
  const link = useRef<HTMLAnchorElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  useEffect(() => {
    const made = noteCaptureBookmarklet(window.location.origin)
    setCode(made)
    if (made) link.current?.setAttribute('href', made)
  }, [])
  const homeScreen = typeof window !== 'undefined' ? `${window.location.origin}/notes/capture` : '/notes/capture'
  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-2" data-capture-setup>
      <section className="rounded-2xl border border-white/8 bg-card/50 p-5">
        <h2 className="text-sm font-semibold text-foreground">From a web page: the bookmarklet</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/65">Select a passage on any page and press this bookmark: it opens this screen with the passage, the page&apos;s address and its title. Nothing to install, and it works in Safari on iPad and iPhone.</p>
        <a ref={link} href="#" draggable onClick={e => e.preventDefault()} className="mt-4 inline-flex h-10 cursor-grab items-center rounded-xl border border-dashed border-nova/50 bg-nova/8 px-4 text-sm font-semibold text-nova-ink" data-note-bookmarklet>Send to Kivo Notes</a>
        <ol className="mt-4 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/60">
          <li>On a computer: drag the button onto your bookmarks bar.</li>
          <li>On iPad or iPhone: copy the code below, bookmark any page in Safari, then edit that bookmark: name it “Send to Kivo Notes” and paste the code as its address.</li>
          <li>Then select text on a page and open the bookmark from your bookmarks.</li>
        </ol>
        <button type="button" disabled={!code} onClick={async () => { try { await navigator.clipboard.writeText(code!); setCopied('yes') } catch { setCopied('no') } }} className="mt-3 rounded-lg border border-white/12 px-3 py-1.5 text-xs text-foreground/75 hover:bg-white/5 disabled:opacity-50">{copied === 'yes' ? 'Copied' : 'Copy bookmarklet code'}</button>
        {copied === 'no' && <p role="alert" className="mt-1 text-xs text-amber-300">Your browser did not allow copying.</p>}
        <p className="mt-3 text-xs text-subtle">Up to 6,000 characters of selection travel this way. Some sites block bookmarklets; copy and paste always works.</p>
      </section>

      <section className="rounded-2xl border border-white/8 bg-card/50 p-5">
        <h2 className="text-sm font-semibold text-foreground">The Nova browser extension</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/65">In Chrome, Edge, Brave, Arc or Safari on a Mac: select a passage, open Nova from the toolbar and choose <strong>Add to notes</strong>. It opens this screen with the passage and its source, ready to save.</p>
        <p className="mt-2 text-xs text-subtle">Connect the extension from Saved. The extension does not run on iPad: use the bookmarklet there.</p>
      </section>

      <section className="rounded-2xl border border-white/8 bg-card/50 p-5 lg:col-span-2">
        <h2 className="text-sm font-semibold text-foreground">From Goodnotes, Notability, Apple Notes and other apps</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/65">
          <li><strong>Handwritten or drawn pages</strong>: export or share them as a PDF (Goodnotes: Share › Export › PDF; Notability: Share › PDF; Apple Notes: Share › Send a copy › PDF) and save it to Files. Then come here, choose Import a file, and pick it from Files. Nova transcribes it and marks what it could not read; keep your original, since Kivo does not store the file.</li>
          <li><strong>Typed notes</strong>: select all, copy, and paste on the first tab. Or export as text or Markdown and import the file: it is kept exactly.</li>
          <li><strong>A photo of a page</strong>: import the photo (PNG or JPEG). Handwriting, diagrams and equations may not transcribe exactly.</li>
          <li><strong>One tap to this screen</strong>: in Safari, open {homeScreen}, then Share › Add to Home Screen.</li>
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-subtle">Kivo does not appear in the iPad share sheet yet: that needs a Kivo app installed on the device, which does not exist yet. Until then, the routes above are the ones that work.</p>
      </section>
    </div>
  )
}

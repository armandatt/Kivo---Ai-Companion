'use client'

// Bring one note in (docs/KIVO_NOTE_FORMAT.md): a .kivo note someone shared,
// or a PDF. Choose the file → Kivo checks it and says what's inside → choose
// where it goes → Import → open the note.
//   .kivo  becomes a new note of yours, its text exactly, with its images and
//          files (the creator's subject is only a suggestion);
//   PDF    becomes a note that keeps the original file, untouched. Its text can
//          be read here (PDF.js, in this browser) and added below it, but only
//          if you choose, and it says it may be incomplete: the PDF stays the
//          record. Nothing is sent to a model; any plan can import.
// The server decides everything (packages/api/src/portable/note-share.ts).

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { FileUp, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { fetchNote, updateNote } from './notes-api'
import { pdfjs } from './pdfjs-loader'
import { extractedSection } from './note-share-data'

const CARD = 'rounded-2xl border border-white/8 bg-card/60 p-5'
const KIVO_MAX = 50_000_000, PDF_MAX = 10_000_000
const TEXT_MAX = 400_000, PAGES_MAX = 300

type Preview = {
  ok: true; kind: 'kivo' | 'pdf'; title: string; creator: string | null; exportedAt: string | null; license: string | null
  images: number; files: number; storageBytes: number; leftOut: { images: number; files: number }; fileName: string | null
  suggested: { subjectName: string | null; topicName: string | null; subjectId: string | null }
  already: { noteId: string; at: string } | null; copies: number
}
type Result = { ok: true; status: 'complete'; noteId: string; already: boolean; counts: { images: number; files: number } }
  | { ok: true; status: 'running'; jobId: string }
  | { ok: false; reason?: string; found?: 'map' | 'note'; message: string }
type Subject = { id: string; name: string; parentId?: string | null; topics: Array<{ name: string; archived?: boolean }> }

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const size = (b: number) => b >= 1_000_000 ? `${(b / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1000)).toLocaleString()} KB`

// The text of a PDF, read in this browser by PDF.js. Never sent anywhere until
// the learner chooses to add it to their note.
async function readPdfText(file: File): Promise<{ text: string; pages: number; partial: boolean }> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
  const pages = doc.numPages
  let text = '', partial = pages > PAGES_MAX
  for (let i = 1; i <= Math.min(pages, PAGES_MAX); i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      line += item.str
      if (item.hasEOL) { text += `${line.trimEnd()}\n`; line = '' } else if (!item.str.endsWith(' ')) line += ' '
    }
    text += `${line.trimEnd()}\n\n`
    if (text.length > TEXT_MAX) { partial = true; text = text.slice(0, TEXT_MAX); break }
  }
  await doc.destroy()
  return { text, pages, partial }
}

async function send(url: string, file: File) {
  const type = /\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/vnd.kivo.note+zip'
  return fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: file })
}

export function NoteImport() {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<'idle' | 'checking' | 'ready' | 'importing' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [wrongKind, setWrongKind] = useState(false)
  const [result, setResult] = useState<Extract<Result, { status: 'complete' }> | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectId, setSubjectId] = useState('')
  const [topic, setTopic] = useState('')
  const [title, setTitle] = useState('')
  const [pdfText, setPdfText] = useState<{ text: string; pages: number; partial: boolean } | null>(null)
  const [reading, setReading] = useState<'no' | 'reading' | 'failed'>('no')
  const [addText, setAddText] = useState(false)
  const [textNote, setTextNote] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/nova/subjects', { cache: 'no-store' }).then(r => r.json())
      .then((b: { status: string; subjects?: Subject[] }) => setSubjects(b.status === 'ready' ? b.subjects ?? [] : [])).catch(() => setSubjects([]))
  }, [])
  const topics = useMemo(() => (subjects.find(s => s.id === subjectId)?.topics ?? []).filter(t => !t.archived).map(t => t.name), [subjects, subjectId])

  const check = async (f: File) => {
    setFile(f); setPreview(null); setResult(null); setMessage(null); setWrongKind(false); setPdfText(null); setReading('no'); setAddText(false); setTextNote(null)
    const isPdf = /\.pdf$/i.test(f.name)
    if (!isPdf && !/\.kivo$/i.test(f.name)) { setState('error'); setMessage('Choose a .kivo note or a PDF.'); return }
    if (f.size > (isPdf ? PDF_MAX : KIVO_MAX)) { setState('error'); setMessage(isPdf ? 'That PDF is larger than 10 MB.' : 'That file is too large (50 MB at most).'); return }
    setState('checking')
    try {
      const res = await send(`/api/nova/portable/notes/import?action=preview&name=${encodeURIComponent(f.name)}`, f)
      if (res.status === 401) { window.location.href = '/signin?from=/notes/import'; return }
      const body = await res.json() as Preview | { ok: false; message: string; found?: 'map' | 'note' }
      if (!body.ok) { setState('error'); setMessage(body.message); setWrongKind(body.found === 'map'); return }
      setPreview(body); setTitle(body.title)
      setSubjectId(body.suggested.subjectId ?? ''); setTopic(body.suggested.subjectId ? body.suggested.topicName ?? '' : '')
      setState('ready')
    } catch { setState('error'); setMessage('Could not reach Kivo. Check your connection and try again.') }
  }

  const readText = async () => {
    if (!file) return
    setReading('reading')
    try { const t = await readPdfText(file); setPdfText(t); setReading('no'); setAddText(t.text.trim().length > 0) }
    catch { setReading('failed') }
  }

  const run = async (copy = false) => {
    if (!file || !preview) return
    setState('importing'); setMessage(null); setTextNote(null)
    const q = new URLSearchParams({ action: 'import', name: file.name, ...(subjectId ? { subjectId } : {}), ...(subjectId && topic.trim() ? { topicName: topic.trim() } : {}), ...(title.trim() ? { title: title.trim() } : {}), ...(copy ? { copy: '1' } : {}) })
    try {
      let body: Result = await (await send(`/api/nova/portable/notes/import?${q}`, file)).json()
      // Another tab is importing the same file: wait for it.
      for (let i = 0; i < 20 && body.ok && body.status === 'running'; i++) {
        await new Promise(r => setTimeout(r, 3000))
        body = await (await send(`/api/nova/portable/notes/import?${q}`, file)).json()
      }
      if (!body.ok || body.status !== 'complete') { setState('error'); setMessage(body.ok ? 'Still working on it. Try again in a moment.' : body.message); return }
      // The PDF's text, only when chosen, below the PDF and labelled.
      if (preview.kind === 'pdf' && addText && pdfText?.text.trim() && !body.already) {
        const note = await fetchNote(body.noteId)
        if (note.ok) {
          const upd = await updateNote(body.noteId, { body: `${note.note.body}${extractedSection(pdfText.text, pdfText.pages, pdfText.partial)}`, baseUpdatedAt: note.note.updatedAt })
          if (!upd.ok) setTextNote('The PDF was imported, but its text couldn’t be added. Open the note and paste it in if you need it.')
        }
      }
      setResult(body); setState('done')
    } catch { setState('error'); setMessage('The connection dropped. Nothing is lost: import the same file again and it continues where it stopped.') }
  }

  const select = 'w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground'
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-20 pt-10 lg:pt-4" data-note-import>
      <header>
        <Link href="/notes" className="text-sm text-foreground/55 hover:text-foreground">← Notes</Link>
        <h1 className="mt-3 text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.2rem]">Import a note</h1>
        <p className="mt-2 max-w-prose text-sm text-foreground/60">Open a <code>.kivo</code> note someone shared with you, or a PDF. It becomes your own note to change as you like.</p>
      </header>

      <section aria-labelledby="note-import-h" className={CARD}>
        <h2 id="note-import-h" className="flex items-center gap-2 text-base font-semibold text-foreground"><FileUp aria-hidden className="size-4" /> Choose the file</h2>
        <p className="mt-1 text-sm text-foreground/60">You’ll see what’s inside before anything is added.</p>
        <input ref={input} type="file" accept=".kivo,.pdf,application/pdf" className="sr-only" aria-label="Choose a .kivo note or a PDF" onChange={e => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = '' }} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => input.current?.click()} disabled={state === 'checking' || state === 'importing'} className={BUTTON_QUIET} data-note-import-choose>
            <Upload className="size-3.5" /> {file ? 'Choose a different file' : 'Choose a .kivo or PDF'}
          </button>
          {file && <span className="text-xs text-foreground/55">{file.name} · {size(file.size)}</span>}
        </div>

        {state === 'checking' && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-foreground/70"><Loader2 className="size-4 animate-spin" /> Looking inside the file…</p>}
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/8 px-3 py-2 text-sm text-foreground/85" data-note-import-error>{message}{wrongKind && <> <Link href="/map/import" className="font-medium text-keppel-300 underline">Import it as a map</Link></>}</p>}

        {preview && state !== 'done' && (
          <div className="mt-5 space-y-4" data-note-import-preview={preview.kind}>
            <div>
              <p className="text-lg font-semibold text-foreground">{preview.title}</p>
              <p className="mt-1 text-xs text-foreground/50">
                {preview.kind === 'pdf'
                  ? `PDF · ${size(preview.storageBytes)} · kept exactly as it is, with a note around it`
                  : [preview.creator && `By ${preview.creator}`, preview.exportedAt && `Exported ${new Date(preview.exportedAt).toLocaleDateString()}`, [preview.images ? plural(preview.images, 'image') : null, preview.files ? plural(preview.files, 'file') : null].filter(Boolean).join(' and ') || 'Text only'].filter(Boolean).join(' · ')}
              </p>
              {preview.storageBytes > 0 && <p className="mt-1 text-xs text-foreground/60" data-note-import-storage>Uses {size(preview.storageBytes)} of your storage.</p>}
              {(preview.leftOut.images > 0 || preview.leftOut.files > 0) && <p className="mt-1 text-xs text-foreground/50">The sender’s note named {[preview.leftOut.images ? plural(preview.leftOut.images, 'image') : null, preview.leftOut.files ? plural(preview.leftOut.files, 'file') : null].filter(Boolean).join(' and ')} that couldn’t be carried.</p>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-foreground/60 sm:col-span-2">Title
                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={cn(select, 'mt-1')} data-note-import-title />
              </label>
              <label className="text-xs text-foreground/60">Subject
                <select value={subjectId} onChange={e => { setSubjectId(e.target.value); setTopic('') }} className={cn(select, 'mt-1')} data-note-import-subject>
                  <option value="">No subject (just in Notes)</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {preview.suggested.subjectName && !preview.suggested.subjectId && <span className="mt-1 block text-[11px] text-foreground/45">The sender filed it under “{preview.suggested.subjectName}”, which you don’t have.</span>}
              </label>
              <label className="text-xs text-foreground/60">Topic (optional)
                <input value={topic} onChange={e => setTopic(e.target.value)} disabled={!subjectId} list="note-import-topics" maxLength={120} className={cn(select, 'mt-1 disabled:opacity-50')} data-note-import-topic />
                <datalist id="note-import-topics">{topics.map(t => <option key={t} value={t} />)}</datalist>
              </label>
            </div>

            {preview.kind === 'pdf' && (
              <div className="rounded-xl border border-white/8 px-3 py-3 text-sm" data-note-import-pdf-text>
                <p className="text-foreground/80">The PDF is kept as it is. You can also add its text to the note, so you can search and quote it.</p>
                {!pdfText && reading !== 'reading' && <button type="button" onClick={() => void readText()} className={cn(BUTTON_QUIET, 'mt-2')} data-note-import-read-text>Read the text inside</button>}
                {reading === 'reading' && <p role="status" className="mt-2 flex items-center gap-2 text-foreground/70"><Loader2 className="size-4 animate-spin" /> Reading the PDF in your browser…</p>}
                {reading === 'failed' && <p className="mt-2 text-amber-200">This PDF’s text couldn’t be read here (it may be scanned images). The PDF itself still imports.</p>}
                {pdfText && (pdfText.text.trim()
                  ? <>
                      <p className="mt-2 text-xs text-foreground/55">Read from {plural(pdfText.pages, 'page')}{pdfText.partial ? ' (the first part only)' : ''}. It can miss or misorder text, tables, formulas and images, so it’s added under a heading that says so; the PDF stays the record.</p>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 font-sans text-xs text-foreground/75" data-note-import-text-preview>{pdfText.text.slice(0, 3000)}{pdfText.text.length > 3000 ? '\n…' : ''}</pre>
                      <label className="mt-2 flex items-center gap-2 text-foreground/80"><input type="checkbox" checked={addText} onChange={e => setAddText(e.target.checked)} data-note-import-add-text /> Add this text below the PDF</label>
                    </>
                  : <p className="mt-2 text-foreground/60">No text was found (it may be scanned images). The PDF itself still imports.</p>)}
              </div>
            )}

            {preview.already
              ? <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/75">You’ve already imported this. <Link href={`/notes/${encodeURIComponent(preview.already.noteId)}`} className="text-keppel-300 underline">Open it</Link>
                  <button type="button" onClick={() => void run(true)} disabled={state === 'importing'} className="text-foreground/60 underline hover:text-foreground" data-note-import-copy>Import another copy</button></p>
              : <button type="button" onClick={() => void run()} disabled={state === 'importing' || !title.trim()} className={BUTTON_PRIMARY} data-note-import-run>
                  {state === 'importing' ? <><Loader2 className="size-4 animate-spin" /> Importing…</> : 'Import note'}
                </button>}
          </div>
        )}

        {state === 'done' && result && (
          <div role="status" className="mt-5 rounded-xl border border-keppel-400/30 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/85" data-note-import-done>
            <p className="font-medium text-foreground">{result.already ? 'This note is already in your Kivo.' : 'Imported 🎉'}</p>
            <p className="mt-1">{preview?.kind === 'pdf' ? 'The PDF is kept with the note, exactly as it was.' : [result.counts.images ? plural(result.counts.images, 'image') : null, result.counts.files ? plural(result.counts.files, 'file') : null].filter(Boolean).join(' and ') + (result.counts.images || result.counts.files ? ' came with it. ' : '') + 'It’s your note now.'}</p>
            {textNote && <p className="mt-1 text-amber-200">{textNote}</p>}
            <Link href={`/notes/${encodeURIComponent(result.noteId)}`} className={cn(BUTTON_PRIMARY, 'mt-3 inline-flex')} data-note-import-open>Open the note</Link>
          </div>
        )}
      </section>
      <p className="text-sm text-foreground/55">Sharing a whole map instead? <Link href="/map/import" className="text-keppel-300 hover:underline">Import a map</Link></p>
    </div>
  )
}

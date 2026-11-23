'use client'

// Import and export Knowledge Maps as .kivo files (docs/KIVO_PACKAGES.md).
// Import: choose a file → Kivo checks it → preview → Import → open the map.
// Export: choose a subject → tick the notes to include → licence → download.
// Everything is decided on the server (packages/api/src/portable); this page
// sends the file or the choices and shows what comes back.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Download, FileUp, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'

const CARD = 'rounded-2xl border border-white/8 bg-card/60 p-5'
const LICENCES: Array<[string, string]> = [
  ['all-rights-reserved', 'All rights reserved (for their own study)'],
  ['cc-by-4.0', 'CC BY 4.0 (share and adapt, with credit)'],
  ['cc-by-sa-4.0', 'CC BY-SA 4.0 (share alike, with credit)'],
  ['cc-by-nc-4.0', 'CC BY-NC 4.0 (non-commercial, with credit)'],
  ['cc0-1.0', 'CC0 (no rights reserved)'],
]

type Preview = {
  ok: true; packageId: string; title: string; description: string | null; creator: string | null; source: string | null; license: string; exportedAt: string | null
  counts: { subjects: number; topics: number; notes: number; links: number; edges: number; nestedSubjects: number }
  excluded: { noteImages: number; privateNotes: number }
  renames: Array<{ from: string; to: string }>; outline: Array<{ name: string; depth: number; topics: number }>
  job: { id: string; status: string; rootSubjectId: string | null } | null
}
type ImportResult = { ok: true; status: 'complete'; jobId: string; rootSubjectId: string; already: boolean; counts: { subjects: number; topics: number; notes: number } }
  | { ok: true; status: 'running'; jobId: string }
  | { ok: false; status?: string; jobId?: string; message: string }

async function send(url: string, file: File): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/vnd.kivo.map+zip' }, body: file })
}

export function PortableMaps() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-20 pt-10 lg:pt-4">
      <header>
        <Link href="/map" className="text-sm text-foreground/55 hover:text-foreground">← Knowledge Map</Link>
        <h1 className="mt-3 text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.2rem]">Import and export maps</h1>
        <p className="mt-2 max-w-prose text-sm text-foreground/60">A <code>.kivo</code> file carries a Knowledge Map: its subjects, topics, chosen notes and links. Importing makes your own copy; nothing you change reaches whoever made it.</p>
      </header>
      <ImportSection />
      <ExportSection />
    </div>
  )
}

// ── Import ──
function ImportSection() {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<'idle' | 'checking' | 'ready' | 'importing' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const check = async (f: File) => {
    setFile(f); setPreview(null); setResult(null); setMessage(null)
    if (!/\.kivo$/i.test(f.name)) { setState('error'); setMessage('Choose a .kivo file.'); return }
    if (f.size > 10_000_000) { setState('error'); setMessage('That file is too large for a Kivo map (10 MB at most).'); return }
    setState('checking')
    try {
      const res = await send('/api/nova/portable/import/preview', f)
      if (res.status === 401) { window.location.href = '/signin?from=/map/portable'; return }
      const body = await res.json() as Preview | { ok: false; message: string }
      if (!body.ok) { setState('error'); setMessage(body.message); return }
      setPreview(body); setState('ready')
    } catch { setState('error'); setMessage('Could not reach Kivo. Check your connection and try again.') }
  }

  const run = async () => {
    if (!file) return
    setState('importing'); setMessage(null)
    try {
      let res = await send('/api/nova/portable/import', file)
      let body = await res.json() as ImportResult
      // Another tab is running the same import: wait for it.
      for (let i = 0; i < 20 && body.ok && body.status === 'running'; i++) {
        await new Promise(r => setTimeout(r, 3000))
        res = await fetch(`/api/nova/portable/import/${body.jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        body = await res.json() as ImportResult
      }
      setResult(body)
      setState(body.ok && body.status === 'complete' ? 'done' : 'error')
      if (!body.ok) setMessage(body.message)
    } catch { setState('error'); setMessage('The connection dropped. Nothing is lost: import the same file again and it continues where it stopped.') }
  }

  const retry = async () => {
    const jobId = result && 'jobId' in result ? result.jobId : preview?.job?.id
    if (!jobId) return run()
    setState('importing'); setMessage(null)
    try {
      const res = await fetch(`/api/nova/portable/import/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json() as ImportResult
      setResult(body); setState(body.ok && body.status === 'complete' ? 'done' : 'error')
      if (!body.ok) setMessage(body.message)
    } catch { setState('error'); setMessage('Could not reach Kivo. Try again.') }
  }

  return (
    <section aria-labelledby="import-h" className={CARD}>
      <h2 id="import-h" className="flex items-center gap-2 text-base font-semibold text-foreground"><FileUp aria-hidden className="size-4" /> Import a map</h2>
      <p className="mt-1 text-sm text-foreground/60">Kivo checks the file first and shows what it holds. Nothing is added until you choose Import.</p>
      <input ref={input} type="file" accept=".kivo" className="sr-only" aria-label="Choose a .kivo file" onChange={e => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = '' }} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} disabled={state === 'checking' || state === 'importing'} className={BUTTON_QUIET}>
          <Upload className="size-3.5" /> {file ? 'Choose another file' : 'Choose a .kivo file'}
        </button>
        {file && <span className="text-xs text-foreground/55">{file.name} · {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB</span>}
      </div>

      {state === 'checking' && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-foreground/70"><Loader2 className="size-4 animate-spin" /> Checking the file…</p>}
      {message && <p role="alert" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/8 px-3 py-2 text-sm text-foreground/85">{message}</p>}

      {preview && state !== 'done' && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-lg font-semibold text-foreground">{preview.title}</p>
            {preview.description && <p className="mt-1 text-sm text-foreground/65">{preview.description}</p>}
            <p className="mt-1 text-xs text-foreground/50">{[preview.creator && `By ${preview.creator}`, preview.source, preview.exportedAt && `Exported ${new Date(preview.exportedAt).toLocaleDateString()}`, licenceName(preview.license)].filter(Boolean).join(' · ')}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {([['Subjects', preview.counts.subjects], ['Topics', preview.counts.topics], ['Notes', preview.counts.notes], ['Links', preview.counts.links]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/6 px-3 py-2"><dt className="text-[11px] text-foreground/50">{k}</dt><dd className="text-base font-semibold tabular-nums text-foreground">{v.toLocaleString()}</dd></div>
            ))}
          </dl>
          <details className="text-sm">
            <summary className="cursor-pointer text-foreground/70">Outline ({preview.counts.subjects} subjects, {preview.counts.nestedSubjects} inside others)</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-foreground/70">
              {preview.outline.map((s, i) => <li key={i} style={{ paddingLeft: `${(s.depth - 1) * 16}px` }}>{s.name} <span className="text-foreground/40">· {s.topics} topics</span></li>)}
            </ul>
          </details>
          {preview.renames.length > 0 && <p className="text-xs text-foreground/60">You already have {preview.renames.length === 1 ? 'a subject' : 'subjects'} with {preview.renames.length === 1 ? 'that name' : 'these names'}, so the copy is named {preview.renames.map(r => `“${r.to}”`).join(', ')}. Your own stay as they are.</p>}
          <p className="text-xs text-foreground/50">Not in this file: {[preview.excluded.noteImages ? `${preview.excluded.noteImages} images in notes` : null, 'anyone’s study progress'].filter(Boolean).join('; ')}. It uses none of your image storage.</p>
          {preview.job?.status === 'complete'
            ? <p className="text-sm text-foreground/75">You imported this map before. <Link className="text-keppel-300 underline" href={`/map?explore=subject:${preview.job.rootSubjectId}`}>Open it</Link></p>
            : <button type="button" onClick={() => void (preview.job ? retry() : run())} disabled={state === 'importing'} className={BUTTON_PRIMARY}>
                {state === 'importing' ? <><Loader2 className="size-4 animate-spin" /> Importing…</> : preview.job ? 'Continue the import' : 'Import into my Kivo'}
              </button>}
        </div>
      )}

      {state === 'done' && result?.ok && result.status === 'complete' && (
        <div role="status" className="mt-5 rounded-xl border border-keppel-400/30 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/85">
          <p className="font-medium text-foreground">{result.already ? 'This map is already in your Kivo.' : 'Imported.'}</p>
          <p className="mt-1">{result.counts.subjects} subjects, {result.counts.topics} topics and {result.counts.notes} notes, checked against the file. It’s yours to change.</p>
          <Link href={`/map?explore=subject:${result.rootSubjectId}`} className={cn(BUTTON_PRIMARY, 'mt-3 inline-flex')}>Open the map</Link>
        </div>
      )}
      {state === 'error' && result && !result.ok && result.jobId && <button type="button" onClick={() => void retry()} className={cn(BUTTON_QUIET, 'mt-3')}>Try again</button>}
    </section>
  )
}

const licenceName = (id: string) => LICENCES.find(([k]) => k === id)?.[1].split(' (')[0] ?? id

// ── Export ──
type Subject = { id: string; name: string; parentId?: string | null }
type ExportPreview = { ok: true; root: { id: string; name: string }; subjects: Array<{ id: string; name: string; depth: number }>; topics: number; notes: Array<{ id: string; title: string; subjectId: string | null }>; links: number }

function ExportSection() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null)
  const [rootId, setRootId] = useState('')
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set())
  const [links, setLinks] = useState(true)
  const [license, setLicense] = useState('all-rights-reserved')
  const [credit, setCredit] = useState('')
  const [busy, setBusy] = useState<'loading' | 'exporting' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/nova/subjects', { cache: 'no-store' }).then(r => r.json()).then((b: { status: string; subjects?: Subject[] }) => setSubjects(b.status === 'ready' ? b.subjects ?? [] : [])).catch(() => setSubjects([]))
  }, [])

  const load = useCallback(async (id: string) => {
    setRootId(id); setPreview(null); setNoteIds(new Set()); setMessage(null)
    if (!id) return
    setBusy('loading')
    try {
      const res = await fetch('/api/nova/portable/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', rootSubjectId: id }) })
      const body = await res.json() as ExportPreview | { ok: false; message: string }
      if (body.ok) setPreview(body); else setMessage(body.message)
    } catch { setMessage('Could not reach Kivo. Try again.') }
    setBusy(null)
  }, [])

  const download = async () => {
    if (!preview) return
    setBusy('exporting'); setMessage(null)
    try {
      const res = await fetch('/api/nova/portable/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export', rootSubjectId: preview.root.id, noteIds: [...noteIds], includeLinks: links, license, credit }) })
      if (!res.ok) { const b = await res.json().catch(() => null) as { message?: string } | null; setMessage(b?.message ?? 'The file couldn’t be made. Try again.'); setBusy(null); return }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'map.kivo'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch { setMessage('Could not reach Kivo. Try again.') }
    setBusy(null)
  }

  const tops = (subjects ?? []).filter(s => !s.parentId)
  return (
    <section aria-labelledby="export-h" className={CARD}>
      <h2 id="export-h" className="flex items-center gap-2 text-base font-semibold text-foreground"><Download aria-hidden className="size-4" /> Export a map</h2>
      <p className="mt-1 text-sm text-foreground/60">Choose a subject: it goes with every subject and topic inside it. Only the notes you tick are included; your study progress never is. Exporting changes nothing.</p>
      <label className="mt-4 block text-xs text-foreground/60" htmlFor="export-root">Subject</label>
      <select id="export-root" value={rootId} onChange={e => void load(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground sm:w-80" disabled={subjects === null}>
        <option value="">{subjects === null ? 'Loading your subjects…' : tops.length ? 'Choose a subject' : 'No subjects yet'}</option>
        {tops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {busy === 'loading' && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-foreground/70"><Loader2 className="size-4 animate-spin" /> Reading the map…</p>}
      {message && <p role="alert" className="mt-3 text-sm text-amber-200">{message}</p>}
      {preview && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-foreground/70">{preview.subjects.length} subjects · {preview.topics} topics · {preview.links} links filed here</p>
          <fieldset>
            <legend className="text-xs text-foreground/60">Notes to include ({noteIds.size} of {preview.notes.length})</legend>
            {preview.notes.length === 0 ? <p className="mt-1 text-sm text-foreground/50">No notes are filed under this map.</p> : (
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
                {preview.notes.map(n => (
                  <li key={n.id}><label className="flex items-center gap-2 text-sm text-foreground/80"><input type="checkbox" checked={noteIds.has(n.id)} onChange={e => setNoteIds(s => { const x = new Set(s); if (e.target.checked) x.add(n.id); else x.delete(n.id); return x })} /> {n.title}</label></li>
                ))}
              </ul>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-foreground/80"><input type="checkbox" checked={links} onChange={e => setLinks(e.target.checked)} /> Include the {preview.links} saved links (as a list in the map’s source note)</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-foreground/60">Licence
              <select value={license} onChange={e => setLicense(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground">
                {LICENCES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-foreground/60">Credit (optional)
              <input value={credit} onChange={e => setCredit(e.target.value)} maxLength={120} placeholder="e.g. Kivo" className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground" />
            </label>
          </div>
          <p className="text-xs text-foreground/50">Only share material you have the right to share. Images in notes are not included in this version.</p>
          <button type="button" onClick={() => void download()} disabled={busy !== null} className={BUTTON_PRIMARY}>
            {busy === 'exporting' ? <><Loader2 className="size-4 animate-spin" /> Making the file…</> : 'Download .kivo file'}
          </button>
        </div>
      )}
    </section>
  )
}

'use client'

// Import and export Knowledge Maps as .kivo files (docs/KIVO_PACKAGES.md).
// Two pages, two actions (founder review #10): /map/share and /map/import.
// Import: choose a file → Kivo checks it → preview → Import → open the map.
// Export: the whole map or one subject → a name → Download. Everything in it
// goes in by default (kivo.map/2: notes with their images and files, saved
// pages, task definitions, what each topic's plan says); what doesn't is said
// before the download. Notes, links, tasks, licence and credit are under
// "More options" (#14).
// Everything is decided on the server (packages/api/src/portable); this page
// sends the file or the choices and shows what comes back.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ACTIVE_IMPORT_KEY, followImport, STAGE_WORDS, type Followed } from './import-follow'
import { ChevronDown, Download, FileUp, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'

const CARD = 'rounded-2xl border border-white/8 bg-card/60 p-5'
// Who may pass the file on, said plainly; the licence's official name is
// kept beside it (it is what the file records). Everyone who opens a .kivo
// gets their own copy to change, so the choice is only about passing it on.
// Three choices are offered; files with the other two still open and say so.
const LICENCES: Array<[id: string, plain: string, official: string]> = [
  ['all-rights-reserved', 'Keep it for study (don’t pass it on)', 'All rights reserved'],
  ['cc-by-4.0', 'Anyone can pass it on, with credit', 'CC BY 4.0'],
  ['cc0-1.0', 'Anyone can pass it on, no credit needed', 'CC0'],
]
// How a licence on a file someone sent is named (all five a file can carry).
const LICENCE_NAMES: Record<string, string> = {
  'all-rights-reserved': 'For study only (All rights reserved)',
  'cc-by-4.0': 'Free to pass on with credit (CC BY 4.0)',
  'cc-by-sa-4.0': 'Free to pass on with credit, same licence (CC BY-SA 4.0)',
  'cc-by-nc-4.0': 'Free to pass on with credit, not for money (CC BY-NC 4.0)',
  'cc0-1.0': 'Free for anyone (CC0)',
}

type Excluded = {
  noteImages: number; privateNotes: number; archivedTopics?: number; unfiledNotes?: number; unfiledPages?: number; passages?: number
  pagesOverLimit?: number; imagesNotCarried?: number; filesNotCarried?: number; taskProgress?: true; pagePersonalState?: true
}
type Preview = {
  ok: true; packageId: string; title: string; description: string | null; creator: string | null; source: string | null; license: string; exportedAt: string | null
  format?: string
  counts: { subjects: number; topics: number; notes: number; links: number; edges: number; nestedSubjects: number; images?: number; files?: number; tasks?: number; topicDetails?: number }
  excluded: Excluded
  renames: Array<{ from: string; to: string }>; outline: Array<{ name: string; depth: number; topics: number }>
  storageBytes?: number; taskRoom?: number; copies?: number
  job: { id: string; status: string; rootSubjectId: string | null } | null
}
type Counts = { subjects: number; topics: number; notes: number; links?: number; linksAlreadySaved?: number; images?: number; files?: number; tasks?: number; topicDetails?: number }
type ImportResult = { ok: true; status: 'complete'; jobId: string; rootSubjectId: string; rootSubjectIds?: string[]; already: boolean; counts: Counts }
  | { ok: true; status: 'running'; jobId: string }
  | { ok: false; status?: string; jobId?: string; reason?: string; found?: 'map' | 'note'; message: string }

/** Bytes as people read them: "640 KB", "3.4 MB". */
export const size = (b: number) => b >= 1_000_000 ? `${(b / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1000)).toLocaleString()} KB`

/** What a map file leaves out, in words (import preview and export summary). */
export function leftOutLines(x: Excluded): string[] {
  return [
    x.noteImages ? `${plural(x.noteImages, 'image')} in notes (older file)` : null,
    x.imagesNotCarried ? `${plural(x.imagesNotCarried, 'image')} a note named but couldn’t carry` : null,
    x.filesNotCarried ? `${plural(x.filesNotCarried, 'file')} that couldn’t be carried` : null,
    x.archivedTopics ? plural(x.archivedTopics, 'archived topic') : null,
    x.unfiledNotes ? `${plural(x.unfiledNotes, 'note')} filed under no subject` : null,
    x.unfiledPages ? `${plural(x.unfiledPages, 'saved page')} filed under no subject` : null,
    x.passages ? `${plural(x.passages, 'saved passage')} (highlights from pages)` : null,
    x.pagesOverLimit ? `${plural(x.pagesOverLimit, 'saved page')} past what one file holds` : null,
    x.taskProgress ? 'whether tasks were done, and their due dates' : null,
    x.pagePersonalState ? 'reading status, collections and personal notes on saved pages' : null,
    'anyone’s progress or scores',
  ].filter((v): v is string => Boolean(v))
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

async function send(url: string, file: File): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/vnd.kivo.map+zip' }, body: file })
}

/** Where an imported map opens: inside its subject (one root), else the whole map; played as a new map (`arrive=import`). */
export function importedMapHref(rootSubjectId: string | null | undefined, rootSubjectIds?: string[]): string {
  const roots = rootSubjectIds?.length ? rootSubjectIds : rootSubjectId ? [rootSubjectId] : []
  return roots.length === 1 ? `/map?explore=${encodeURIComponent(`subject:${roots[0]}`)}&arrive=import` : '/map?arrive=import'
}

export function PortableMaps({ mode }: { mode: 'share' | 'import' }) {
  const share = mode === 'share'
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-20 pt-10 lg:pt-4" data-portable={mode}>
      <header>
        <Link href="/map" className="text-sm text-foreground/55 hover:text-foreground">← Knowledge Map</Link>
        <h1 className="mt-3 text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.2rem]">{share ? 'Share your map' : 'Import a map'}</h1>
        <p className="mt-2 max-w-prose text-sm text-foreground/60">
          {share
            ? <>Download your map as a <code>.kivo</code> file and send it to your batch. They get their own copy; your progress stays private.</>
            : <>Open a <code>.kivo</code> file a senior or friend sent you. It becomes your own copy to change as you like.</>}
        </p>
      </header>
      {share ? <ExportSection /> : <ImportSection />}
      <p className="text-sm text-foreground/55">
        {share ? <>Got a file from someone? <Link href="/map/import" className="text-keppel-300 hover:underline" data-switch-import>Import a map</Link></> : <>Want to send yours? <Link href="/map/share" className="text-keppel-300 hover:underline" data-switch-share>Share your map</Link></>}
      </p>
    </div>
  )
}

// ── Import ──
export function ImportSection() {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<'idle' | 'checking' | 'ready' | 'importing' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // The file is a single note, not a map: say where it goes.
  const [wrongKind, setWrongKind] = useState(false)

  const check = async (f: File) => {
    setFile(f); setPreview(null); setResult(null); setMessage(null); setWrongKind(false)
    if (!/\.kivo$/i.test(f.name)) { setState('error'); setMessage(/\.pdf$/i.test(f.name) ? 'That’s a PDF. Import it as a note from Notes → More → Import a note or PDF.' : 'Choose a .kivo file.'); return }
    if (f.size > 50_000_000) { setState('error'); setMessage('That file is too large for a Kivo map (50 MB at most).'); return }
    setState('checking')
    try {
      const res = await send('/api/nova/portable/import/preview', f)
      if (res.status === 401) { window.location.href = '/signin?from=/map/import'; return }
      const body = await res.json() as Preview | { ok: false; message: string; found?: 'map' | 'note' }
      if (!body.ok) { setState('error'); setMessage(body.message); setWrongKind(body.found === 'note'); return }
      setPreview(body); setState('ready')
    } catch { setState('error'); setMessage('Could not reach Kivo. Check your connection and try again.') }
  }

  const router = useRouter()
  const [stage, setStage] = useState<string | null>(null)
  const following = useRef<{ aborted: boolean } | null>(null)
  const navigated = useRef(false)
  useEffect(() => () => { if (following.current) following.current.aborted = true }, [])

  // The import's end, however it came: its result shown, then the map opened,
  // once. Ids are the server's, from this job only.
  const land = useCallback((f: Followed) => {
    try { window.sessionStorage.removeItem(ACTIVE_IMPORT_KEY) } catch { /* storage unavailable */ }
    if (f.status === 'cancelled') return
    if (f.status === 'failed') {
      setResult({ ok: false, status: 'failed', jobId: f.jobId, reason: f.fileNeeded ? 'file_needed' : 'failed', message: f.message })
      setState('error'); setMessage(f.message); return
    }
    setResult({ ok: true, status: 'complete', jobId: f.jobId, rootSubjectId: f.rootSubjectId, rootSubjectIds: f.rootSubjectIds, already: false, counts: f.counts as Counts })
    setState('done')
    if (!navigated.current) { navigated.current = true; router.push(importedMapHref(f.rootSubjectId, f.rootSubjectIds)) }
  }, [router])

  const follow = useCallback(async (jobId: string) => {
    if (following.current) following.current.aborted = true
    const signal = { aborted: false }
    following.current = signal
    setState('importing'); setMessage(null)
    try { window.sessionStorage.setItem(ACTIVE_IMPORT_KEY, jobId) } catch { /* storage unavailable */ }
    land(await followImport(jobId, { fetch: (u, i) => fetch(u, i), sleep: ms => new Promise(r => setTimeout(r, ms)), onStage: setStage, signal }))
  }, [land])

  // Back after a reload while an import ran: follow it to its end.
  useEffect(() => {
    let id: string | null = null
    try { id = window.sessionStorage.getItem(ACTIVE_IMPORT_KEY) } catch { /* storage unavailable */ }
    if (id) void follow(id)
  }, [follow])

  const run = async (copy = false) => {
    if (!file) return
    setState('importing'); setMessage(null); setStage(null)
    try {
      const res = await send(`/api/nova/portable/import${copy ? '?copy=1' : ''}`, file)
      const body = await res.json() as ImportResult
      if (body.ok && body.status === 'complete') { land({ status: 'complete', jobId: body.jobId, rootSubjectId: body.rootSubjectId, rootSubjectIds: body.rootSubjectIds ?? [body.rootSubjectId], counts: body.counts }); if (body.already) setResult(body); return }
      if (body.ok && body.status === 'running') { await follow(body.jobId); return }
      setResult(body); setState('error'); setMessage(body.message)
    } catch {
      // The upload's answer was lost: an import it started is still found by its job.
      const id = (() => { try { return window.sessionStorage.getItem(ACTIVE_IMPORT_KEY) } catch { return null } })()
      if (id) { await follow(id); return }
      setState('error'); setMessage('The connection dropped. Nothing is lost: import the same file again and it continues where it stopped.')
    }
  }

  const retry = async () => {
    const jobId = result && 'jobId' in result ? result.jobId : preview?.job?.id
    // The same file finishes it (its images and files are read from the file).
    if (!jobId || file) return run()
    setState('importing'); setMessage(null)
    try {
      const res = await fetch(`/api/nova/portable/import/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json() as ImportResult
      if (body.ok && body.status === 'complete') { land({ status: 'complete', jobId: body.jobId, rootSubjectId: body.rootSubjectId, rootSubjectIds: body.rootSubjectIds ?? [body.rootSubjectId], counts: body.counts }); return }
      if (body.ok && body.status === 'running') { await follow(body.jobId); return }
      setResult(body); setState('error'); setMessage(body.message)
    } catch { setState('error'); setMessage('Could not reach Kivo. Try again.') }
  }

  return (
    <section aria-labelledby="import-h" className={CARD}>
      <h2 id="import-h" className="flex items-center gap-2 text-base font-semibold text-foreground"><FileUp aria-hidden className="size-4" /> Choose the file</h2>
      <p className="mt-1 text-sm text-foreground/60">You’ll see what’s inside before anything is added.</p>
      <input ref={input} type="file" accept=".kivo" className="sr-only" aria-label="Choose a .kivo file" onChange={e => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = '' }} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} disabled={state === 'checking' || state === 'importing'} className={BUTTON_QUIET}>
          <Upload className="size-3.5" /> {file ? 'Choose a different file' : 'Choose a .kivo file'}
        </button>
        {file && <span className="text-xs text-foreground/55">{file.name} · {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB</span>}
      </div>

      {state === 'importing' && !preview && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-foreground/70" data-import-following><Loader2 className="size-4 animate-spin" /> {(stage && STAGE_WORDS[stage]) ?? 'Finishing your import…'}</p>}
      {state === 'checking' && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-foreground/70"><Loader2 className="size-4 animate-spin" /> Looking inside the file…</p>}
      {message && <p role="alert" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/8 px-3 py-2 text-sm text-foreground/85">{message}{wrongKind && <> <Link href="/notes/import" className="font-medium text-keppel-300 underline" data-open-note-import>Import it as a note</Link></>}</p>}

      {preview && state !== 'done' && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-lg font-semibold text-foreground">{preview.title}</p>
            {preview.description && <p className="mt-1 text-sm text-foreground/65">{preview.description}</p>}
            <p className="mt-1 text-xs text-foreground/50">{[preview.creator && `By ${preview.creator}`, preview.source, preview.exportedAt && `Exported ${new Date(preview.exportedAt).toLocaleDateString()}`, licenceName(preview.license)].filter(Boolean).join(' · ')}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {([['Subjects', preview.counts.subjects], ['Topics', preview.counts.topics], ['Notes', preview.counts.notes], ['Saved pages', preview.counts.links],
              ...(preview.counts.images || preview.counts.files ? [['Images & files', (preview.counts.images ?? 0) + (preview.counts.files ?? 0)] as const] : []),
              ...(preview.counts.tasks ? [['Tasks', preview.counts.tasks] as const] : [])] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/6 px-3 py-2"><dt className="text-[11px] text-foreground/50">{k}</dt><dd className="text-base font-semibold tabular-nums text-foreground">{v.toLocaleString()}</dd></div>
            ))}
          </dl>
          <details className="text-sm">
            <summary className="cursor-pointer text-foreground/70">See every subject inside</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-foreground/70">
              {preview.outline.map((s, i) => <li key={i} style={{ paddingLeft: `${(s.depth - 1) * 16}px` }}>{s.name} <span className="text-foreground/40">· {s.topics} topics</span></li>)}
            </ul>
          </details>
          {preview.renames.length > 0 && <p className="text-xs text-foreground/60">You already have {preview.renames.length === 1 ? 'a subject' : 'subjects'} with {preview.renames.length === 1 ? 'this name' : 'these names'}, so the new one will be called {preview.renames.map(r => `“${r.to}”`).join(', ')}. Yours stays exactly as it is.</p>}
          {preview.storageBytes ? <p className="text-xs text-foreground/60" data-import-storage>Its images and files use {size(preview.storageBytes)} of your storage.</p> : null}
          {preview.counts.topicDetails ? <p className="text-xs text-foreground/60">{plural(preview.counts.topicDetails, 'topic')} come{preview.counts.topicDetails === 1 ? 's' : ''} with an explanation from the plan.</p> : null}
          {preview.counts.tasks && preview.taskRoom !== undefined && preview.counts.tasks > preview.taskRoom
            ? <p className="text-xs text-amber-200/90">This map has {plural(preview.counts.tasks, 'task')}; you have room for {preview.taskRoom} more open tasks. Finish or remove some first.</p> : null}
          <p className="text-xs text-foreground/50" data-import-left-out>Not included: {leftOutLines(preview.excluded).join('; ')}.</p>
          {preview.job?.status === 'complete'
            ? <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/75">You’ve already added this map. <Link className="text-keppel-300 underline" href={importedMapHref(preview.job.rootSubjectId)}>Open it</Link>
                <button type="button" onClick={() => void run(true)} disabled={state === 'importing'} className="text-foreground/60 underline hover:text-foreground" data-import-copy>Add another copy</button></p>
            : <button type="button" onClick={() => void (preview.job ? retry() : run())} disabled={state === 'importing'} className={BUTTON_PRIMARY}>
                {state === 'importing' ? <><Loader2 className="size-4 animate-spin" /> {(stage && STAGE_WORDS[stage]) ?? 'Adding to your Kivo…'}</> : preview.job ? 'Finish adding it' : 'Add to my Kivo'}
              </button>}
        </div>
      )}

      {state === 'done' && result?.ok && result.status === 'complete' && (
        <div role="status" className="mt-5 rounded-xl border border-keppel-400/30 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/85">
          <p className="font-medium text-foreground">{result.already ? 'This map is already in your Kivo.' : 'Added to your Kivo. Opening it…'}</p>
          <p className="mt-1">{[plural(result.counts.subjects, 'subject'), plural(result.counts.topics, 'topic'), plural(result.counts.notes, 'note'),
            result.counts.images ? plural(result.counts.images, 'image') : null, result.counts.files ? plural(result.counts.files, 'file') : null,
            result.counts.links ? `${plural(result.counts.links, 'saved page')}` : null, result.counts.tasks ? plural(result.counts.tasks, 'task') : null].filter(Boolean).join(', ')}. It’s your copy now, so change anything you like.</p>
          {result.counts.linksAlreadySaved ? <p className="mt-1 text-foreground/65">{plural(result.counts.linksAlreadySaved, 'link')} you’d already saved stayed where you filed {result.counts.linksAlreadySaved === 1 ? 'it' : 'them'}.</p> : null}
          <Link href={importedMapHref(result.rootSubjectId, result.rootSubjectIds)} className={cn(BUTTON_PRIMARY, 'mt-3 inline-flex')} data-open-imported>Open the map</Link>
        </div>
      )}
      {state === 'error' && result && !result.ok && result.jobId && <button type="button" onClick={() => void retry()} className={cn(BUTTON_QUIET, 'mt-3')}>Try again</button>}
    </section>
  )
}

const licenceName = (id: string) => LICENCE_NAMES[id] ?? id

// ── Export ──
type Subject = { id: string; name: string; parentId?: string | null }
type ExportPreview = {
  ok: true; scope?: 'subject' | 'map'; root: { id: string; name: string }; roots?: Array<{ id: string; name: string }>
  subjects: Array<{ id: string; name: string; depth: number }>; topics: number; notes: Array<{ id: string; title: string; subjectId: string | null; images?: number; files?: number }>; links: number; linksLeftOut?: number
  topicDetails?: number; images?: number; files?: number; storageBytes?: number; tasks?: number
  leftOut?: { archivedTopics: number; unfiledNotes: number; unfiledPages: number; passages: number; notesOverLimit: number; tasksOverLimit: number; tooLarge: boolean }
  limits?: { resources: number; notes: number; assetBytes: number }
}
const WHOLE_MAP = 'map'

function ExportSection() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null)
  // What to share: the whole map (default) or one top-level subject.
  const [rootId, setRootId] = useState(WHOLE_MAP)
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set())
  const [links, setLinks] = useState(true)
  const [tasks, setTasks] = useState(true)
  const [license, setLicense] = useState('all-rights-reserved')
  const [credit, setCredit] = useState('')
  // The file's name, and the map's title when someone opens it.
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const [busy, setBusy] = useState<'loading' | 'exporting' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/nova/subjects', { cache: 'no-store' }).then(r => r.json()).then((b: { status: string; subjects?: Subject[] }) => setSubjects(b.status === 'ready' ? b.subjects ?? [] : [])).catch(() => setSubjects([]))
  }, [])

  const load = useCallback(async (id: string) => {
    setRootId(id); setPreview(null); setNoteIds(new Set()); setMessage(null); setDone(null)
    if (!named) setName(id === WHOLE_MAP ? 'My Knowledge Map' : (subjects ?? []).find(s => s.id === id)?.name ?? '')
    if (!id) return
    setBusy('loading')
    try {
      const res = await fetch('/api/nova/portable/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', rootSubjectId: id }) })
      const body = await res.json() as ExportPreview | { ok: false; message: string }
      // Everything is in by default: every note ticked.
      if (body.ok) { setPreview(body); setNoteIds(new Set(body.notes.map(n => n.id))) } else setMessage(body.message)
    } catch { setMessage('Could not reach Kivo. Try again.') }
    setBusy(null)
  }, [subjects, named])

  const tops = (subjects ?? []).filter(s => !s.parentId)
  // Opens on the whole map once the subjects are known.
  const started = useRef(false)
  useEffect(() => { if (subjects && tops.length && !started.current) { started.current = true; void load(WHOLE_MAP) } }, [subjects, tops.length, load])

  const fileName = `${name.trim().replace(/\.kivo$/i, '') || preview?.root.name || 'map'}.kivo`
  const download = async () => {
    if (!preview) return
    setBusy('exporting'); setMessage(null)
    try {
      const res = await fetch('/api/nova/portable/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export', rootSubjectId: rootId, noteIds: allNotes ? undefined : [...noteIds], includeLinks: links, includeTasks: tasks, license, credit, title: name.trim() || undefined }) })
      if (!res.ok) { const b = await res.json().catch(() => null) as { message?: string } | null; setMessage(b?.message ?? 'The file couldn’t be made. Try again.'); setBusy(null); return }
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') ?? ''
      const exact = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1]
      const saved = exact ? decodeURIComponent(exact) : /filename="([^"]+)"/.exec(cd)?.[1] ?? fileName
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = saved; a.click()
      setMessage(null); setDone(saved)
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch { setMessage('Could not reach Kivo. Try again.') }
    setBusy(null)
  }

  const whole = rootId === WHOLE_MAP
  // Every note ticked: the server takes every note in the scope (no list sent).
  const allNotes = !!preview && noteIds.size === preview.notes.length
  const chosen = preview ? preview.notes.filter(n => noteIds.has(n.id)) : []
  const media = chosen.reduce((m, n) => ({ images: m.images + (n.images ?? 0), files: m.files + (n.files ?? 0) }), { images: 0, files: 0 })
  const choice = (on: boolean) => cn('rounded-lg px-3 py-1.5 text-sm transition-colors', on ? 'bg-white/10 font-medium text-foreground' : 'text-foreground/65 hover:text-foreground')
  return (
    <section aria-labelledby="export-h" className={CARD}>
      <h2 id="export-h" className="sr-only">Share your map</h2>
      {subjects !== null && tops.length === 0 ? (
        <p className="text-sm text-foreground/60">Add a subject on your <Link href="/map" className="underline">Knowledge Map</Link> first, then share it from here.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs text-foreground/60" id="export-what">What to share</p>
            <div role="radiogroup" aria-labelledby="export-what" className="mt-1.5 inline-flex rounded-xl border border-white/10 p-1">
              <button type="button" role="radio" aria-checked={whole} onClick={() => void load(WHOLE_MAP)} className={choice(whole)} data-export-whole>Whole map</button>
              <button type="button" role="radio" aria-checked={!whole} onClick={() => void load(tops[0]?.id ?? '')} disabled={!tops.length} className={choice(!whole)} data-export-one>One subject</button>
            </div>
            {!whole && (
              <select aria-label="Which subject" value={rootId} onChange={e => void load(e.target.value)} className="mt-2 block w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground sm:w-80" data-export-root>
                {tops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          {busy === 'loading' && <p role="status" className="flex items-center gap-2 text-sm text-foreground/70"><Loader2 className="size-4 animate-spin" /> Getting your map ready…</p>}
          {preview && (
            <p className="text-sm text-foreground/70" data-export-summary>
              {[whole && preview.roots ? plural(preview.roots.length, 'top-level subject') : null, plural(preview.subjects.length, 'subject'), plural(preview.topics, 'topic'),
                noteIds.size ? plural(noteIds.size, 'note') : null, media.images ? plural(media.images, 'image') : null, media.files ? plural(media.files, 'file') : null,
                links && preview.links ? plural(preview.links, 'saved page') : null, tasks && preview.tasks ? plural(preview.tasks, 'task') : null].filter(Boolean).join(' · ')}
              {allNotes && preview.storageBytes ? <span className="text-foreground/50"> · {size(preview.storageBytes)}</span> : null}
            </p>
          )}
          {preview?.leftOut && (
            <p className="text-xs text-foreground/50" data-export-left-out>
              Not included: {leftOutLines({ noteImages: 0, privateNotes: 0, archivedTopics: preview.leftOut.archivedTopics, unfiledNotes: preview.leftOut.unfiledNotes, unfiledPages: preview.leftOut.unfiledPages, passages: preview.leftOut.passages, pagesOverLimit: preview.linksLeftOut, taskProgress: true, pagePersonalState: true }).join('; ')}.
            </p>
          )}
          {preview?.leftOut?.tooLarge && <p role="alert" className="text-sm text-amber-200">The images and files in this map are more than one file can hold ({preview.limits ? size(preview.limits.assetBytes) : '40 MB'}). Share one subject at a time, or untick some notes.</p>}
          {preview?.leftOut?.notesOverLimit ? <p role="alert" className="text-sm text-amber-200">This map has more notes than one file holds. Share one subject at a time.</p> : null}

          <label className="block text-xs text-foreground/60" htmlFor="export-name">File name
            <span className="mt-1 flex items-center rounded-xl border border-white/10 bg-background focus-within:border-keppel-400/60">
              <input id="export-name" value={name} onChange={e => { setName(e.target.value); setNamed(true) }} maxLength={80} placeholder="e.g. 1st year knowledge roadmap"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none" data-export-name />
              <span className="pr-3 text-sm text-foreground/45">.kivo</span>
            </span>
            <span className="mt-1 block text-[11px] text-foreground/45">This is also the map’s name when someone opens it.</span>
          </label>

          {preview && (
            <details className="group rounded-xl border border-white/8 px-3 py-2" data-export-more>
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-foreground/75">
                <span>More options <span className="text-foreground/45">· notes, saved pages, tasks, licence, credit</span></span>
                <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-4 pb-1">
                <fieldset>
                  <legend className="flex w-full items-center justify-between text-xs text-foreground/60">
                    <span>Notes · {noteIds.size} of {preview.notes.length}</span>
                    {preview.notes.length > 1 && (
                      <button type="button" onClick={() => setNoteIds(noteIds.size === preview.notes.length ? new Set() : new Set(preview.notes.map(n => n.id)))} className="text-keppel-300 hover:underline" data-export-all-notes>
                        {noteIds.size === preview.notes.length ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </legend>
                  {preview.notes.length === 0 ? <p className="mt-1 text-sm text-foreground/50">No notes here yet.</p> : (
                    <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
                      {preview.notes.map(n => (
                        <li key={n.id}><label className="flex items-center gap-2 text-sm text-foreground/80"><input type="checkbox" checked={noteIds.has(n.id)} onChange={e => setNoteIds(s => { const x = new Set(s); if (e.target.checked) x.add(n.id); else x.delete(n.id); return x })} /> {n.title}</label></li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-[11px] text-foreground/45">Every note on this part of your map is included, with its images and files. Kivo has no private-note setting, so untick anything you’d rather keep to yourself.</p>
                </fieldset>
                {preview.links > 0 && (
                  <label className="flex items-center gap-2 text-sm text-foreground/80"><input type="checkbox" checked={links} onChange={e => setLinks(e.target.checked)} data-export-links /> Include my {plural(preview.links, 'saved link')}</label>
                )}
                {preview.linksLeftOut ? <p className="text-[11px] text-amber-200/90">A file holds up to {(preview.limits?.resources ?? 2000).toLocaleString()} saved pages, so {plural(preview.linksLeftOut, 'page')} won’t be included. Share one subject at a time to include them all.</p> : null}
                {preview.tasks ? (
                  <label className="flex items-center gap-2 text-sm text-foreground/80"><input type="checkbox" checked={tasks} onChange={e => setTasks(e.target.checked)} data-export-tasks /> Include {plural(preview.tasks, 'task')} (what to do, not whether you did it)</label>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-foreground/60">Can others pass it on?
                    <select value={license} onChange={e => setLicense(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground" data-export-licence>
                      {LICENCES.map(([k, plain, official]) => <option key={k} value={k}>{plain} ({official})</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-foreground/60">Made by (optional)
                    <input value={credit} onChange={e => setCredit(e.target.value)} maxLength={120} placeholder="e.g. Bennett CSE, 2nd year" className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground" />
                  </label>
                </div>
              </div>
            </details>
          )}

          {message && <p role="alert" className="text-sm text-amber-200">{message}</p>}
          <button type="button" onClick={() => void download()} disabled={busy !== null || !preview} className={BUTTON_PRIMARY} data-export-download>
            {busy === 'exporting' ? <><Loader2 className="size-4 animate-spin" /> Making your file…</> : <><Download className="size-4" /> Download {fileName}</>}
          </button>
          {done && <p role="status" className="text-sm text-keppel-300" data-export-done>Downloaded <span className="font-medium">{done}</span>. Send it to your batch; they open it with Import on their Knowledge Map.</p>}
        </div>
      )}
    </section>
  )
}

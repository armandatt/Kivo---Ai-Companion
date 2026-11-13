'use client'

// Drafts: what the learner captured while reading, before deciding where it
// belongs (docs/CAPTURE_FIRST.md). One draft per reading session; its passages
// are shown under the page each came from, and can be edited, annotated,
// reordered or removed. Organising happens only here, at the end: Create note
// or Add to note, each after a preview of exactly what the note will hold.
// Nothing is written to a note before the learner confirms.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, Check, ExternalLink, FilePlus2, Inbox, Loader2, NotebookPen, Pencil, Search, Trash2, Undo2, X } from 'lucide-react'
import type { NoteSubjectOption, NoteSummary } from '@repo/api/nova/product/notes.types'
import { sourceGroups } from '@repo/api/nova/product/capture-draft-rules'
import { PageFrame, PageHeader } from '@/components/dashboard/page-states'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { DestinationPicker } from './destination-picker'
import { NO_SUBJECT, type Destination } from './note-destinations'
import { NoteBody } from './note-body'
import { fetchNotes } from './notes-api'
import {
  discardDraft, editDraft, fetchDraft, fetchDrafts, mergeDraft, restoreDraft, today,
  type CaptureItem, type DraftDetail, type DraftEdit, type DraftSummary, type MergePreview, type MergeTarget,
} from './drafts-api'

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
const counts = (d: { passages: number; sources: number }) =>
  `${d.passages} passage${d.passages === 1 ? '' : 's'}${d.sources ? ` from ${d.sources} page${d.sources === 1 ? '' : 's'}` : ''}`

type Notice = { text: string; undo?: () => void; tone?: 'error' } | null

export function NoteDrafts() {
  const router = useRouter()
  const params = useSearchParams()
  const chosen = params.get('d')
  const [list, setList] = useState<DraftSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const load = useCallback(async () => {
    const res = await fetchDrafts()
    if (!res.ok) { setLoadError(res.message); return }
    setLoadError(null); setList(res.drafts)
  }, [])
  useEffect(() => { void load() }, [load])

  const open = (id: string | null) => router.replace(id ? `/notes/drafts?d=${encodeURIComponent(id)}` : '/notes/drafts', { scroll: false })
  // With none chosen on a wide screen, the newest is shown.
  const selected = chosen ?? (list && list.length && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches ? list[0]!.id : null)

  return (
    <PageFrame width="wide">
      <PageHeader
        eyebrow={<Link href="/notes" className="hover:text-foreground">Notes</Link>}
        title="Drafts"
        description="Passages you captured while reading. Organise them into notes when you're ready."
      />

      {loadError && !list && (
        <div role="alert" className="mt-6 rounded-xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">{loadError} <button type="button" onClick={() => void load()} className="ml-2 underline">Try again</button></div>
      )}
      {!list && !loadError && <div className="mt-8 h-40 animate-pulse rounded-xl bg-white/3" aria-label="Loading your drafts" />}

      {list && list.length === 0 && !chosen && (
        <section className="mt-10 max-w-xl rounded-2xl border border-white/8 bg-card/40 px-6 py-8" data-drafts-empty>
          <Inbox aria-hidden className="size-6 text-subtle" />
          <h2 className="mt-3 text-base font-semibold text-foreground">Nothing waiting</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">
            While you read, select a passage and press <strong>Capture</strong> in the Nova extension. Passages from one sitting collect here in one draft, each with the page it came from, until you put them in a note.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/saved" className={BUTTON_QUIET}>Get the extension</Link>
            <Link href="/notes/capture" className={BUTTON_QUIET}>Paste a passage</Link>
          </div>
        </section>
      )}

      {list && (list.length > 0 || chosen) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="Your drafts" className={cn('space-y-1', selected && 'max-lg:hidden')} data-drafts-list>
            {list.map(d => (
              <button key={d.id} type="button" onClick={() => open(d.id)} aria-current={d.id === selected ? 'true' : undefined}
                className={cn('block w-full rounded-xl px-3 py-2.5 text-left transition-colors', d.id === selected ? 'bg-white/7' : 'hover:bg-white/4')} data-draft-row={d.id}>
                <span className="line-clamp-2 text-sm font-medium text-foreground">{d.title}</span>
                <span className="mt-0.5 block text-xs text-subtle">{counts(d)} · {ago(d.lastCaptureAt)}</span>
              </button>
            ))}
          </nav>
          {selected && (
            <DraftReview key={selected} id={selected} onBack={() => open(null)}
              onChanged={() => void load()}
              // Keep this draft named in the address, so its "In your note" answer
              // stays on screen when the list it came from is now empty.
              onMerged={() => { if (!chosen) open(selected); void load() }}
              onGone={async (summary, how) => {
                await load()
                open(null)
                if (how === 'discarded') setNotice({ text: `Discarded “${summary.title}”.`, undo: async () => { setNotice(null); const r = await restoreDraft(summary.id); if (r.ok) { await load(); open(summary.id) } else setNotice({ text: r.message, tone: 'error' }) } })
              }}
              onNotice={setNotice} />
          )}
        </div>
      )}

      {notice && (
        <div role="status" className="fixed bottom-6 left-1/2 z-40 flex w-max max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-background px-4 py-2.5 text-sm text-foreground/85 shadow-float" data-drafts-notice>
          <span className={notice.tone === 'error' ? 'text-amber-200' : ''}>{notice.text}</span>
          {notice.undo && <button type="button" onClick={notice.undo} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-drafts-undo><Undo2 className="size-3.5" /> Undo</button>}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-subtle hover:text-foreground"><X className="size-3.5" /></button>
        </div>
      )}
    </PageFrame>
  )
}

// ── One draft ────────────────────────────────────────────────────────────────

function DraftReview({ id, onBack, onChanged, onMerged, onGone, onNotice }: {
  id: string
  onBack: () => void
  onChanged: () => void
  onMerged: () => void
  onGone: (summary: DraftSummary, how: 'discarded' | 'merged') => void
  onNotice: (n: Notice) => void
}) {
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [merging, setMerging] = useState<'new' | 'existing' | null>(null)
  const [done, setDone] = useState<{ noteId: string; noteTitle: string } | null>(null)
  const latest = useRef<DraftDetail | null>(null)

  const load = useCallback(async () => {
    const res = await fetchDraft(id)
    if (!res.ok) { setError(res.message); return }
    latest.current = res.draft; setDraft(res.draft); setError(null)
  }, [id])
  useEffect(() => { void load() }, [load])

  // Edits go on the version on screen. If a capture arrived meanwhile, the
  // server answers with the draft as it now is and the same edits are sent
  // again on that (an edit naming a passage that is gone changes nothing).
  const apply = useCallback(async (edits: DraftEdit[]) => {
    const base = latest.current
    if (!base) return false
    setSaving(true)
    let res = await editDraft(id, base.version, edits)
    if (!res.ok && res.error === 'conflict' && res.draft) res = await editDraft(id, res.draft.version, edits)
    setSaving(false)
    if (!res.ok) { onNotice({ text: res.message, tone: 'error' }); if (res.draft) { latest.current = res.draft; setDraft(res.draft) } return false }
    latest.current = res.draft; setDraft(res.draft); onChanged()
    return true
  }, [id, onChanged, onNotice])

  if (error) return <div role="alert" className="rounded-xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">{error} <button type="button" onClick={onBack} className="ml-2 underline">Back to drafts</button></div>
  if (!draft) return <div className="h-64 animate-pulse rounded-2xl bg-white/3" aria-label="Loading the draft" />

  if (done) {
    return (
      <section className="rounded-2xl border border-nova/25 bg-nova/[0.05] px-6 py-6" role="status" data-draft-merged>
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Check aria-hidden className="size-4 text-nova-ink" /> In your note “{done.noteTitle}”</p>
        <p className="mt-1 text-sm text-foreground/65">Each passage kept the page it came from. The draft is done.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/notes/${encodeURIComponent(done.noteId)}`} className={BUTTON_PRIMARY} data-open-merged-note><NotebookPen className="size-4" /> Open the note</Link>
          <button type="button" onClick={onBack} className={BUTTON_QUIET}>Back to drafts</button>
        </div>
      </section>
    )
  }

  const groups = sourceGroups(draft.items)
  const move = (item: CaptureItem, dir: -1 | 1) => {
    // Within its own page: to the place of the passage before or after it from that page.
    const sameSource = draft.items.filter(i => i.url === item.url)
    const at = sameSource.findIndex(i => i.id === item.id)
    const other = sameSource[at + dir]
    if (!other) return
    void apply([{ op: 'move', id: item.id, to: draft.items.findIndex(i => i.id === other.id) }])
  }

  return (
    <article className="min-w-0" aria-labelledby="draft-title" data-draft={draft.id}>
      <button type="button" onClick={onBack} className="mb-3 text-xs text-subtle hover:text-foreground lg:hidden">← All drafts</button>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-white/8 pb-4">
        <div className="min-w-0 basis-full">
          <TitleField draft={draft} onRename={title => void apply([{ op: 'rename', title }])} />
          <p className="mt-1 text-xs text-subtle" data-draft-counts>
            {counts(draft)} · captured {ago(draft.lastCaptureAt)}{saving && <span className="ml-2 inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setMerging('new')} disabled={!draft.items.length} className={BUTTON_PRIMARY} data-merge-new><FilePlus2 className="size-4" /> Create note</button>
          <button type="button" onClick={() => setMerging('existing')} disabled={!draft.items.length} className={cn(BUTTON_QUIET, 'h-10 text-sm')} data-merge-existing><NotebookPen className="size-4" /> Add to note</button>
          <button type="button" onClick={async () => { const r = await discardDraft(draft.id); if (r.ok) onGone(draft, 'discarded'); else onNotice({ text: r.message, tone: 'error' }) }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-foreground/60 hover:bg-white/5 hover:text-foreground" data-draft-discard>
            <Trash2 className="size-4" /> Discard
          </button>
        </div>
      </header>

      {merging && (
        <MergePanel draft={draft} mode={merging} onMode={setMerging} onClose={() => setMerging(null)}
          onDone={r => { setDone(r); setMerging(null); onMerged() }} onStale={() => void load()} />
      )}

      {draft.items.length === 0 && <p className="mt-6 text-sm text-foreground/60">This draft is empty. Capture a passage, or discard it.</p>}

      <div className="mt-5 space-y-8">
        {groups.map(g => (
          <section key={g.url ?? 'own'} aria-label={g.title} data-draft-source={g.url ?? 'own'}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 text-sm font-semibold text-foreground"><span className="line-clamp-2">{g.title}</span></h3>
              {g.url && (
                <a href={g.url} target="_blank" rel="noopener noreferrer" title={g.url} className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground/60 hover:text-foreground" data-open-source>
                  {g.site} <ExternalLink aria-hidden className="size-3" />
                </a>
              )}
            </div>
            <ol className="mt-2.5 space-y-3">
              {g.items.map((item, n) => (
                <Passage key={item.id} item={item} first={n === 0} last={n === g.items.length - 1}
                  onEdit={(text, note) => apply([{ op: 'edit', id: item.id, ...(text !== undefined ? { text } : {}), ...(note !== undefined ? { note } : {}) }])}
                  onMove={dir => move(item, dir)}
                  onRemove={() => void apply([{ op: 'remove', id: item.id }])} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </article>
  )
}

function TitleField({ draft, onRename }: { draft: DraftDetail; onRename: (title: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null)
  const shown = value ?? (draft.named ? draft.title : '')
  return (
    <label className="block">
      <span className="sr-only">Draft name</span>
      <input id="draft-title" value={shown} placeholder={draft.title} maxLength={120}
        onChange={e => setValue(e.target.value)}
        onBlur={() => { if (value !== null && value.trim() !== (draft.named ? draft.title : '')) onRename(value.trim() || null); setValue(null) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setValue(null); e.currentTarget.blur() } }}
        className="w-full text-ellipsis rounded-md bg-transparent font-serif text-2xl font-semibold tracking-tight text-foreground placeholder:text-foreground/80 focus:bg-white/4 focus:outline-none focus:ring-1 focus:ring-white/15" data-draft-title />
    </label>
  )
}

function Passage({ item, first, last, onEdit, onMove, onRemove }: {
  item: CaptureItem; first: boolean; last: boolean
  onEdit: (text?: string, note?: string) => Promise<boolean>
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [note, setNote] = useState(item.note)
  useEffect(() => { setNote(item.note) }, [item.note])
  useEffect(() => { if (!editing) setText(item.text) }, [item.text, editing])
  const icon = 'grid size-8 place-items-center rounded-md text-foreground/50 transition-colors hover:bg-white/6 hover:text-foreground disabled:opacity-30'

  return (
    <li className="group rounded-xl border border-white/8 bg-card/50 px-4 py-3" data-draft-item={item.id}>
      {editing ? (
        <div>
          <label className="sr-only" htmlFor={`text-${item.id}`}>Passage</label>
          <textarea id={`text-${item.id}`} value={text} onChange={e => setText(e.target.value)} rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
            className="w-full rounded-lg border border-white/12 bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground focus:border-nova/50 focus:outline-none" data-passage-input />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={async () => { if (await onEdit(text, undefined)) setEditing(false) }} className={cn(BUTTON_QUIET, 'border-nova/40 text-nova-ink')} data-passage-save>Save passage</button>
            <button type="button" onClick={() => { setText(item.text); setEditing(false) }} className={BUTTON_QUIET}>Cancel</button>
          </div>
        </div>
      ) : item.text ? (
        <blockquote className="whitespace-pre-wrap border-l-2 border-[var(--sem-source,theme(colors.sky.400))]/50 pl-3 text-sm leading-relaxed text-foreground/85" data-passage-text>{item.text}</blockquote>
      ) : (
        <p className="text-sm text-foreground/60">The page itself, with no passage selected.</p>
      )}

      <label className="mt-2 block">
        <span className="sr-only">Your thoughts on this passage</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add your thoughts (optional)" rows={note ? Math.min(8, note.split('\n').length + 1) : 1}
          onBlur={() => { if (note.trim() !== item.note) void onEdit(undefined, note.trim()) }}
          className="w-full resize-none rounded-lg bg-transparent px-0 py-1 text-sm leading-relaxed text-foreground/80 placeholder:text-foreground/35 focus:bg-white/3 focus:px-2 focus:outline-none" data-passage-note />
      </label>

      <div className="mt-1 flex items-center gap-0.5">
        <span className="mr-auto text-[11px] text-subtle">{new Date(item.capturedAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
        {!editing && item.text && <button type="button" onClick={() => setEditing(true)} className={icon} aria-label="Edit passage" title="Edit passage" data-passage-edit><Pencil className="size-3.5" /></button>}
        <button type="button" onClick={() => onMove(-1)} disabled={first} className={icon} aria-label="Move up" title="Move up" data-passage-up><ArrowUp className="size-3.5" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={last} className={icon} aria-label="Move down" title="Move down" data-passage-down><ArrowDown className="size-3.5" /></button>
        <button type="button" onClick={onRemove} className={icon} aria-label="Remove passage" title="Remove passage" data-passage-remove><Trash2 className="size-3.5" /></button>
      </div>
    </li>
  )
}

// ── Into a note: choose, preview, confirm ────────────────────────────────────

function MergePanel({ draft, mode, onMode, onClose, onDone, onStale }: {
  draft: DraftDetail
  mode: 'new' | 'existing'
  onMode: (m: 'new' | 'existing') => void
  onClose: () => void
  onDone: (r: { noteId: string; noteTitle: string }) => void
  onStale: () => void
}) {
  const [subjects, setSubjects] = useState<NoteSubjectOption[]>([])
  const [title, setTitle] = useState(draft.title)
  const [dest, setDest] = useState<Destination>(NO_SUBJECT)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NoteSummary[]>([])
  const [target, setTarget] = useState<NoteSummary | null>(null)
  const [preview, setPreview] = useState<{ plan: MergePreview; version: number; target: MergeTarget } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pressed = useRef(false)

  useEffect(() => { void fetchNotes().then(v => { if (v?.status === 'ready') setSubjects(v.subjects) }) }, [])
  useEffect(() => {
    if (mode !== 'existing') return
    const t = window.setTimeout(() => { void fetchNotes(query.trim() ? { q: query.trim() } : {}).then(v => setResults(v?.status === 'ready' ? v.notes.slice(0, 8) : [])) }, 220)
    return () => window.clearTimeout(t)
  }, [mode, query])
  useEffect(() => { setPreview(null); setError(null) }, [mode, target, dest, title])

  const chosenTarget: MergeTarget | null = mode === 'new'
    ? (title.trim() ? { kind: 'new', title: title.trim(), subjectId: dest.subjectId, topicName: dest.topicName } : null)
    : target ? { kind: 'existing', noteId: target.id } : null

  async function show() {
    if (!chosenTarget) return
    setBusy(true); setError(null)
    const res = await mergeDraft(draft.id, { target: chosenTarget, version: draft.version, day: today(), preview: true })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    if (res.preview) setPreview({ plan: res, version: draft.version, target: chosenTarget })
  }
  async function confirm() {
    if (!preview || pressed.current) return
    pressed.current = true; setBusy(true); setError(null)
    const res = await mergeDraft(draft.id, { target: preview.target, version: preview.version, day: today() })
    setBusy(false); pressed.current = false
    if (!res.ok) { setError(res.message); if (res.error === 'conflict') { setPreview(null); onStale() } return }
    if (!res.preview) onDone({ noteId: res.noteId, noteTitle: res.noteTitle })
  }

  const tab = (m: 'new' | 'existing', label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)}
      className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', mode === m ? 'bg-white/10 text-foreground' : 'text-foreground/60 hover:text-foreground')}>{label}</button>
  )

  return (
    <section className="mt-4 rounded-2xl border border-white/10 bg-card/70 p-4 sm:p-5" aria-label="Put this draft in a note" data-merge-panel={mode}>
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-lg bg-white/4 p-0.5">{tab('new', 'Create note')}{tab('existing', 'Add to note')}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-subtle hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
      </div>

      {!preview && mode === 'new' && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-foreground/70">Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
              className="mt-1 h-10 w-full rounded-lg border border-white/12 bg-background/60 px-3 text-sm text-foreground focus:border-nova/50 focus:outline-none" data-merge-title />
          </label>
          <div>
            <span className="text-xs font-medium text-foreground/70">Where it goes <span className="font-normal text-subtle">(optional)</span></span>
            <div className="mt-1"><DestinationPicker subjects={subjects} value={dest} onChange={setDest}
              onSubjectsChanged={async () => { const v = await fetchNotes(); if (v?.status === 'ready') { setSubjects(v.subjects); return v.subjects } return null }} /></div>
          </div>
        </div>
      )}

      {!preview && mode === 'existing' && (
        <div className="mt-4">
          <label className="relative block">
            <span className="sr-only">Find a note</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note by title or words in it" autoFocus
              className="h-10 w-full rounded-lg border border-white/12 bg-background/60 pl-9 pr-3 text-sm text-foreground focus:border-nova/50 focus:outline-none" data-merge-search />
          </label>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto" aria-label="Notes">
            {results.map(n => (
              <li key={n.id}>
                <button type="button" onClick={() => setTarget(n)} aria-pressed={target?.id === n.id}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm', target?.id === n.id ? 'bg-nova/10 text-foreground' : 'text-foreground/80 hover:bg-white/4')} data-merge-note={n.id}>
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  {target?.id === n.id && <Check aria-hidden className="size-4 text-nova-ink" />}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-sm text-subtle">No notes match.</li>}
          </ul>
        </div>
      )}

      {preview && (
        <div className="mt-4" data-merge-preview>
          <p className="text-sm text-foreground/80">
            {preview.target.kind === 'new'
              ? <>A new note, <strong className="text-foreground">{preview.plan.noteTitle}</strong>, holding:</>
              : <>Added to <strong className="text-foreground">{preview.plan.noteTitle}</strong>. Everything already in it stays as it is.</>}
          </p>
          {preview.plan.joined.length > 0 && (
            <p className="mt-1 text-xs text-foreground/60">Passages from {preview.plan.joined.map(t => `“${t}”`).join(', ')} join the section the note already has for {preview.plan.joined.length === 1 ? 'it' : 'them'}.</p>
          )}
          {preview.plan.added && (
            <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-xl border border-white/8 bg-background/50 px-4 py-3">
              {preview.target.kind === 'existing' && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">At the end of the note</p>}
              <NoteBody body={preview.plan.added} links={[]} compact />
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!preview
          ? <button type="button" onClick={() => void show()} disabled={!chosenTarget || busy} className={BUTTON_PRIMARY} data-merge-preview-button>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Preview</button>
          : <>
              <button type="button" onClick={() => void confirm()} disabled={busy} className={BUTTON_PRIMARY} data-merge-confirm>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {preview.target.kind === 'new' ? 'Create note' : 'Add to this note'}</button>
              <button type="button" onClick={() => setPreview(null)} className={BUTTON_QUIET}>Change</button>
            </>}
      </div>
    </section>
  )
}

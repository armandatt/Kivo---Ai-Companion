'use client'

// Import a research paper (⌘P / Ctrl+P on Notes, or the Import paper button).
// The learner pastes a link; the page reads what kind of link it is at once
// (paper-source.ts, nothing sent), then asks the server what importing would
// bring in (details, abstract, how much text), shows it for review with
// where it will be saved, and imports it as one note when they confirm.
// Every state is shown as it is: finding it, ready to review, importing,
// imported (in full, or in part, said so), or what went wrong, with Try again.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, ExternalLink, FileText, FileUp, Loader2, RotateCcw, Search, X } from 'lucide-react'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { NOTE_TITLE_MAX } from '@repo/api/nova/product/notes.types'
import type { PaperImported, PaperPreview } from '@repo/api/nova/product/paper.types'
import { PAPER_TRANSCRIPT_MAX } from '@repo/api/nova/product/paper.types'
import { identifyPaper, type PaperKind, type PaperTextStatus } from '@repo/api/nova/product/paper-source'
import { trappedTabTarget } from '@/components/settings/dialog-focus'
import { DestinationPicker } from './destination-picker'
import { NO_SUBJECT, destinationFor, destinationLabel, destinationsOf, type Destination } from './note-destinations'
import { importPaper, previewPaper } from './paper-api'
import { transcribeFile } from './tutor-api'

const SOURCE: Record<PaperKind, string> = {
  arxiv: 'arXiv', doi: 'the DOI (Crossref)', semantic_scholar: 'Semantic Scholar', openreview: 'OpenReview',
  pubmed: 'PubMed (Europe PMC)', pmc: 'PubMed Central (Europe PMC)', pdf: 'the PDF link', page: 'the page',
}
export const STATUS_LABEL: Record<PaperTextStatus, string> = {
  full: 'Full text', partial: 'Part of the text', abstract: 'Abstract only', details: 'Details only',
}
const STATUS_TONE: Record<PaperTextStatus, string> = {
  full: 'border-[color:var(--sem-takeaway)]/40 text-[color:var(--sem-takeaway-ink)]',
  partial: 'border-[color:var(--sem-warning)]/40 text-[color:var(--sem-warning-ink)]',
  abstract: 'border-[color:var(--sem-warning)]/40 text-[color:var(--sem-warning-ink)]',
  details: 'border-white/20 text-foreground/70',
}

type Stage =
  | { at: 'url' }
  | { at: 'finding'; kind: PaperKind }
  | { at: 'review'; preview: PaperPreview }
  | { at: 'importing'; preview: PaperPreview; reading: boolean }
  | { at: 'done'; result: PaperImported; where: string }
  | { at: 'failed'; message: string; back: 'url' | PaperPreview }

export function StatusBadge({ status }: { status: PaperTextStatus }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`} data-paper-status={status}>{STATUS_LABEL[status]}</span>
}

export function PaperImportDialog({ subjects, initial, onClose, onSubjectsChanged, onImported }: {
  subjects: NoteSubjectOption[]
  // Where to save it to start with (the note or subject open behind the dialog).
  initial?: { subjectId: string | null; topicName: string | null }
  onClose: () => void
  onSubjectsChanged: () => Promise<NoteSubjectOption[] | null>
  onImported?: (result: PaperImported) => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const openRef = useRef<HTMLAnchorElement>(null)
  const controller = useRef<AbortController | null>(null)
  const [url, setUrl] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>({ at: 'url' })
  const [title, setTitle] = useState('')
  const [transcribe, setTranscribe] = useState(false)
  const [upload, setUpload] = useState<{ fileName: string; text: string; complete: boolean; pages: number | null } | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const all = useMemo(() => destinationsOf(subjects), [subjects])
  const [destination, setDestination] = useState<Destination>(() => destinationFor(destinationsOf(subjects), initial?.subjectId ?? null, initial?.topicName ?? null))

  // Open: the link field; close: back to where focus was. Esc closes from
  // anywhere while it is open, wherever focus happens to be.
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    urlInput.current?.focus()
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeRef.current() } }
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('keydown', onEsc); controller.current?.abort(); opener?.focus?.() }
  }, [])
  useEffect(() => { if (stage.at === 'done') window.setTimeout(() => openRef.current?.focus(), 30) }, [stage.at])

  async function find() {
    const id = identifyPaper(url)
    if (!id.ok) { setHint(id.message); return }
    setHint(null); setUpload(null); setTranscribe(false)
    controller.current?.abort()
    const c = new AbortController(); controller.current = c
    setStage({ at: 'finding', kind: id.paper.kind })
    const res = await previewPaper(url.trim(), c.signal)
    if (c.signal.aborted) return
    if (!res.ok) { setStage({ at: 'failed', message: res.message, back: 'url' }); return }
    setTitle(res.title)
    setStage({ at: 'review', preview: res })
  }

  async function readUpload(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setReading(null); setHint('Choose a PDF file.'); return }
    setReading(`Nova is reading ${file.name}…`)
    const res = await transcribeFile(file)
    if (!res.ok) { setReading(null); setHint(res.message); return }
    if (res.text.length > PAPER_TRANSCRIPT_MAX) { setReading(null); setHint('That PDF’s text is longer than a note holds. Upload fewer pages.'); return }
    setReading(null); setHint(null); setTranscribe(false)
    setUpload({ fileName: res.fileName, text: res.text, complete: res.complete, pages: res.pages })
  }

  async function confirm(preview: PaperPreview) {
    const c = new AbortController(); controller.current = c
    setStage({ at: 'importing', preview, reading: transcribe && !upload })
    const res = await importPaper({
      url: url.trim(), subjectId: destination.subjectId, topicName: destination.topicName,
      title: title.trim() && title.trim() !== preview.title ? title.trim() : undefined,
      transcribe: transcribe && !upload ? true : undefined,
      transcript: upload ?? undefined,
    }, c.signal)
    if (c.signal.aborted) return
    if (!res.ok) { setStage({ at: 'failed', message: res.message, back: preview }); return }
    setStage({ at: 'done', result: res, where: destinationLabel(destination) })
    onImported?.(res)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && dialog.current) {
      const stops = Array.from(dialog.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), a[href], summary, [role="combobox"]'))
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, dialog.current)
      if (target) { e.preventDefault(); target.focus() }
    }
  }

  const busy = stage.at === 'finding' || stage.at === 'importing'
  const preview = stage.at === 'review' || stage.at === 'importing' ? stage.preview : stage.at === 'failed' && stage.back !== 'url' ? stage.back : null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 py-[6vh]" onKeyDown={onKeyDown}>
      <div aria-hidden className="fixed inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="paper-import-title" tabIndex={-1}
        className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-card shadow-2xl shadow-black/40 outline-none" data-paper-import data-paper-stage={stage.at}>
        <header className="flex items-center gap-3 border-b border-white/8 px-5 py-3.5">
          <FileText className="size-4 text-[color:var(--sem-source-ink)]" aria-hidden />
          <h2 id="paper-import-title" className="flex-1 text-[15px] font-semibold text-foreground">Import research paper</h2>
          <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Close (Esc)" title="Close (Esc)"><X className="size-4" /></button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {stage.at !== 'done' && (
            <form onSubmit={e => { e.preventDefault(); void find() }}>
              <label htmlFor="paper-url" className="mb-1.5 block text-xs text-foreground/60">Paper link</label>
              <div className="flex gap-2">
                <input id="paper-url" ref={urlInput} value={url} onChange={e => { setUrl(e.target.value); setHint(null) }} readOnly={busy} aria-busy={busy}
                  placeholder="https://arxiv.org/abs/1706.03762, a DOI, PubMed, OpenReview…" inputMode="url" autoComplete="off" spellCheck={false}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-nova/60 focus:outline-none disabled:opacity-60" data-paper-url />
                <button type="submit" disabled={busy || !url.trim()} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/12 px-3.5 text-sm font-medium text-foreground/85 hover:bg-white/5 disabled:opacity-50" data-paper-find>
                  {stage.at === 'finding' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Find
                </button>
              </div>
              {hint && <p role="alert" className="mt-1.5 text-xs text-amber-200" data-paper-hint>{hint}</p>}
              {stage.at === 'url' && !hint && <p className="mt-1.5 text-[11px] text-subtle">arXiv, DOI links and publisher pages, Semantic Scholar, OpenReview, PubMed and PubMed Central, or a direct PDF. Kio brings in what is openly available, and says what that is.</p>}
            </form>
          )}

          {stage.at === 'finding' && (
            <div role="status" className="flex items-center gap-2 text-sm text-foreground/75" data-paper-finding>
              <Loader2 className="size-4 animate-spin text-nova-ink" aria-hidden /> Looking it up on {SOURCE[stage.kind]}: its details, and how much of its text is openly available…
            </div>
          )}

          {stage.at === 'failed' && (
            <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/[0.05] px-3.5 py-3 text-sm text-foreground/80" data-paper-failed>
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden /> {stage.message}</p>
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" onClick={() => (stage.back === 'url' ? void find() : void confirm(stage.back))} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline" data-paper-retry><RotateCcw className="size-3.5" /> Try again</button>
                {stage.back !== 'url' && <button type="button" onClick={() => setStage({ at: 'review', preview: stage.back as PaperPreview })} className="text-subtle hover:text-foreground">Back to the paper</button>}
              </div>
            </div>
          )}

          {preview && (
            <section className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3.5" aria-label="The paper" data-paper-preview>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={preview.status} />
                <span className="text-[11px] text-subtle">Details from {preview.detailsFrom}{preview.textFrom ? ` · text from ${preview.textFrom}` : ''}</span>
              </div>
              {preview.kind === 'pdf' || !preview.title ? (
                <div className="mt-2">
                  <label htmlFor="paper-title" className="mb-1 block text-xs text-foreground/60">Title (the PDF link gives none)</label>
                  <input id="paper-title" value={title} maxLength={NOTE_TITLE_MAX} onChange={e => setTitle(e.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-transparent px-2.5 text-sm text-foreground focus:border-nova/60 focus:outline-none" />
                </div>
              ) : (
                <h3 className="mt-2 font-serif text-lg font-semibold leading-snug text-foreground" data-paper-title>{preview.title}</h3>
              )}
              {preview.authors.length > 0 && <p className="mt-1 text-xs leading-relaxed text-foreground/70">{preview.authors.slice(0, 8).join(', ')}{preview.authors.length > 8 ? ` and ${preview.authors.length - 8} more` : ''}</p>}
              <p className="mt-1 text-xs text-subtle">
                {[preview.published, preview.venue, preview.arxivId && `arXiv ${preview.arxivId}`, preview.doi && `DOI ${preview.doi}`, preview.pmid && `PMID ${preview.pmid}`].filter(Boolean).join(' · ')}
              </p>
              <a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-[color:var(--sem-source-ink)] hover:underline"><ExternalLink className="size-3" /> Original source</a>
              {preview.abstract && (
                <details className="mt-2.5">
                  <summary className="cursor-pointer text-xs font-medium text-foreground/75">Abstract</summary>
                  <p className="mt-1.5 max-h-40 overflow-y-auto text-[13px] leading-relaxed text-foreground/75">{preview.abstract}</p>
                </details>
              )}
              {preview.sections.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs font-medium text-foreground/75">{preview.sections.length} sections · about {Math.round(preview.textChars / 1000)}k characters</summary>
                  <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs text-foreground/65 sm:grid-cols-2">{preview.sections.map((s, i) => <li key={i} className="truncate">{s}</li>)}</ul>
                </details>
              )}
              <ul className="mt-2.5 space-y-1 border-t border-white/6 pt-2.5 text-xs leading-relaxed text-foreground/70" data-paper-notes>
                {preview.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>

              {preview.existing ? (
                <p className="mt-3 rounded-lg bg-[color:var(--sem-source)]/10 px-3 py-2 text-sm text-foreground/85" data-paper-existing>
                  You already imported this paper as <Link href={`/notes/${encodeURIComponent(preview.existing.id)}`} onClick={onClose} className="font-medium text-[color:var(--sem-source-ink)] underline">{preview.existing.title}</Link>. Importing again opens that note; nothing is made twice.
                </p>
              ) : preview.status !== 'full' && (
                <div className="mt-3 space-y-2 rounded-lg border border-white/8 px-3 py-2.5 text-xs" data-paper-fulltext>
                  <p className="font-medium text-foreground/80">Bring in the text from a PDF (optional)</p>
                  {preview.canTranscribe && !upload && (
                    <label className="flex cursor-pointer items-start gap-2 text-foreground/75">
                      <input type="checkbox" className="mt-0.5 accent-[var(--nova)]" checked={transcribe} onChange={e => setTranscribe(e.target.checked)} data-paper-transcribe />
                      <span>Have Nova transcribe the paper&apos;s PDF (up to 20 pages and 3 MB; uses your Nova allowance). It is marked as Nova&apos;s transcription, to check against the original.</span>
                    </label>
                  )}
                  {upload ? (
                    <p className="flex items-center gap-1.5 text-foreground/80" data-paper-upload-ready><Check className="size-3.5 text-nova-ink" /> {upload.fileName} read by Nova{upload.pages ? `, ${upload.pages} pages` : ''}{upload.complete ? '' : ' (it stopped before the end)'}. Its text goes in the note. <button type="button" className="text-subtle underline" onClick={() => setUpload(null)}>Remove</button></p>
                  ) : (
                    <p className="text-foreground/65">
                      Or, if you have access to the paper, <button type="button" disabled={!!reading} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 font-medium text-nova-ink hover:underline disabled:opacity-50" data-paper-upload><FileUp className="size-3.5" /> upload its PDF</button>.
                      {reading && <span className="ml-1.5 inline-flex items-center gap-1 text-foreground/75"><Loader2 className="size-3 animate-spin" /> {reading}</span>}
                    </p>
                  )}
                  <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readUpload(f) }} />
                </div>
              )}
            </section>
          )}

          {preview && !preview.existing && (stage.at === 'review' || stage.at === 'failed') && (
            <DestinationPicker subjects={subjects} value={all.some(d => d.key === destination.key) ? destination : NO_SUBJECT} onChange={setDestination} onSubjectsChanged={onSubjectsChanged} />
          )}

          {stage.at === 'importing' && (
            <div role="status" className="flex items-center gap-2 text-sm text-foreground/75" data-paper-importing>
              <Loader2 className="size-4 animate-spin text-nova-ink" aria-hidden /> {stage.reading ? 'Nova is transcribing the PDF, then saving the note. This can take most of a minute…' : `Saving it to ${destinationLabel(destination)}…`}
            </div>
          )}

          {stage.at === 'done' && (
            <div role="status" className="space-y-2" data-paper-done={stage.result.status}>
              <p className="flex items-center gap-2 text-sm text-foreground">
                <Check className="size-4 text-nova-ink" aria-hidden />
                {stage.result.existing ? <>You already had <span className="font-semibold">{stage.result.title}</span>.</> : <>Imported <span className="font-semibold">{stage.result.title}</span> to {stage.where}.</>}
              </p>
              <div className="flex flex-wrap items-center gap-2 pl-6"><StatusBadge status={stage.result.status} />{stage.result.status !== 'full' && <span className="text-xs text-foreground/70">Partial import: the note says what is and isn&apos;t in it.</span>}</div>
              {stage.result.notes.length > 0 && <ul className="space-y-1 pl-6 text-xs leading-relaxed text-foreground/70">{stage.result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/8 px-5 py-3">
          {stage.at === 'done' ? (
            <>
              <button type="button" onClick={() => { setStage({ at: 'url' }); setUrl(''); setUpload(null); window.setTimeout(() => urlInput.current?.focus(), 30) }} className="h-9 rounded-xl px-3 text-sm text-subtle hover:text-foreground">Import another</button>
              <Link ref={openRef} href={`/notes/${encodeURIComponent(stage.result.noteId)}`} onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover" data-paper-open>
                Open note <ArrowRight className="size-4" />
              </Link>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="h-9 rounded-xl px-3 text-sm text-subtle hover:text-foreground">Cancel</button>
              {preview?.existing ? (
                <Link href={`/notes/${encodeURIComponent(preview.existing.id)}`} onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover">Open your note <ArrowRight className="size-4" /></Link>
              ) : (
                <button type="button" disabled={!preview || busy || !!reading || (preview.kind === 'pdf' && !title.trim())} onClick={() => preview && void confirm(preview)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-50" data-paper-confirm>
                  {stage.at === 'importing' ? <Loader2 className="size-4 animate-spin" /> : null} Import to {destination.kind === 'none' ? 'Notes' : destination.path[destination.path.length - 1]}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

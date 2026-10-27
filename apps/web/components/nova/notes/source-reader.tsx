'use client'

// The source beside a note: a paper's PDF in the browser's own PDF viewer
// (its toolbar zooms and moves between pages), or the page the note names.
// Before showing a frame it asks the server whether the source allows one
// (POST /api/nova/notes/source-frame, product/source-frame.ts): a refused
// frame stays blank in the browser without saying why, so the pane says it
// instead and offers the original in a new tab. Kivo never fetches and
// re-serves a source to get around its rules.
//
// The page keeps this mounted while it is hidden, so closing and reopening
// the pane comes back to the same place in the paper.

import { useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2, Maximize2, Minimize2, Quote, X } from 'lucide-react'
import type { NoteSource } from './note-blocks'

type Verdict = 'pdf' | 'page' | 'blocked' | 'download' | 'unreachable'

// One answer per address for this visit: reopening asks no one again.
const checked = new Map<string, Verdict>()

async function check(url: string): Promise<Verdict> {
  const known = checked.get(url)
  if (known) return known
  try {
    const res = await fetch('/api/nova/notes/source-frame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    const body = await res.json().catch(() => null) as { verdict?: Verdict } | null
    const verdict = res.ok && body?.verdict ? body.verdict : 'unreachable'
    if (res.ok) checked.set(url, verdict)
    return verdict
  } catch { return 'unreachable' }
}

const btn = 'inline-flex size-8 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-white/6 hover:text-foreground'

export function SourceReader({ source, wide, onWide, onClose }: {
  source: NoteSource
  wide: boolean
  onWide: () => void
  onClose: () => void
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [anyway, setAnyway] = useState(false)
  useEffect(() => {
    let live = true
    setVerdict(null); setAnyway(false)
    if (!source.view.startsWith('https://')) { setVerdict('unreachable'); return }
    void check(source.view).then(v => { if (live) setVerdict(v) })
    return () => { live = false }
  }, [source.view])

  const pdf = verdict === 'pdf' || (verdict !== 'page' && source.pdf)
  const showFrame = verdict === 'pdf' || verdict === 'page' || (verdict === 'unreachable' && anyway)
  const Icon = pdf ? FileText : Quote
  const kind = pdf ? 'PDF' : 'page'

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-white/6 px-3 text-xs">
        <Icon aria-hidden className="size-3.5 shrink-0 text-sky-300" />
        <span className="min-w-0 flex-1 truncate text-foreground/70" data-reader-label>{source.label}{pdf ? ' · PDF' : ''}</span>
        <button type="button" onClick={onWide} className={`${btn} max-md:hidden`} title={wide ? 'Give the note more room' : 'Give the paper more room'} aria-pressed={wide} data-reader-wide>
          {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
        <a href={source.url} target="_blank" rel="noopener noreferrer" className={btn} title="Open the original in a new tab" aria-label="Open the original in a new tab" data-reader-original><ExternalLink className="size-3.5" /></a>
        <button type="button" onClick={onClose} className={btn} title="Close (Esc). It stays where you left it." aria-label="Close the reader" data-reader-close><X className="size-3.5" /></button>
      </div>

      {verdict === null && (
        <div className="grid flex-1 place-items-center text-xs text-subtle" role="status" data-reader-state="checking">
          <span className="inline-flex items-center gap-2"><Loader2 aria-hidden className="size-4 animate-spin" /> Opening the {kind}…</span>
        </div>
      )}

      {showFrame && (
        <>
          {/* A web page is sandboxed: it can't navigate this tab or open
              dialogs. A PDF can't be: the browser's PDF viewer does not run in
              a sandboxed frame. Either way it is another site's page, which
              cannot read this one. */}
          <iframe key={source.view} src={source.view} title={`Source: ${source.label}`} className="min-h-0 w-full flex-1 bg-white"
            sandbox={pdf ? undefined : 'allow-scripts allow-same-origin allow-popups allow-forms'} referrerPolicy="no-referrer" data-reader-frame={verdict ?? 'unknown'} />
          <p className="shrink-0 border-t border-white/6 px-3 py-1.5 text-[11px] text-foreground/45">
            {pdf ? 'Zoom and move between pages with the viewer’s own toolbar. ' : ''}If this stays blank, <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-keppel-300 underline">open it in a new tab</a>.
          </p>
        </>
      )}

      {verdict !== null && !showFrame && (
        <div className="flex flex-1 flex-col items-start gap-3 overflow-y-auto px-5 py-6 text-sm leading-relaxed text-foreground/75" role="status" data-reader-state={verdict}>
          <p className="font-medium text-foreground">
            {verdict === 'blocked' ? `${source.label} doesn’t allow its ${kind} to be shown inside another site.`
              : verdict === 'download' ? `${source.label} sends this as a file to download, so it can’t be shown here.`
              : `Kivo couldn’t check whether ${source.label} can be shown here.`}
          </p>
          <p className="text-xs text-foreground/60">
            {verdict === 'unreachable'
              ? 'The source may need a sign-in, may be checking for robots, or may be unavailable right now.'
              : 'That is the source’s own setting, and Kivo doesn’t get around it.'}
            {' '}Your note stays here; the original opens in a new tab.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-reader-open-original>
              <ExternalLink aria-hidden className="size-3.5" /> Open the original
            </a>
            {verdict === 'unreachable' && <button type="button" onClick={() => setAnyway(true)} className="inline-flex h-9 items-center rounded-lg border border-white/12 px-3 text-xs text-foreground/80 hover:bg-white/5" data-reader-try>Try showing it here</button>}
          </div>
        </div>
      )}
    </>
  )
}

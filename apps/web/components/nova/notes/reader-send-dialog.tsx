'use client'

// Where a passage or a capture from the PDF goes: this note, another of the
// learner's notes, or a new one. Shown first (the quote, or the image with
// its caption), sent once, and said to be added only when the save came back.
// A retry after a failure sends the same thing again; what is already in the
// note is not added twice, a stored image is not stored twice (its key), and
// a new note made on the first try is not made again.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, FilePlus2, FileText, Loader2, NotebookPen, Search, X } from 'lucide-react'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import { imageMarkdown } from './note-blocks'
import { captureCaption, quoteMarkdown } from './pdf-geometry'
import type { Taken } from './pdf-reader'
import { appendToNote, newEmptyNote, newNoteWith, uploadImage, type SendResult } from './reader-send'

export type AddToCurrent = (markdown: string, label: string) => Promise<{ ok: true; saved: boolean; already?: boolean } | { ok: false; message: string }>

type Target = 'current' | 'other' | 'new'

export function ReaderSendDialog({ taken, doc, current, notes, onAddToCurrent, onClose }: {
  taken: Taken
  doc: { title: string; url: string }
  current: { id: string; title: string } | null
  notes: NoteSummary[]
  onAddToCurrent: AddToCurrent
  onClose: () => void
}) {
  const [target, setTarget] = useState<Target>(current ? 'current' : notes.length ? 'other' : 'new')
  const [otherId, setOtherId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [newTitle, setNewTitle] = useState(`Notes on ${doc.title}`.slice(0, 200))
  const [caption, setCaption] = useState(taken.kind === 'image' ? captureCaption(doc, taken.capture.page, taken.capture.region) : '')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; title: string; noteId: string; saved: boolean; already?: boolean } | { kind: 'error'; message: string }>({ kind: 'idle' })
  // A note made for this on an earlier try, so a retry fills it instead of making another.
  const made = useRef<{ id: string; title: string } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => { dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus() }, [])
  useEffect(() => () => { if (taken.kind === 'image') URL.revokeObjectURL(taken.capture.url) }, [taken])

  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes.filter(n => n.id !== current?.id && (!q || n.title.toLowerCase().includes(q) || (n.subjectName ?? '').toLowerCase().includes(q))).slice(0, 40)
  }, [notes, current, query])
  const page = taken.kind === 'passage' ? taken.page : taken.capture.page
  const label = taken.kind === 'passage' ? `Quote, p. ${page}` : caption || 'Capture'

  async function markdownFor(noteId: string): Promise<{ ok: true; md: string } | { ok: false; message: string }> {
    if (taken.kind === 'passage') return { ok: true, md: quoteMarkdown(taken.text, doc, page) }
    const up = await uploadImage({ noteId, blob: taken.capture.blob, clientKey: `${taken.capture.key}:${noteId}`.slice(0, 80), sourceUrl: doc.url, sourceTitle: doc.title, page })
    return up.ok ? { ok: true, md: `${imageMarkdown(caption.trim() || captureCaption(doc, page, taken.capture.region), up.id)}\n\n*${doc.url.split('#')[0]}#page=${page}*` } : up
  }

  async function send() {
    if (state.kind === 'sending') return
    setState({ kind: 'sending' })
    let result: SendResult & { saved?: boolean }
    if (target === 'current' && current) {
      const md = await markdownFor(current.id)
      if (!md.ok) { setState({ kind: 'error', message: md.message }); return }
      const r = await onAddToCurrent(md.md, label)
      result = r.ok ? { ok: true, noteId: current.id, title: current.title, already: r.already, saved: r.saved } : r
    } else if (target === 'other') {
      if (!otherId) { setState({ kind: 'error', message: 'Choose a note to add it to.' }); return }
      const md = await markdownFor(otherId)
      result = md.ok ? await appendToNote(otherId, md.md, label) : md
    } else {
      if (taken.kind === 'passage') result = made.current ? await appendToNote(made.current.id, quoteMarkdown(taken.text, doc, page), label) : await newNoteWith(newTitle, quoteMarkdown(taken.text, doc, page))
      else {
        // An image needs its note first: made once, then filled.
        if (!made.current) {
          const n = await newEmptyNote(newTitle)
          if (!n.ok) { setState({ kind: 'error', message: n.message }); return }
          made.current = { id: n.noteId, title: n.title }
        }
        const md = await markdownFor(made.current.id)
        result = md.ok ? await appendToNote(made.current.id, md.md, label) : md
      }
      if (result.ok) made.current = { id: result.noteId, title: result.title }
    }
    setState(result.ok ? { kind: 'done', title: result.title, noteId: result.noteId, saved: result.saved ?? true, already: result.already } : { kind: 'error', message: result.message })
  }

  const option = (t: Target, title: string, hint: string, icon: React.ReactNode, disabled = false) => (
    <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${target === t ? 'border-action/50 bg-action/[0.06]' : 'border-white/8 hover:bg-white/[0.03]'} ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      <input type="radio" name="reader-target" className="sr-only" checked={target === t} onChange={() => setTarget(t)} disabled={disabled} data-target={t} />
      <span className="mt-0.5 text-subtle">{icon}</span>
      <span className="min-w-0"><span className="block font-medium text-foreground">{title}</span><span className="block truncate text-xs text-subtle">{hint}</span></span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="reader-send-title" data-reader-send
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Close" onClick={onClose} />
      <div ref={dialog} className="relative flex max-h-[min(44rem,92vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-float">
        <header className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
          <NotebookPen className="size-4 text-action-ink" aria-hidden />
          <h2 id="reader-send-title" className="text-sm font-semibold text-foreground">{taken.kind === 'passage' ? 'Add this passage to a note' : taken.capture.region ? 'Add this region to a note' : `Add page ${page} to a note`}</h2>
          <button type="button" onClick={onClose} className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Close"><X className="size-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {taken.kind === 'passage' ? (
            <blockquote className="sem-frame sem-source rounded-r-xl border-l-[3px] px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground/85" data-send-preview>
              <span className="mb-1 block text-[11px] font-semibold text-sky-300">{doc.title} · p. {page}</span>
              <span className="line-clamp-6">{taken.text}</span>
            </blockquote>
          ) : (
            <figure data-send-preview>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the capture, never fetched */}
              <img src={taken.capture.url} alt="The capture" className="max-h-64 w-full rounded-lg border border-white/10 bg-white object-contain" />
              <figcaption className="mt-1 text-[11px] text-subtle">{taken.capture.width} × {taken.capture.height} pixels, drawn from the PDF</figcaption>
              <label className="mt-3 block text-xs text-foreground/60">Caption
                <input value={caption} onChange={e => setCaption(e.target.value)} maxLength={200} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-foreground focus:border-action/60 focus:outline-none" data-send-caption />
              </label>
            </figure>
          )}

          <fieldset className="space-y-2" disabled={state.kind === 'sending' || state.kind === 'done'}>
            <legend className="mb-2 text-xs text-foreground/60">Add it to</legend>
            {current && option('current', 'This note', current.title, <FileText className="size-4" />)}
            {option('other', 'Another note', otherId ? notes.find(n => n.id === otherId)?.title ?? 'Choose one' : 'Choose one of your notes', <Search className="size-4" />, others.length === 0 && !query)}
            {target === 'other' && (
              <div className="rounded-xl border border-white/8">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note…" aria-label="Find a note" data-autofocus
                  className="h-9 w-full border-b border-white/8 bg-transparent px-3 text-sm text-foreground placeholder:text-subtle focus:outline-none" />
                <ul role="listbox" aria-label="Your notes" className="max-h-40 overflow-y-auto p-1">
                  {others.length === 0 && <li className="px-2.5 py-2 text-xs text-subtle">No note by that name.</li>}
                  {others.map(n => (
                    <li key={n.id} role="option" aria-selected={otherId === n.id} onClick={() => setOtherId(n.id)} data-send-note={n.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${otherId === n.id ? 'bg-action/12 text-foreground' : 'text-foreground/80 hover:bg-white/5'}`}>
                      <span className="min-w-0 flex-1 truncate">{n.title}</span>{n.subjectName && <span className="shrink-0 text-[11px] text-subtle">{n.subjectName}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {option('new', 'A new note', 'Starts a note with it', <FilePlus2 className="size-4" />)}
            {target === 'new' && (
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={200} aria-label="The new note's title" data-send-new-title
                className="h-9 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-foreground focus:border-action/60 focus:outline-none" />
            )}
          </fieldset>
          <p className="text-[11px] leading-relaxed text-subtle">
            {taken.kind === 'passage'
              ? 'It goes in as a quote from the paper, with the page and a link back to it, apart from your own writing. In a paper’s note it goes under My notes.'
              : 'The image is kept with that note and shown only to you. The PDF itself isn’t stored.'}
          </p>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-white/6 px-4 py-3" role="status" data-send-state={state.kind}>
          {state.kind === 'done' ? (
            <>
              <Check className="size-4 text-action-ink" aria-hidden />
              <span className="min-w-0 flex-1 text-sm text-foreground/85">
                {state.already ? `Already in “${state.title}”. Nothing was added twice.` : state.saved ? `Added to “${state.title}” and saved.` : `Added to “${state.title}”. Not saved yet: it’s in the editor.`}
              </span>
              {(target !== 'current') && <Link href={`/notes/${encodeURIComponent(state.noteId)}`} className="text-sm text-keppel-300 hover:underline">Open it</Link>}
              <button type="button" onClick={onClose} className="h-9 rounded-lg border border-white/12 px-3 text-sm text-foreground/80 hover:bg-white/5" data-autofocus>Done</button>
            </>
          ) : (
            <>
              {state.kind === 'error' && <span role="alert" className="min-w-0 flex-1 text-xs text-red-300">{state.message}</span>}
              <span className="flex-1" />
              <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm text-foreground/70 hover:text-foreground">{taken.kind === 'image' ? 'Discard' : 'Cancel'}</button>
              <button type="button" onClick={() => void send()} disabled={state.kind === 'sending' || (target === 'other' && !otherId)} data-send-confirm data-autofocus={target === 'current' ? '' : undefined}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-50">
                {state.kind === 'sending' ? <><Loader2 className="size-4 animate-spin" /> Adding…</> : state.kind === 'error' ? 'Try again' : 'Add to note'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

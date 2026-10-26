'use client'

// Before anything from Nova goes into a note: the text as it will appear,
// where it will go, and a button to add it. Nothing in the note is replaced;
// the addition goes in on a line of its own, and the learner can undo it.

import { useEffect, useRef } from 'react'
import { FilePlus2, X } from 'lucide-react'
import { NoteBody } from './note-body'

export interface PendingInsert {
  label:    string
  markdown: string
  // A new title, instead of text (Organise's suggestion).
  title?:   { from: string; to: string }
}

export function InsertPreview({ pending, canPlaceAtCursor, onConfirm, onCancel }: {
  pending: PendingInsert
  canPlaceAtCursor: boolean
  onConfirm: (where: 'end' | 'cursor') => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { confirmRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="insert-title" data-insert-preview>
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Cancel" onClick={onCancel} />
      <div className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-t-2xl border border-white/10 bg-background shadow-float sm:rounded-2xl">
        <header className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
          <h2 id="insert-title" className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{pending.title ? 'Change the title?' : `Add to your note: ${pending.label}`}</h2>
          <button type="button" onClick={onCancel} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Cancel"><X className="size-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {pending.title ? (
            <div className="space-y-2 text-sm">
              <p className="text-subtle line-through">{pending.title.from || 'Untitled'}</p>
              <p className="font-medium text-foreground">{pending.title.to}</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs leading-relaxed text-subtle">This is added on its own lines, marked as Nova&apos;s. Nothing you wrote is changed, and you can undo it.</p>
              <div className="rounded-xl border border-white/8 px-3 py-2"><NoteBody body={pending.markdown} links={[]} compact /></div>
            </>
          )}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-white/6 px-4 py-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 hover:bg-white/5">Cancel</button>
          {!pending.title && canPlaceAtCursor && (
            <button type="button" onClick={() => onConfirm('cursor')} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 hover:bg-white/5" data-insert-cursor>
              Add where my cursor is
            </button>
          )}
          <button ref={confirmRef} type="button" onClick={() => onConfirm('end')} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover" data-insert-confirm>
            <FilePlus2 className="size-4" /> {pending.title ? 'Use this title' : 'Add at the end'}
          </button>
        </footer>
      </div>
    </div>
  )
}

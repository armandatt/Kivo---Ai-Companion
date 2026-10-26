'use client'

// Before anything from Nova goes into a note: the text as it will appear,
// where it will go, and a button to add it. Nothing in the note is replaced;
// the addition goes in on lines of its own, and the learner can undo it.
//
// Where it goes is worked out from the note's structure (note-outline.ts
// placementFor): under the section it is about, after the passage chosen, a
// summary where a summary belongs. When that is not clear the places to
// choose from are shown first; the end of the note is one of them, never
// the default.

import { useEffect, useRef, useState } from 'react'
import { FilePlus2, MapPin, X } from 'lucide-react'
import type { Placement } from '@repo/api/nova/product/note-outline'
import { NoteBody } from './note-body'

export interface PendingInsert {
  label:    string
  markdown: string
  // A new title, instead of text (Organise's suggestion).
  title?:   { from: string; to: string }
  // Where it would go, and the other places.
  place?:   { best: Placement; clear: boolean; options: Placement[] }
  // The place could not be found when it was confirmed: chosen again.
  moved?:   boolean
}

export type InsertWhere = Placement | 'cursor'

export function InsertPreview({ pending, canPlaceAtCursor, onConfirm, onCancel }: {
  pending: PendingInsert
  canPlaceAtCursor: boolean
  onConfirm: (where: InsertWhere) => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const options = pending.place?.options ?? []
  const [chosen, setChosen] = useState<number | 'cursor'>(0)
  const [choosing, setChoosing] = useState(pending.place ? !pending.place.clear || !!pending.moved : false)
  useEffect(() => { confirmRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const where = chosen === 'cursor' ? 'Where your cursor is' : options[chosen]?.label ?? 'At the end of the note'
  const confirm = () => onConfirm(chosen === 'cursor' ? 'cursor' : options[chosen] ?? { how: 'end', anchor: null, heading: null, label: 'At the end of the note' })

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
              {pending.place && (
                <div className="mb-3" data-insert-where>
                  {pending.moved && <p role="alert" className="mb-2 text-xs text-amber-300">The place it was going has changed in your note since. Choose where it goes.</p>}
                  {!choosing ? (
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <MapPin className="size-3.5 shrink-0 text-nova-ink" aria-hidden />
                      <span className="font-medium text-foreground" data-insert-place>{where}</span>
                      <button type="button" onClick={() => setChoosing(true)} className="text-xs font-medium text-nova-ink hover:underline" data-insert-change>Change</button>
                    </p>
                  ) : (
                    <fieldset>
                      <legend className="mb-1.5 text-xs font-medium text-foreground/80">{pending.place.clear ? 'Where should it go?' : 'Where should it go? Nova isn’t sure, so choose.'}</legend>
                      <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-white/8 p-1" data-insert-options>
                        {options.map((o, i) => (
                          <label key={`${o.how}-${o.label}-${i}`} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${chosen === i ? 'bg-nova/10 text-foreground' : 'text-foreground/75 hover:bg-white/4'}`}>
                            <input type="radio" name="insert-where" className="accent-[var(--nova)]" checked={chosen === i} onChange={() => setChosen(i)} />
                            {o.label}{i === 0 && pending.place!.clear && <span className="text-[11px] text-subtle">suggested</span>}
                          </label>
                        ))}
                        {canPlaceAtCursor && (
                          <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${chosen === 'cursor' ? 'bg-nova/10 text-foreground' : 'text-foreground/75 hover:bg-white/4'}`}>
                            <input type="radio" name="insert-where" className="accent-[var(--nova)]" checked={chosen === 'cursor'} onChange={() => setChosen('cursor')} data-insert-cursor />
                            Where your cursor is
                          </label>
                        )}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}
              <p className="mb-2 text-xs leading-relaxed text-subtle">It goes in on its own lines, marked as Nova&apos;s. Nothing you wrote is changed, and you can undo it.</p>
              {/* Proposed text: set apart from the note in Nova's colour. */}
              <div className="rounded-lg border-l-2 border-nova/50 bg-nova/[0.04] px-3 py-2" data-insert-proposed><NoteBody body={pending.markdown} links={[]} compact /></div>
            </>
          )}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-white/6 px-4 py-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 hover:bg-white/5">Cancel</button>
          <button ref={confirmRef} type="button" onClick={confirm} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover" data-insert-confirm>
            <FilePlus2 className="size-4" /> {pending.title ? 'Use this title' : 'Add it here'}
          </button>
        </footer>
      </div>
    </div>
  )
}

'use client'

// The editor's one button for colour (note-colors.ts): words in a colour, or
// highlighted in one, or colour taken off. A small menu rather than fourteen
// toolbar buttons. Each swatch is named by its role ("Amber: important
// points"), so nothing depends on telling colours apart, and it is drawn with
// the same classes the note uses (.ink-*, .hl-*), so what is picked is what
// the note shows, in either theme.

import { useEffect, useId, useRef, useState } from 'react'
import { Eraser, Palette } from 'lucide-react'
import { NOTE_COLORS, NOTE_COLOR_INFO, type NoteColor } from '@repo/api/nova/product/note-colors'

export function ColorMenu({ onPick, onClear, disabled, buttonClass }: {
  onPick: (color: NoteColor, highlight: boolean) => void
  onClear: () => void
  disabled?: boolean
  buttonClass: string
}) {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('button')?.focus()
    const away = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !toggle.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => { setOpen(false); toggle.current?.focus() }
  // Arrow keys move along the swatches; the editor keeps its own keys.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const all = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? NOTE_COLORS.length : -NOTE_COLORS.length
    all[Math.max(0, Math.min(all.length - 1, at + step))]?.focus()
    e.preventDefault()
  }
  const pick = (color: NoteColor, highlight: boolean) => { onPick(color, highlight); setOpen(false) }

  return (
    <span className="relative inline-flex">
      <button ref={toggle} type="button" disabled={disabled} onClick={() => setOpen(o => !o)} className={buttonClass}
        title="Colour and highlight" aria-label="Colour and highlight" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} data-note-color-menu>
        <Palette className="size-4" />
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label="Colour and highlight" onKeyDown={onKey}
          className="absolute right-0 top-10 z-30 w-[17.5rem] rounded-xl border border-white/10 bg-card p-3 shadow-float" data-note-color-panel>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">Text colour</p>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {NOTE_COLORS.map(c => (
              <button key={c} type="button" onClick={() => pick(c, false)} title={`${NOTE_COLOR_INFO[c].label}: ${NOTE_COLOR_INFO[c].use}`} aria-label={`Text colour ${NOTE_COLOR_INFO[c].label}: ${NOTE_COLOR_INFO[c].use}`}
                className={`ink-${c} grid h-8 place-items-center rounded-lg border border-white/8 font-serif text-[15px] font-semibold hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--ring)]`} data-swatch={c}>A</button>
            ))}
          </div>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">Highlight</p>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {NOTE_COLORS.map(c => (
              <button key={c} type="button" onClick={() => pick(c, true)} title={`${NOTE_COLOR_INFO[c].label} highlight: ${NOTE_COLOR_INFO[c].use}`} aria-label={`Highlight ${NOTE_COLOR_INFO[c].label}: ${NOTE_COLOR_INFO[c].use}`}
                className="grid h-8 place-items-center rounded-lg border border-white/8 hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--ring)]" data-swatch-hl={c}>
                <span className={`note-hl hl-${c} text-[13px] font-medium text-foreground`}>ab</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { onClear(); setOpen(false) }} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 text-xs text-foreground/80 hover:bg-white/5" data-note-color-clear>
            <Eraser className="size-3.5" aria-hidden /> Clear colour
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">Colours keep their meaning across notes. Use them sparingly.</p>
        </div>
      )}
    </span>
  )
}

'use client'

// Nova beside a note has two jobs, and the learner chooses which:
//   Tutor   teaches from the note and never changes it;
//   Editor  proposes changes to the note, applied only when approved.
// One switch, in the panel's header. Both stay mounted, so switching keeps
// each conversation where it was, and both read the same note.

import { BookOpen, PenLine } from 'lucide-react'
import { KivoMark } from '@/components/brand/kivo-brand'

export type NovaMode = 'tutor' | 'editor'

export function ModeSwitch({ mode, onMode }: { mode: NovaMode; onMode: (m: NovaMode) => void }) {
  const tabs: Array<{ id: NovaMode; label: string; icon: typeof BookOpen; hint: string }> = [
    { id: 'tutor', label: 'Tutor', icon: BookOpen, hint: 'Learn from this note. Nova explains and never changes it.' },
    { id: 'editor', label: 'Editor', icon: PenLine, hint: 'Improve this note. Nova proposes changes; you approve them.' },
  ]
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = mode === 'tutor' ? 'editor' : 'tutor'
    onMode(next)
    document.getElementById(`nova-mode-${next}`)?.focus()
  }
  return (
    <div role="tablist" aria-label="What Nova does" onKeyDown={onKey} className="inline-flex rounded-lg bg-white/[0.04] p-0.5 text-xs" data-nova-modes>
      {tabs.map(t => (
        <button key={t.id} id={`nova-mode-${t.id}`} type="button" role="tab" aria-selected={mode === t.id} tabIndex={mode === t.id ? 0 : -1} title={t.hint}
          onClick={() => onMode(t.id)}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${mode === t.id ? 'bg-background text-foreground shadow-sm' : 'text-foreground/55 hover:text-foreground'}`}
          data-nova-mode={t.id}>
          <t.icon className="size-3.5" aria-hidden /> {t.label}
        </button>
      ))}
    </div>
  )
}

// Nova's mark: still when idle, a slow ring while working.
export function Identity({ working }: { working: boolean }) {
  return (
    <span aria-hidden className="relative grid size-7 shrink-0 place-items-center rounded-full bg-nova/12 ring-1 ring-nova/30">
      {working && <span className="absolute inset-0 rounded-full ring-2 ring-nova/40 kivo-node-pulse" />}
      <KivoMark size={14} className="text-nova-ink" />
    </span>
  )
}

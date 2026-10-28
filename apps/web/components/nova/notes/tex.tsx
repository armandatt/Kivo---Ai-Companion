'use client'

// One equation in a note, drawn by KaTeX (math.ts) over the LaTeX the learner
// wrote, which stays the note's text: editing shows it as typed. What can't
// be drawn is shown as written, marked, with KaTeX's reason.

import { AlertTriangle } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { drawTex } from './math'

export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const drawn = drawTex(tex, display)
  if (drawn.ok) {
    return display
      ? <span className="note-katex-display block overflow-x-auto overflow-y-hidden py-1" data-note-math="drawn" dangerouslySetInnerHTML={{ __html: drawn.html }} />
      : <span className="note-katex" data-note-math="drawn" dangerouslySetInnerHTML={{ __html: drawn.html }} />
  }
  if (display) {
    return (
      <span className="block rounded-lg border border-amber-300/25 bg-amber-300/[0.04] px-3 py-2" data-note-math="error">
        <span className="flex items-center gap-1.5 font-sans text-[11px] font-medium text-amber-200/90"><AlertTriangle aria-hidden className="size-3.5" /> This equation couldn&apos;t be drawn: {drawn.error} The LaTeX is kept as written.</span>
        <code className="mt-1 block whitespace-pre-wrap font-mono text-[13px] text-foreground/85">{tex}</code>
      </span>
    )
  }
  return (
    <code className="rounded bg-amber-300/10 px-1 font-mono text-[0.86em] text-amber-100 underline decoration-amber-300/60 decoration-wavy underline-offset-2" title={`This LaTeX couldn't be drawn: ${drawn.error}`} data-note-math="error">
      {tex}<span className="sr-only"> (couldn&apos;t be drawn: {drawn.error})</span>
    </code>
  )
}

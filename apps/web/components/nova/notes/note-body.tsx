'use client'

// A note, drawn for reading. The text is the learner's and is shown as they
// wrote it; note-blocks.ts says which marks mean what (headings, lists,
// quotes, callouts, ==highlights==, #tags, [[links]], web addresses).
// Everything is built as React elements: nothing in a note is ever treated as
// HTML, so a note cannot run code or change the page.

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import {
  AlertTriangle, BookOpen, BookOpenText, ChevronRight, ExternalLink, FileText, FlaskConical, HelpCircle, KeyRound, Lightbulb, ListChecks, NotebookPen, Quote,
} from 'lucide-react'
import { linkKey, tokenizeLine } from '@repo/api/nova/product/note-links'
import type { NoteLinkRef } from '@repo/api/nova/product/notes.types'
import { PAPER_STATUS_WORDS, paperRegion, readPaperCard, type PaperCard } from '@repo/api/nova/product/paper-source'
import { inlineTokens, parseBlocks, type Block, type CalloutType } from './note-blocks'

// cite: Nova's text (the tutor) marks what a claim rests on with [S1], [S2]…;
// given, each such mark is drawn by it. A note has none and passes nothing.
type Resolve = ((title: string) => NoteLinkRef | undefined) & { cite?: (label: string, key: string) => ReactNode | null }

// Where a [[link]] goes: the note with that title, else the topic, else a
// new note with that title (the learner sees it is not written yet).
export function linkHref(ref: NoteLinkRef | undefined, title: string): { href: string; missing: boolean } {
  if (ref?.noteId) return { href: `/notes/${encodeURIComponent(ref.noteId)}`, missing: false }
  if (ref?.topicId) return { href: `/knowledge?topic=${encodeURIComponent(ref.topicId)}`, missing: false }
  return { href: `/notes/new?title=${encodeURIComponent(title)}`, missing: true }
}

// Each kind of callout: its mark and its role (globals.css .sem-*), one
// palette for both themes: definitions cool, takeaways and summaries in
// Kivo's teal, examples a soft orange, questions violet, warnings amber,
// words from a source in the source blue. The icon and the title say the
// role too, so nothing rests on colour alone.
const CALLOUT: Record<CalloutType, { icon: typeof Quote; role: string }> = {
  note:       { icon: NotebookPen,   role: 'sem-plain' },
  quote:      { icon: Quote,         role: 'sem-source' },
  idea:       { icon: Lightbulb,     role: 'sem-takeaway' },
  takeaway:   { icon: KeyRound,      role: 'sem-takeaway' },
  summary:    { icon: ListChecks,    role: 'sem-takeaway' },
  question:   { icon: HelpCircle,    role: 'sem-question' },
  warning:    { icon: AlertTriangle, role: 'sem-warning' },
  example:    { icon: FlaskConical,  role: 'sem-example' },
  definition: { icon: BookOpen,      role: 'sem-definition' },
  paper:      { icon: FileText,      role: 'sem-source' },
}

function inline(text: string, key: string): ReactNode[] {
  return inlineTokens(text).map((t, n) => {
    const k = `${key}i${n}`
    switch (t.kind) {
      case 'text':      return t.text
      case 'bold':      return <strong key={k} className="font-semibold text-foreground">{t.text}</strong>
      case 'italic':    return <em key={k} className="italic">{t.text}</em>
      case 'highlight': return <mark key={k} className="rounded-[3px] bg-yellow-300/25 px-0.5 text-inherit [box-decoration-break:clone]" data-note-highlight>{t.text}</mark>
      case 'code':      return <code key={k} className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.86em]">{t.text}</code>
      case 'math':      return <span key={k} className="note-math sem-definition sem-ink" title="Maths (LaTeX)" data-note-math>{t.text}</span>
      case 'tag':       return <span key={k} className="mx-0.5 inline-block rounded-full bg-orange-400/15 px-2 py-px align-[0.08em] font-sans text-[0.8em] font-medium text-orange-300" data-note-tag={t.text}>#{t.text}</span>
      case 'url':       return <a key={k} href={t.href} target="_blank" rel="noopener noreferrer" className="break-all text-keppel-300 underline decoration-keppel-300/40 underline-offset-2 hover:decoration-keppel-300">{t.text}</a>
    }
  })
}

const isLabel = (t: string) => t.length >= 2 && t.length <= 4 && t[0] === 'S' && [...t.slice(1)].every(c => c >= '0' && c <= '9')

// Text with its [S#] marks drawn by cite; the rest as ordinary inline text.
function cited(text: string, key: string, cite: NonNullable<Resolve['cite']>): ReactNode[] {
  const out: ReactNode[] = []
  let plain = '', n = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[' && text[i + 1] === 'S') {
      const close = text.indexOf(']', i)
      const label = close === -1 ? '' : text.slice(i + 1, close)
      const mark = isLabel(label) ? cite(label, `${key}c${n}`) : null
      if (mark) { if (plain) out.push(...inline(plain, `${key}p${n}`)); plain = ''; out.push(mark); n++; i = close; continue }
    }
    plain += text[i]
  }
  if (plain) out.push(...inline(plain, `${key}p${n}`))
  return out
}

function line(text: string, key: string, resolve: Resolve): ReactNode[] {
  return tokenizeLine(text).flatMap<ReactNode>((t, j) => {
    if (t.kind === 'text') return resolve.cite ? cited(t.text, `${key}t${j}`, resolve.cite) : inline(t.text, `${key}t${j}`)
    const ref = resolve(t.target!)
    const { href, missing } = linkHref(ref, t.target!)
    return [
      <Link key={`${key}l${j}`} href={href} data-note-link={missing ? 'missing' : 'resolved'}
        title={missing ? `No note called "${t.target}" yet. Open to write it.` : undefined}
        className={missing
          ? 'text-foreground/60 underline decoration-dashed decoration-foreground/30 underline-offset-2 hover:text-foreground'
          : 'text-keppel-300 underline decoration-keppel-300/40 underline-offset-2 hover:decoration-keppel-300'}>
        {t.text}
      </Link>,
    ]
  })
}

const lines = (ls: string[], key: string, resolve: Resolve) =>
  ls.flatMap((l, j) => [...(j ? [<br key={`${key}br${j}`} />] : []), ...line(l, `${key}-${j}`, resolve)])

// Where a top-level block is in the note's text, for finding a passage Nova
// cites (note-editor.tsx revealPassage).
type SpanAttrs = { 'data-at'?: number; 'data-to'?: number }
const spanOf = (b: Block): SpanAttrs => (b.at !== undefined ? { 'data-at': b.at, 'data-to': b.to } : {})

function Callout({ block, k, resolve, span }: { block: Extract<Block, { kind: 'callout' }>; k: string; resolve: Resolve; span: SpanAttrs }) {
  const style = CALLOUT[block.type]
  const Icon = style.icon
  const head = (
    <span className="sem-ink flex items-center gap-2 font-sans text-[13px] font-semibold tracking-wide">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{line(block.title, `${k}t`, resolve)}</span>
      {block.fold && <ChevronRight className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />}
    </span>
  )
  const body = block.body.length > 0 && <div className="mt-1.5">{render(block.body, `${k}b`, resolve, true)}</div>
  const frame = `my-4 rounded-r-xl border-l-[3px] px-4 py-3 sem-frame ${style.role}`
  if (block.fold) {
    return (
      <details className={`group ${frame}`} open={block.fold === 'open'} data-callout={block.type} {...span}>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{head}</summary>
        {body}
      </details>
    )
  }
  return <aside className={frame} data-callout={block.type} {...span}>{head}{body}</aside>
}

function render(blocks: Block[], key: string, resolve: Resolve, nested = false): ReactNode[] {
  return blocks.map((b, n) => {
    const k = `${key}${n}`
    // Inside a callout the first and last blocks sit flush with its edges.
    const edge = nested ? 'first:mt-0 last:mb-0' : ''
    const span = spanOf(b)
    switch (b.kind) {
      case 'para': return <p key={k} className={`my-3 ${edge}`} {...span}>{lines(b.lines, k, resolve)}</p>
      case 'list': {
        const items = b.items.map((it, j) => <li key={`${k}-${j}`} className="my-1 pl-1">{line(it, `${k}-${j}`, resolve)}</li>)
        return b.ordered
          ? <ol key={k} className={`my-3 list-decimal space-y-0.5 pl-6 marker:text-foreground/40 ${edge}`} {...span}>{items}</ol>
          : <ul key={k} className={`my-3 list-disc space-y-0.5 pl-6 marker:text-keppel-400/60 ${edge}`} {...span}>{items}</ul>
      }
      case 'math': return (
        <div key={k} className={`my-4 flex items-start gap-3 ${edge}`} {...span} data-note-math-block>
          <pre className="note-math note-math-block min-w-0 flex-1 text-foreground/90" aria-label="Equation (LaTeX)">{b.tex}</pre>
          {b.tag && <span className="pt-2 font-mono text-xs text-subtle">{b.tag}</span>}
        </div>
      )
      case 'code': return <pre key={k} className={`my-4 overflow-x-auto rounded-lg border border-white/6 bg-white/[0.03] px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground/85 ${edge}`} {...span}><code>{b.text}</code></pre>
      case 'quote': return <blockquote key={k} className={`my-4 border-l-2 border-foreground/20 pl-4 italic text-foreground/70 ${edge}`} {...span}>{lines(b.lines, k, resolve)}</blockquote>
      case 'rule': return <hr key={k} className="my-8 border-white/10" {...span} />
      case 'callout': return <Callout key={k} block={b} k={k} resolve={resolve} span={span} />
      case 'table': return (
        <div key={k} className={`my-4 overflow-x-auto rounded-lg border border-white/8 ${edge}`} {...span}>
          <table className="w-full border-collapse text-[0.92em]">
            <thead><tr>{b.head.map((h, j) => <th key={j} className="border-b border-white/10 bg-white/[0.03] px-3 py-2 text-left font-semibold text-foreground">{line(h, `${k}h${j}`, resolve)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j} className="border-t border-white/6 first:border-t-0">{r.map((c, x) => <td key={x} className="px-3 py-2 align-top">{line(c, `${k}r${j}c${x}`, resolve)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      case 'heading': {
        const content = line(b.text, k, resolve)
        if (b.level === 1) return <h2 key={k} id={b.id} {...span} className={`mb-3 mt-10 scroll-mt-24 font-serif text-[1.75em] font-semibold leading-tight tracking-tight text-keppel-200 ${edge}`}>{content}</h2>
        if (b.level === 2) return <h3 key={k} id={b.id} {...span} className={`mb-2 mt-8 scroll-mt-24 font-serif text-[1.35em] font-semibold leading-snug text-foreground ${edge}`}>{content}</h3>
        return <h4 key={k} id={b.id} {...span} className={`mb-1.5 mt-6 scroll-mt-24 text-[1.08em] font-semibold text-foreground/90 ${edge}`}>{content}</h4>
      }
    }
  })
}

// ── A note holding an imported paper ─────────────────────────────────────────
// Its card (paper-source.ts) is drawn as the paper's header: what it is,
// where it came from, how much of it was imported, the original link and a
// way to any of its sections. The paper's own text follows, marked as the
// original as imported (a rule in the source colour and a label), then the
// learner's notes under "My notes", marked as theirs. Going to a section
// keeps where they were: "Back to where you were" takes them back.

function PaperNav({ targets }: { targets: Array<{ id: string; text: string; mine?: boolean }> }) {
  const [back, setBack] = useState<{ el: HTMLElement | Window; top: number } | null>(null)
  const go = (id: string, from: HTMLElement) => {
    const target = document.getElementById(id)
    if (!target) return
    const scroller = from.closest<HTMLElement>('[data-note-scroll]') ?? window
    setBack({ el: scroller, top: scroller instanceof Window ? window.scrollY : scroller.scrollTop })
    target.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 font-sans text-xs">
      {targets.some(t => !t.mine) && (
        <label className="inline-flex items-center gap-1.5 text-subtle">
          <span className="sr-only">Go to a section of the paper</span>
          <select defaultValue="" onChange={e => { if (e.target.value) go(e.target.value, e.target); e.target.value = '' }}
            className="h-8 max-w-[16rem] rounded-lg border border-white/10 bg-transparent px-2 text-xs text-foreground/85 focus:border-nova/60 focus:outline-none" data-paper-sections>
            <option value="">Go to a section…</option>
            {targets.filter(t => !t.mine).map(t => <option key={t.id} value={t.id}>{t.text}</option>)}
          </select>
        </label>
      )}
      {targets.filter(t => t.mine).map(t => (
        <button key={t.id} type="button" onClick={e => go(t.id, e.currentTarget)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-foreground/80 hover:bg-white/5" data-paper-to-notes>
          <NotebookPen className="size-3.5" aria-hidden /> Your notes
        </button>
      ))}
      {back && (
        <button type="button" onClick={() => {
          // Again on the next frame: a smooth scroll still under way would otherwise carry on past it.
          const to = () => (back.el instanceof Window ? window.scrollTo({ top: back.top, behavior: 'instant' }) : back.el.scrollTo({ top: back.top, behavior: 'instant' }))
          to(); window.requestAnimationFrame(to); setBack(null)
        }}
          className="fixed bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-background px-3.5 py-1.5 text-xs font-medium text-foreground shadow-float hover:bg-white/5" data-paper-back>
          Back to where you were
        </button>
      )}
    </div>
  )
}

// onRead: open the paper's PDF in the reader beside the note (note-editor.tsx);
// without it (Nova's panel) the PDF link opens a new tab as before.
function PaperHeader({ card, title, nav, span, onRead }: { card: PaperCard; title?: string; nav: ReactNode; span: SpanAttrs; onRead?: (url: string) => void }) {
  const ids = [card.arxivId && `arXiv ${card.arxivId}`, card.doi && `DOI ${card.doi}`, card.pmid && `PMID ${card.pmid}`, card.pmcid && card.pmcid].filter(Boolean)
  return (
    <header className="sem-source sem-frame my-2 rounded-2xl border px-5 py-4 font-sans" {...span} data-paper-card data-paper-status={card.status}>
      <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
        <span className="sem-ink inline-flex items-center gap-1.5"><FileText className="size-3.5" aria-hidden /> Research paper · original source</span>
        <span className={`rounded-full px-2 py-0.5 normal-case tracking-normal ${card.status === 'full' ? 'sem-chip sem-takeaway' : 'sem-chip sem-warning'}`} data-paper-imported>Imported: {PAPER_STATUS_WORDS[card.status]}</span>
      </p>
      {card.title && card.title !== title && <p className="mt-2 font-serif text-lg font-semibold leading-snug text-foreground">{card.title}</p>}
      {card.authors.length > 0 && <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">{card.authors.join(', ')}</p>}
      {(card.published || card.venue || ids.length > 0) && <p className="mt-1 text-xs text-subtle">{[card.published, card.venue, ...ids].filter(Boolean).join(' · ')}</p>}
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer" className="sem-ink inline-flex items-center gap-1 underline decoration-current/40 underline-offset-2 hover:decoration-current"><ExternalLink className="size-3" aria-hidden /> Original source</a>}
        {card.pdfUrl && (onRead
          ? <button type="button" onClick={() => onRead(card.pdfUrl!)} className="sem-ink inline-flex items-center gap-1 font-semibold underline decoration-current/40 underline-offset-2 hover:decoration-current" data-paper-read-pdf><BookOpenText className="size-3" aria-hidden /> Read the PDF here</button>
          : <a href={card.pdfUrl} target="_blank" rel="noopener noreferrer" className="sem-ink inline-flex items-center gap-1 underline decoration-current/40 underline-offset-2 hover:decoration-current"><ExternalLink className="size-3" aria-hidden /> PDF</a>)}
        <span className="text-subtle">{card.from ? `Text from ${card.from}` : 'No text of the paper was imported'}{card.importedOn ? ` · ${card.importedOn}` : ''}</span>
      </p>
      {nav}
    </header>
  )
}

export function NoteBody({ body, links, serif = false, cite, compact = false, title, onReadPdf }: {
  body: string; links: NoteLinkRef[]; serif?: boolean
  // Opens a paper's PDF beside the note instead of in a new tab.
  onReadPdf?: (url: string) => void
  cite?: (label: string, key: string) => ReactNode | null
  // Smaller type, for Nova's panel beside the note.
  compact?: boolean
  // The note's own title, so a paper's card does not repeat it.
  title?: string
}) {
  const byKey = new Map(links.map(l => [linkKey(l.title), l] as const))
  const resolve: Resolve = Object.assign((t: string) => byKey.get(linkKey(t)), { cite })
  const blocks = parseBlocks(body)
  const region = compact ? null : paperRegion(body)
  const card = region ? readPaperCard(body)?.card ?? null : null
  const first = blocks[0]
  let content: ReactNode[]
  if (region && card && first?.kind === 'callout' && first.type === 'paper') {
    const rest = blocks.slice(1)
    const paper = rest.filter(b => (b.at ?? 0) < region.end)
    const mine = rest.filter(b => (b.at ?? 0) >= region.end)
    const targets = [
      ...paper.flatMap(b => (b.kind === 'heading' && b.level <= 2 ? [{ id: b.id, text: b.text }] : [])),
      ...mine.flatMap(b => (b.kind === 'heading' && b.at === region.notesAt ? [{ id: b.id, text: b.text, mine: true }] : [])),
    ]
    content = [
      <PaperHeader key="card" card={card} title={title} span={spanOf(first)} nav={<PaperNav targets={targets} />} onRead={onReadPdf} />,
      <section key="paper" className="paper-text mt-6" aria-label="The paper, as imported" data-paper-text>
        <p className="sem-source sem-ink mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.12em]">The paper, as imported{card.status === 'full' ? '' : ` · ${PAPER_STATUS_WORDS[card.status]}`}</p>
        {render(paper, 'p', resolve)}
        {card.status !== 'full' && <p className="my-4 font-sans text-xs text-subtle" data-paper-incomplete>{card.status === 'partial' ? 'The import stops here. The rest of the paper is in the original.' : 'The paper’s text was not imported. Open the original to read it.'}</p>}
      </section>,
      <section key="mine" className="mt-10" aria-label="Your notes" data-paper-mine>
        <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Your notes</p>
        {mine.length ? render(mine, 'm', resolve) : <p className="text-sm text-subtle">Nothing here yet. Write your notes under “My notes”, or ask Nova Editor to add them.</p>}
      </section>,
    ]
  } else content = render(blocks, 'n', resolve)
  return (
    <div
      className={`break-words text-foreground/85 [&>*:first-child]:mt-0 ${compact ? '[&>*:last-child]:mb-0 text-[14px] leading-relaxed [&_h2]:mt-5 [&_h2]:text-[1.2em] [&_h3]:mt-4 [&_h3]:text-[1.08em] [&_p]:my-2' : serif ? 'font-serif text-[17px] leading-[1.8]' : 'text-[15px] leading-relaxed'}`}
      data-note-body
    >
      {content}
    </div>
  )
}

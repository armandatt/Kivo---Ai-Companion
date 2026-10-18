'use client'

// A note, drawn for reading. The text is the learner's and is shown as they
// wrote it; note-blocks.ts says which marks mean what (headings, lists,
// quotes, callouts, ==highlights==, #tags, [[links]], web addresses).
// Everything is built as React elements: nothing in a note is ever treated as
// HTML, so a note cannot run code or change the page.

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  AlertTriangle, BookOpen, ChevronRight, FlaskConical, HelpCircle, Lightbulb, ListChecks, NotebookPen, Quote,
} from 'lucide-react'
import { linkKey, tokenizeLine } from '@repo/api/nova/product/note-links'
import type { NoteLinkRef } from '@repo/api/nova/product/notes.types'
import { inlineTokens, parseBlocks, type Block, type CalloutType } from './note-blocks'

type Resolve = (title: string) => NoteLinkRef | undefined

// Where a [[link]] goes: the note with that title, else the topic, else a
// new note with that title (the learner sees it is not written yet).
export function linkHref(ref: NoteLinkRef | undefined, title: string): { href: string; missing: boolean } {
  if (ref?.noteId) return { href: `/notes/${encodeURIComponent(ref.noteId)}`, missing: false }
  if (ref?.topicId) return { href: `/knowledge?topic=${encodeURIComponent(ref.topicId)}`, missing: false }
  return { href: `/notes/new?title=${encodeURIComponent(title)}`, missing: true }
}

// Each kind of callout: its mark, its edge and fill, and the colour of its
// title. Text colours are only the tones globals.css darkens for the light
// theme (the -300s and keppel-200), so a callout reads on paper as well.
// The class names are written out in full so Tailwind keeps them.
const CALLOUT: Record<CalloutType, { icon: typeof Quote; edge: string; fill: string; title: string; text: string }> = {
  note:       { icon: NotebookPen,   edge: 'border-foreground/30',  fill: 'bg-white/[0.04]',       title: 'text-foreground/80', text: '' },
  // A passage from the source is set apart in the accent, the way a
  // highlighted quote is in a reading app; the learner's own words follow it.
  quote:      { icon: Quote,         edge: 'border-keppel-400/80',  fill: 'bg-keppel-400/[0.07]',  title: 'text-keppel-300',  text: 'text-keppel-200' },
  idea:       { icon: Lightbulb,     edge: 'border-sky-400/70',     fill: 'bg-sky-400/[0.06]',     title: 'text-sky-300',     text: '' },
  question:   { icon: HelpCircle,    edge: 'border-violet-400/70',  fill: 'bg-violet-400/[0.06]',  title: 'text-violet-300',  text: '' },
  warning:    { icon: AlertTriangle, edge: 'border-amber-400/70',   fill: 'bg-amber-400/[0.06]',   title: 'text-amber-300',   text: '' },
  summary:    { icon: ListChecks,    edge: 'border-indigo-400/70',  fill: 'bg-indigo-400/[0.06]',  title: 'text-indigo-300',  text: '' },
  example:    { icon: FlaskConical,  edge: 'border-orange-400/70',  fill: 'bg-orange-400/[0.06]',  title: 'text-orange-300',  text: '' },
  definition: { icon: BookOpen,      edge: 'border-pink-400/70',    fill: 'bg-pink-400/[0.06]',    title: 'text-pink-300',    text: '' },
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
      case 'tag':       return <span key={k} className="mx-0.5 inline-block rounded-full bg-orange-400/15 px-2 py-px align-[0.08em] font-sans text-[0.8em] font-medium text-orange-300" data-note-tag={t.text}>#{t.text}</span>
      case 'url':       return <a key={k} href={t.href} target="_blank" rel="noopener noreferrer" className="break-all text-keppel-300 underline decoration-keppel-300/40 underline-offset-2 hover:decoration-keppel-300">{t.text}</a>
    }
  })
}

function line(text: string, key: string, resolve: Resolve): ReactNode[] {
  return tokenizeLine(text).flatMap<ReactNode>((t, j) => {
    if (t.kind === 'text') return inline(t.text, `${key}t${j}`)
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

function Callout({ block, k, resolve }: { block: Extract<Block, { kind: 'callout' }>; k: string; resolve: Resolve }) {
  const style = CALLOUT[block.type]
  const Icon = style.icon
  const head = (
    <span className={`flex items-center gap-2 font-sans text-[13px] font-semibold tracking-wide ${style.title}`}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{line(block.title, `${k}t`, resolve)}</span>
      {block.fold && <ChevronRight className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />}
    </span>
  )
  const body = block.body.length > 0 && <div className={`mt-1.5 ${style.text}`}>{render(block.body, `${k}b`, resolve, true)}</div>
  const frame = `my-4 rounded-r-xl border-l-[3px] px-4 py-3 ${style.edge} ${style.fill}`
  if (block.fold) {
    return (
      <details className={`group ${frame}`} open={block.fold === 'open'} data-callout={block.type}>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{head}</summary>
        {body}
      </details>
    )
  }
  return <aside className={frame} data-callout={block.type}>{head}{body}</aside>
}

function render(blocks: Block[], key: string, resolve: Resolve, nested = false): ReactNode[] {
  return blocks.map((b, n) => {
    const k = `${key}${n}`
    // Inside a callout the first and last blocks sit flush with its edges.
    const edge = nested ? 'first:mt-0 last:mb-0' : ''
    switch (b.kind) {
      case 'para': return <p key={k} className={`my-3 ${edge}`}>{lines(b.lines, k, resolve)}</p>
      case 'list': {
        const items = b.items.map((it, j) => <li key={`${k}-${j}`} className="my-1 pl-1">{line(it, `${k}-${j}`, resolve)}</li>)
        return b.ordered
          ? <ol key={k} className={`my-3 list-decimal space-y-0.5 pl-6 marker:text-foreground/40 ${edge}`}>{items}</ol>
          : <ul key={k} className={`my-3 list-disc space-y-0.5 pl-6 marker:text-keppel-400/60 ${edge}`}>{items}</ul>
      }
      case 'code': return <pre key={k} className={`my-4 overflow-x-auto rounded-xl border border-white/8 bg-white/4 p-3.5 font-mono text-[13px] leading-relaxed ${edge}`}><code>{b.text}</code></pre>
      case 'quote': return <blockquote key={k} className={`my-4 border-l-2 border-foreground/20 pl-4 italic text-foreground/70 ${edge}`}>{lines(b.lines, k, resolve)}</blockquote>
      case 'rule': return <hr key={k} className="my-8 border-white/10" />
      case 'callout': return <Callout key={k} block={b} k={k} resolve={resolve} />
      case 'heading': {
        const content = line(b.text, k, resolve)
        if (b.level === 1) return <h2 key={k} id={b.id} className={`mb-3 mt-10 scroll-mt-24 font-serif text-[1.75em] font-semibold leading-tight tracking-tight text-keppel-200 ${edge}`}>{content}</h2>
        if (b.level === 2) return <h3 key={k} id={b.id} className={`mb-2 mt-8 scroll-mt-24 font-serif text-[1.35em] font-semibold leading-snug text-foreground ${edge}`}>{content}</h3>
        return <h4 key={k} id={b.id} className={`mb-1.5 mt-6 scroll-mt-24 text-[1.08em] font-semibold text-foreground/90 ${edge}`}>{content}</h4>
      }
    }
  })
}

export function NoteBody({ body, links, serif = false }: { body: string; links: NoteLinkRef[]; serif?: boolean }) {
  const byKey = new Map(links.map(l => [linkKey(l.title), l] as const))
  const resolve: Resolve = title => byKey.get(linkKey(title))
  return (
    <div
      className={`break-words text-foreground/85 [&>*:first-child]:mt-0 ${serif ? 'font-serif text-[17px] leading-[1.8]' : 'text-[15px] leading-relaxed'}`}
      data-note-body
    >
      {render(parseBlocks(body), 'n', resolve)}
    </div>
  )
}

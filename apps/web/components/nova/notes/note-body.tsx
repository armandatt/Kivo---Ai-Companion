'use client'

// A note, drawn for reading. The text is the learner's and is shown as they
// wrote it, with a few marks given their usual meaning:
//   # / ## / ###   headings            - or *   list items
//   1.             numbered items      >        a quoted line
//   ```            a block of code     **bold** and `code` inside a line
//   [[Title]]      a link to another of their notes (note-links.ts)
//   http(s)://…    a link that opens in a new tab
// Everything is built as React elements: nothing in a note is ever treated as
// HTML, so a note cannot run code or change the page.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { linkKey, tokenizeLine } from '@repo/api/nova/product/note-links'
import type { NoteLinkRef } from '@repo/api/nova/product/notes.types'

type Resolve = (title: string) => NoteLinkRef | undefined

// Where a [[link]] goes: the note with that title, else the topic, else a
// new note with that title (the learner sees it is not written yet).
export function linkHref(ref: NoteLinkRef | undefined, title: string): { href: string; missing: boolean } {
  if (ref?.noteId) return { href: `/notes/${encodeURIComponent(ref.noteId)}`, missing: false }
  if (ref?.topicId) return { href: `/knowledge?topic=${encodeURIComponent(ref.topicId)}`, missing: false }
  return { href: `/notes/new?title=${encodeURIComponent(title)}`, missing: true }
}

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

// **bold**, `code` and bare web addresses inside a run of plain text.
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0, plain = '', n = 0
  const flush = () => { if (plain) { out.push(plain); plain = '' } }
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) { flush(); out.push(<strong key={`${key}b${n++}`} className="font-semibold text-foreground">{text.slice(i + 2, end)}</strong>); i = end + 2; continue }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) { flush(); out.push(<code key={`${key}c${n++}`} className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.9em]">{text.slice(i + 1, end)}</code>); i = end + 1; continue }
    }
    if (text.startsWith('http://', i) || text.startsWith('https://', i)) {
      let end = i
      while (end < text.length && text[end] !== ' ' && text[end] !== ')' && text[end] !== '>') end++
      // A sentence's full stop or comma is not part of the address.
      while (end > i && '.,;:!?'.includes(text[end - 1]!)) end--
      const url = safeUrl(text.slice(i, end))
      if (url) {
        flush()
        out.push(<a key={`${key}u${n++}`} href={url} target="_blank" rel="noopener noreferrer" className="text-keppel-300 underline decoration-keppel-300/40 underline-offset-2 hover:decoration-keppel-300 break-all">{text.slice(i, end)}</a>)
        i = end
        continue
      }
    }
    plain += text[i]
    i++
  }
  flush()
  return out
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

export function NoteBody({ body, links }: { body: string; links: NoteLinkRef[] }) {
  const byKey = new Map(links.map(l => [linkKey(l.title), l] as const))
  const resolve: Resolve = title => byKey.get(linkKey(title))

  const blocks: ReactNode[] = []
  const lines = body.split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (para.length === 0) return
    const id = `p${k++}`
    blocks.push(<p key={id} className="my-3">{para.flatMap((l, j) => [...(j ? [<br key={`${id}br${j}`} />] : []), ...line(l, `${id}-${j}`, resolve)])}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const id = `l${k++}`
    const items = list.items.map((it, j) => <li key={`${id}-${j}`} className="my-1">{line(it, `${id}-${j}`, resolve)}</li>)
    blocks.push(list.ordered
      ? <ol key={id} className="my-3 list-decimal space-y-0.5 pl-6">{items}</ol>
      : <ul key={id} className="my-3 list-disc space-y-0.5 pl-6">{items}</ul>)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()

    if (trimmed.startsWith('```')) {
      flushPara(); flushList()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) code.push(lines[i++]!)
      blocks.push(<pre key={`c${k++}`} className="my-4 overflow-x-auto rounded-xl border border-white/8 bg-white/4 p-3.5 font-mono text-[13px] leading-relaxed"><code>{code.join('\n')}</code></pre>)
      continue
    }
    if (!trimmed) { flushPara(); flushList(); continue }

    const heading = trimmed.startsWith('### ') ? 3 : trimmed.startsWith('## ') ? 2 : trimmed.startsWith('# ') ? 1 : 0
    if (heading) {
      flushPara(); flushList()
      const content = line(trimmed.slice(heading + 1), `h${k}`, resolve)
      const cls = heading === 1 ? 'mt-7 mb-2 text-xl font-semibold text-foreground' : heading === 2 ? 'mt-6 mb-2 text-lg font-semibold text-foreground' : 'mt-5 mb-1.5 text-base font-semibold text-foreground'
      const id = `h${k++}`
      blocks.push(heading === 1 ? <h2 key={id} className={cls}>{content}</h2> : heading === 2 ? <h3 key={id} className={cls}>{content}</h3> : <h4 key={id} className={cls}>{content}</h4>)
      continue
    }
    if (trimmed.startsWith('> ')) {
      flushPara(); flushList()
      blocks.push(<blockquote key={`q${k++}`} className="my-3 border-l-2 border-keppel-400/40 pl-4 text-foreground/70">{line(trimmed.slice(2), `q${k}`, resolve)}</blockquote>)
      continue
    }
    const bullet = trimmed.startsWith('- ') || trimmed.startsWith('* ')
    let numbered = 0
    while (numbered < trimmed.length && trimmed[numbered]! >= '0' && trimmed[numbered]! <= '9') numbered++
    const ordered = numbered > 0 && trimmed.startsWith('. ', numbered)
    if (bullet || ordered) {
      flushPara()
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push(bullet ? trimmed.slice(2) : trimmed.slice(numbered + 2))
      continue
    }
    flushList()
    para.push(raw)
  }
  flushPara(); flushList()

  return <div className="break-words text-[15px] leading-relaxed text-foreground/85" data-note-body>{blocks}</div>
}

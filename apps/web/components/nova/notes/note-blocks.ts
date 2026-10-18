// A note's text, read into blocks for drawing (note-body.tsx). Pure: no
// React, so the reading is tested on its own (note-blocks.test.ts).
//
// The marks are the ones a learner coming from Obsidian or GitHub already
// knows, and plain text stays plain text:
//   # / ## / ###          headings             - or *   list items
//   1.                    numbered items       ---      a dividing line
//   > text                a quote; consecutive > lines are one quote
//   > [!type] Title       a callout: the > lines under it are its body.
//                         [!quote] for a passage from the source, [!idea],
//                         [!question], [!warning], [!summary], [!example],
//                         [!definition], [!note]. A + or - after ] makes it
//                         foldable (- starts folded).
//   ```                   a block of code
// Inside a line (inlineTokens): **bold**, *italic*, ==highlight==, `code`,
// #tag and bare web addresses. [[Links]] are read first, by note-links.ts.

export type CalloutType = 'note' | 'quote' | 'idea' | 'question' | 'warning' | 'summary' | 'example' | 'definition'

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; id: string }
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'rule' }
  | { kind: 'callout'; type: CalloutType; title: string; fold: 'open' | 'closed' | null; body: Block[] }

// What a learner may write between [! and ], and the callout it is drawn as.
const CALLOUT_ALIASES: Record<string, CalloutType> = {
  note: 'note', info: 'note', todo: 'note',
  quote: 'quote', cite: 'quote', source: 'quote', highlight: 'quote',
  idea: 'idea', tip: 'idea', hint: 'idea', important: 'idea', insight: 'idea',
  question: 'question', faq: 'question', help: 'question', doubt: 'question',
  warning: 'warning', caution: 'warning', attention: 'warning', danger: 'warning', error: 'warning', bug: 'warning', mistake: 'warning',
  summary: 'summary', abstract: 'summary', tldr: 'summary', recap: 'summary',
  example: 'example',
  definition: 'definition', def: 'definition', term: 'definition',
}

export const CALLOUT_LABEL: Record<CalloutType, string> = {
  note: 'Note', quote: 'From the source', idea: 'Idea', question: 'Question',
  warning: 'Watch out', summary: 'Summary', example: 'Example', definition: 'Definition',
}

// "> [!quote]- Attention" → { type: 'quote', fold: 'closed', title: 'Attention' }.
// null when the line is an ordinary quote.
export function calloutHeader(text: string): { type: CalloutType; fold: 'open' | 'closed' | null; title: string } | null {
  if (!text.startsWith('[!')) return null
  const close = text.indexOf(']')
  if (close < 3) return null
  const name = text.slice(2, close).trim().toLowerCase()
  if (!name || name.includes(' ')) return null
  let rest = text.slice(close + 1)
  const fold = rest.startsWith('-') ? 'closed' : rest.startsWith('+') ? 'open' : null
  if (fold) rest = rest.slice(1)
  const type = CALLOUT_ALIASES[name] ?? 'note'
  // An unknown type keeps the learner's word as its title.
  const title = rest.trim() || (CALLOUT_ALIASES[name] ? CALLOUT_LABEL[type] : name[0]!.toUpperCase() + name.slice(1))
  return { type, fold, title }
}

// A quote line's text, without the > and one space after it.
const unquote = (trimmed: string) => trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed.slice(1)

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9'
const isWordChar = (ch: string | undefined) =>
  ch !== undefined && (ch.toLowerCase() !== ch.toUpperCase() || isDigit(ch) || ch === '_' || ch === '-' || ch === '/')

// A heading's anchor: its words in lower case joined by dashes.
export function slug(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) {
    if (ch.toLowerCase() !== ch.toUpperCase() || isDigit(ch)) out += ch
    else if (out && !out.endsWith('-')) out += '-'
  }
  while (out.endsWith('-')) out = out.slice(0, -1)
  return out || 'section'
}

export function parseBlocks(body: string): Block[] {
  const ids = new Map<string, number>()
  const uniqueId = (text: string) => {
    const base = slug(text)
    const n = ids.get(base) ?? 0
    ids.set(base, n + 1)
    return n === 0 ? base : `${base}-${n + 1}`
  }
  return parseLines(body.split('\n'), uniqueId)
}

function parseLines(lines: string[], uniqueId: (text: string) => string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = () => { if (para.length) { blocks.push({ kind: 'para', lines: para }); para = [] } }
  const flushList = () => { if (list) { blocks.push({ kind: 'list', ...list }); list = null } }
  const flush = () => { flushPara(); flushList() }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()

    if (trimmed.startsWith('```')) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) code.push(lines[i++]!)
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (!trimmed.trim()) { flush(); continue }

    if (trimmed.startsWith('>')) {
      flush()
      // Every > line that follows belongs to this quote or callout.
      const inner: string[] = []
      while (i < lines.length && lines[i]!.trimStart().startsWith('>')) inner.push(unquote(lines[i++]!.trimStart()))
      i--
      const header = calloutHeader(inner[0]!.trim())
      if (header) blocks.push({ kind: 'callout', ...header, body: parseLines(inner.slice(1), uniqueId) })
      else blocks.push({ kind: 'quote', lines: inner })
      continue
    }

    const heading = trimmed.startsWith('### ') ? 3 : trimmed.startsWith('## ') ? 2 : trimmed.startsWith('# ') ? 1 : 0
    if (heading) {
      flush()
      const text = trimmed.slice(heading + 1).trim()
      blocks.push({ kind: 'heading', level: heading, text, id: uniqueId(text) })
      continue
    }

    const t = trimmed.trimEnd()
    if (t.length >= 3 && [...t].every(ch => ch === '-')) { flush(); blocks.push({ kind: 'rule' }); continue }

    const bullet = trimmed.startsWith('- ') || trimmed.startsWith('* ')
    let numbered = 0
    while (isDigit(trimmed[numbered])) numbered++
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
  flush()
  return blocks
}

// The headings of a note, in order, for its outline.
export function outline(blocks: Block[]): Array<{ level: 1 | 2 | 3; text: string; id: string }> {
  return blocks.flatMap(b => b.kind === 'heading' ? [{ level: b.level, text: b.text, id: b.id }] : [])
}

// ── Inside a line ────────────────────────────────────────────────────────────

export type InlineToken =
  | { kind: 'text' | 'bold' | 'italic' | 'highlight' | 'code' | 'tag'; text: string }
  | { kind: 'url'; text: string; href: string }

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

// A pair of marks around some text: `**bold**`, `==highlight==`, `*italic*`.
// The closing mark must follow text, so "2 * 3 * 4" stays as written.
function paired(text: string, i: number, mark: string): number {
  if (!text.startsWith(mark, i)) return -1
  const from = i + mark.length
  if (from >= text.length || text[from] === ' ') return -1
  const end = text.indexOf(mark, from)
  return end > from && text[end - 1] !== ' ' ? end : -1
}

export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = []
  let i = 0, plain = ''
  const flush = () => { if (plain) { out.push({ kind: 'text', text: plain }); plain = '' } }
  const push = (token: InlineToken, next: number) => { flush(); out.push(token); i = next }

  while (i < text.length) {
    let end = paired(text, i, '**')
    if (end !== -1) { push({ kind: 'bold', text: text.slice(i + 2, end) }, end + 2); continue }
    end = paired(text, i, '==')
    if (end !== -1) { push({ kind: 'highlight', text: text.slice(i + 2, end) }, end + 2); continue }
    if (text[i] === '*' && text[i + 1] !== '*') {
      end = paired(text, i, '*')
      if (end !== -1) { push({ kind: 'italic', text: text.slice(i + 1, end) }, end + 1); continue }
    }
    if (text[i] === '`') {
      end = text.indexOf('`', i + 1)
      if (end > i + 1) { push({ kind: 'code', text: text.slice(i + 1, end) }, end + 1); continue }
    }
    // #tag: at the start of a word, a letter first. "C#" and "#1" stay text.
    if (text[i] === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '(') && isWordChar(text[i + 1]) && !isDigit(text[i + 1])) {
      end = i + 1
      while (isWordChar(text[end])) end++
      push({ kind: 'tag', text: text.slice(i + 1, end) }, end)
      continue
    }
    if (text.startsWith('http://', i) || text.startsWith('https://', i)) {
      end = i
      while (end < text.length && text[end] !== ' ' && text[end] !== ')' && text[end] !== '>') end++
      // A sentence's full stop or comma is not part of the address.
      while (end > i && '.,;:!?'.includes(text[end - 1]!)) end--
      const href = safeUrl(text.slice(i, end))
      if (href) { push({ kind: 'url', text: text.slice(i, end), href }, end); continue }
    }
    plain += text[i]
    i++
  }
  flush()
  return out
}

// ── About the whole note ─────────────────────────────────────────────────────

// The address on the note's "Source:" line (the Source notes template), if
// it is a web address. It is what the reading view can open beside the note.
//   url    the address as written, for "open in a new tab"
//   view   what is shown beside the note: an arXiv abstract page refuses to
//          be shown inside another page, so its PDF is shown instead
//   pdf    a PDF, which the browser shows with its own viewer
export interface NoteSource { url: string; view: string; label: string; pdf: boolean }
export function sourceOf(body: string): NoteSource | null {
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t.toLowerCase().startsWith('source:')) continue
    const token = inlineTokens(t.slice(7).trim()).find(x => x.kind === 'url')
    if (!token || token.kind !== 'url') continue
    const u = new URL(token.href)
    const host = u.hostname.toLowerCase().startsWith('www.') ? u.hostname.slice(4) : u.hostname
    let view = token.href
    if (host === 'arxiv.org' && u.pathname.startsWith('/abs/')) view = `https://arxiv.org/pdf/${u.pathname.slice(5)}`
    const path = new URL(view).pathname.toLowerCase()
    const pdf = path.endsWith('.pdf') || (host === 'arxiv.org' && path.startsWith('/pdf/'))
    return { url: token.href, view, label: host, pdf }
  }
  return null
}

export function wordCount(body: string): number {
  let words = 0
  for (const w of body.split(' ').join('\n').split('\n')) if ([...w].some(ch => ch.toLowerCase() !== ch.toUpperCase() || isDigit(ch))) words++
  return words
}

export function tagsOf(body: string): string[] {
  const seen = new Map<string, string>()
  let code = false
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) { code = !code; continue }
    if (code) continue
    for (const t of inlineTokens(line)) if (t.kind === 'tag' && !seen.has(t.text.toLowerCase())) seen.set(t.text.toLowerCase(), t.text)
  }
  return [...seen.values()]
}

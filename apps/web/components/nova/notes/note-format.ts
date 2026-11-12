// What the editor's toolbar does to the text. Pure: each takes the note's
// text and the selection, and gives back the new text and where the
// selection goes. Nothing is added that the learner could not type
// themselves; these only save the typing.

import { CALLOUT_LABEL, type CalloutType } from './note-blocks'
import { colorSpanAt, type NoteColor } from '@repo/api/nova/product/note-colors'

export interface Edited { text: string; start: number; end: number }

const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1
const lineEnd   = (text: string, at: number) => { const n = text.indexOf('\n', at); return n === -1 ? text.length : n }

// **bold**, *italic*, ==highlight==, `code` around the selection; pressed
// again on text already marked, the marks come off. Nothing selected: the
// marks go in around a placeholder, which is selected to type over.
export function wrap(text: string, start: number, end: number, mark: string, placeholder: string): Edited {
  const selected = text.slice(start, end)
  if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
    return { text: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length), start: start - mark.length, end: end - mark.length }
  }
  const inner = selected || placeholder
  return { text: text.slice(0, start) + mark + inner + mark + text.slice(end), start: start + mark.length, end: start + mark.length + inner.length }
}

// A mark at the start of every line the selection touches: "# ", "## ",
// "- ", "1. ". If every line has it already, it comes off. A heading mark
// replaces another heading mark rather than adding to it.
export function prefixLines(text: string, start: number, end: number, prefix: string): Edited {
  const from = lineStart(text, start)
  const to   = lineEnd(text, Math.max(start, end - (end > start && text[end - 1] === '\n' ? 1 : 0)))
  const lines = text.slice(from, to).split('\n')
  const heading = prefix.startsWith('#')
  const strip = (l: string) => {
    if (!heading) return l
    let n = 0
    while (l[n] === '#') n++
    return n > 0 && l[n] === ' ' ? l.slice(n + 1) : l
  }
  const all = lines.every(l => l.startsWith(prefix))
  const ordered = prefix === '1. '
  const out = lines.map((l, i) => all ? l.slice(prefix.length) : (ordered ? `${i + 1}. ` : prefix) + strip(l)).join('\n')
  return { text: text.slice(0, from) + out + text.slice(to), start: from, end: from + out.length }
}

// A callout. With a selection, the lines it touches become the callout's
// body (a passage pasted from the source, then quoted). With none, an empty
// callout is opened on a line of its own and the cursor waits inside it.
export function callout(text: string, start: number, end: number, type: CalloutType, title = CALLOUT_LABEL[type]): Edited {
  const header = `> [!${type}] ${title}`
  if (start === end) {
    const from = lineStart(text, start)
    const lineHasText = text.slice(from, lineEnd(text, start)).trim().length > 0
    const before = text.slice(0, start)
    const lead = lineHasText ? '\n\n' : before && !before.endsWith('\n\n') && before.endsWith('\n') ? '\n' : ''
    const snippet = `${lead}${header}\n> `
    const after = text.slice(start)
    const tail = after && !after.startsWith('\n') ? '\n\n' : ''
    const at = start + snippet.length
    return { text: before + snippet + tail + after, start: at, end: at }
  }
  const from = lineStart(text, start)
  const to   = lineEnd(text, end - (text[end - 1] === '\n' ? 1 : 0))
  const body = text.slice(from, to).split('\n').map(l => l.trim() ? `> ${l}` : '>').join('\n')
  const block = `${header}\n${body}`
  // The learner's own words go under it: the cursor waits on an empty line
  // of its own, apart from whatever followed.
  let rest = text.slice(to)
  while (rest.startsWith('\n')) rest = rest.slice(1)
  const at = from + block.length + 2
  return { text: text.slice(0, from) + block + '\n\n' + (rest ? `\n\n${rest}` : ''), start: at, end: at }
}

// [[selection]], or [[]] with the cursor inside.
export function noteLink(text: string, start: number, end: number): Edited {
  const selected = text.slice(start, end)
  const out = `[[${selected}]]`
  const at = selected ? start + out.length : start + 2
  return { text: text.slice(0, start) + out + text.slice(end), start: at, end: at }
}

// #selection as one word, or #tag selected to type over.
export function tag(text: string, start: number, end: number): Edited {
  const word = text.slice(start, end).trim().split(' ').filter(Boolean).join('-')
  const out = `#${word || 'tag'}`
  return { text: text.slice(0, start) + out + text.slice(end), start: start + 1, end: start + out.length }
}

// A line of its own: "---".
export function divider(text: string, start: number): Edited {
  const before = text.slice(0, start)
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const snippet = `${lead}---\n\n`
  const at = start + snippet.length
  return { text: before + snippet + text.slice(start), start: at, end: at }
}

// ── Colour (note-colors.ts) ──────────────────────────────────────────────────
// [words]{.blue} or [words]{.hl-blue} around the selection, one span per line
// (a span never crosses a line). Chosen again on words already in that
// colour, the colour comes off; on words in another colour, it changes.
// Nothing selected: a placeholder, selected to type over.
export function colorize(text: string, start: number, end: number, color: NoteColor, highlight: boolean): Edited {
  const cls = `${highlight ? 'hl-' : ''}${color}`
  // The selection is the words of a span (or the whole span): change or remove it.
  const around = spanAround(text, start, end)
  if (around) {
    const same = around.color === color && around.highlight === highlight
    const words = text.slice(around.from + 1, around.close)
    const out = same ? words : `[${words}]{.${cls}}`
    const at = same ? around.from : around.from + 1
    return { text: text.slice(0, around.from) + out + text.slice(around.end), start: at, end: at + words.length }
  }
  const selected = text.slice(start, end)
  if (!selected) {
    const placeholder = 'text'
    return { text: `${text.slice(0, start)}[${placeholder}]{.${cls}}${text.slice(end)}`, start: start + 1, end: start + 1 + placeholder.length }
  }
  // One line: the words stay selected, so the next pick changes this span.
  if (!selected.includes('\n') && selected.trim() === selected) {
    return { text: `${text.slice(0, start)}[${selected}]{.${cls}}${text.slice(end)}`, start: start + 1, end: start + 1 + selected.length }
  }
  const lines = selected.split('\n').map(l => {
    const lead = l.length - l.trimStart().length, trail = l.length - l.trimEnd().length
    const core = l.slice(lead, l.length - trail)
    return core ? `${l.slice(0, lead)}[${core}]{.${cls}}${l.slice(l.length - trail)}` : l
  }).join('\n')
  return { text: text.slice(0, start) + lines + text.slice(end), start, end: start + lines.length }
}

// Every colour, highlight and ==mark== inside the selection taken off; the words stay.
export function clearColor(text: string, start: number, end: number): Edited {
  const around = spanAround(text, start, end)
  const from = around ? around.from : start, to = around ? around.end : end
  let out = '', i = from
  const part = text.slice(0, to)
  while (i < to) {
    const span = colorSpanAt(part, i)
    if (span && span.end <= to) { out += span.words; i = span.end; continue }
    if (part.startsWith('==', i)) { i += 2; continue }
    out += part[i]; i++
  }
  return { text: text.slice(0, from) + out + text.slice(to), start: from, end: from + out.length }
}

// The span whose words are the selection, or which the selection is.
function spanAround(text: string, start: number, end: number): { from: number; close: number; end: number; color: NoteColor; highlight: boolean } | null {
  const tryAt = (from: number) => {
    const s = from >= 0 ? colorSpanAt(text, from) : null
    if (!s) return null
    const close = from + 1 + s.words.length
    return { from, close, end: s.end, color: s.color, highlight: s.highlight }
  }
  const whole = tryAt(start)
  if (whole && whole.end === end) return whole
  const inner = text[start - 1] === '[' ? tryAt(start - 1) : null
  return inner && inner.close === end ? inner : null
}

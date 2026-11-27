// Pasting from ChatGPT (or any web page) into a note (bug batch 28 Nov,
// item 10): the clipboard's HTML becomes Markdown, so headings, lists, bold,
// links, code, quotes and tables keep their structure, and inline fonts,
// sizes and colours are dropped (the note's own reading style applies).
//
// Pure: works on anything shaped like a DOM node, so the browser passes its
// parsed document and the tests pass plain objects. Nothing is ever turned
// back into HTML or run.

export interface PasteNode {
  nodeType: number                       // 1 element, 3 text
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<PasteNode>
  getAttribute?(name: string): string | null
}

// Worth converting: HTML with structure in it. A plain run of text pastes as text.
const STRUCTURE = /<(h[1-6]|ul|ol|li|table|pre|blockquote|strong|b|em|code|hr)\b/i
export const hasStructure = (html: string) => STRUCTURE.test(html)

const kids = (n: PasteNode) => Array.from(n.childNodes)
const tag = (n: PasteNode) => n.nodeName.toLowerCase()
const squash = (s: string) => s.replace(/[ \t\r\n ]+/g, ' ')

function inline(n: PasteNode): string {
  if (n.nodeType === 3) return squash(n.textContent ?? '')
  if (n.nodeType !== 1) return ''
  const t = tag(n)
  const inner = () => kids(n).map(inline).join('')
  switch (t) {
    case 'br': return '\n'
    case 'strong': case 'b': { const x = inner().trim(); return x ? `**${x}**` : '' }
    case 'em': case 'i': { const x = inner().trim(); return x ? `*${x}*` : '' }
    case 'code': { const x = (n.textContent ?? '').replace(/\n/g, ' '); return x ? `\`${x}\`` : '' }
    case 'a': { const href = n.getAttribute?.('href') ?? ''; const x = inner().trim(); return /^https?:\/\//.test(href) ? `[${x || href}](${href})` : x }
    case 'script': case 'style': return ''
    default: return inner()
  }
}

function list(n: PasteNode, depth: number): string[] {
  const ordered = tag(n) === 'ol'
  const out: string[] = []
  let i = 1
  for (const li of kids(n)) {
    if (li.nodeType !== 1 || tag(li) !== 'li') continue
    const own = kids(li).filter(c => !(c.nodeType === 1 && (tag(c) === 'ul' || tag(c) === 'ol')))
    const text = own.map(c => (c.nodeType === 1 && tag(c) === 'p' ? inline(c) : inline(c))).join('').trim()
    out.push(`${'  '.repeat(depth)}${ordered ? `${i++}.` : '-'} ${text}`)
    for (const c of kids(li)) if (c.nodeType === 1 && (tag(c) === 'ul' || tag(c) === 'ol')) out.push(...list(c, depth + 1))
  }
  return out
}

function table(n: PasteNode): string[] {
  const rows: string[][] = []
  const walk = (x: PasteNode) => { for (const c of kids(x)) { if (c.nodeType !== 1) continue; if (tag(c) === 'tr') rows.push(kids(c).filter(d => d.nodeType === 1 && (tag(d) === 'td' || tag(d) === 'th')).map(d => inline(d).trim().replace(/\|/g, '\\|'))); else walk(c) } }
  walk(n)
  if (!rows.length) return []
  const width = Math.max(...rows.map(r => r.length))
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
  return [`| ${pad(rows[0]!).join(' | ')} |`, `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(r => `| ${pad(r).join(' | ')} |`)]
}

function blocks(n: PasteNode): string[] {
  const out: string[] = []
  let line = ''
  const flush = () => { const x = line.trim(); if (x) out.push(x); line = '' }
  for (const c of kids(n)) {
    if (c.nodeType === 3) { line += squash(c.textContent ?? ''); continue }
    if (c.nodeType !== 1) continue
    const t = tag(c)
    if (/^h[1-6]$/.test(t)) { flush(); out.push(`${'#'.repeat(Number(t[1]))} ${inline(c).trim()}`); continue }
    if (t === 'p') { flush(); const x = inline(c).trim(); if (x) out.push(x); continue }
    if (t === 'ul' || t === 'ol') { flush(); out.push(list(c, 0).join('\n')); continue }
    if (t === 'pre') { flush(); const code = (c.textContent ?? '').replace(/\n+$/, ''); out.push('```\n' + code + '\n```'); continue }
    if (t === 'blockquote') { flush(); out.push(blocks(c).join('\n\n').split('\n').map(l => (l ? `> ${l}` : '>')).join('\n')); continue }
    if (t === 'table') { flush(); out.push(table(c).join('\n')); continue }
    if (t === 'hr') { flush(); out.push('---'); continue }
    if (t === 'div' || t === 'section' || t === 'article' || t === 'body' || t === 'main') { flush(); out.push(...blocks(c)); continue }
    if (t === 'script' || t === 'style' || t === 'meta' || t === 'title' || t === 'head') continue
    line += inline(c)
  }
  flush()
  return out.filter(Boolean)
}

export function htmlToMarkdown(root: PasteNode): string {
  return blocks(root).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

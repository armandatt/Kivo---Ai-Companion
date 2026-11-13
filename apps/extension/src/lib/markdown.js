// Nova's answers, drawn for reading in a narrow panel. Answers are Markdown
// with LaTeX maths. parse() turns the text into a small tree (pure, tested);
// render() builds DOM nodes from it. Nothing is ever set as HTML: text goes
// in as text, links must be http(s), and maths is drawn by KaTeX (packaged
// with the extension, `trust` off), whose output is its own. What KaTeX can't
// draw is shown as written, marked. Wide tables and code scroll sideways.

// ── Parsing ───────────────────────────────────────────────────────────────────

const FENCE = '```'
const isBlank = line => line.trim() === ''
const indentOf = line => line.length - line.trimStart().length
const headingOf = line => {
  const t = line.trimStart()
  let n = 0
  while (t[n] === '#' && n < 7) n++
  return n >= 1 && n <= 6 && t[n] === ' ' ? { level: n, text: t.slice(n + 1).trim() } : null
}
const isRule = line => { const t = line.trim().split(' ').join(''); return t.length >= 3 && ['-', '*', '_'].some(ch => [...t].every(c => c === ch)) }
function listMarker(line) {
  const t = line.trimStart()
  if ((t[0] === '-' || t[0] === '*' || t[0] === '+') && t[1] === ' ') return { ordered: false, start: 1, width: indentOf(line) + 2 }
  let n = 0
  while (n < 9 && t[n] >= '0' && t[n] <= '9') n++
  if (n > 0 && (t[n] === '.' || t[n] === ')') && t[n + 1] === ' ') return { ordered: true, start: Number(t.slice(0, n)), width: indentOf(line) + n + 2 }
  return null
}
const isTableRow = line => line.trim().startsWith('|') && line.trim().length > 1
function tableCells(line) {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  const cells = []
  let cell = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cell += '|'; i++; continue }
    if (t[i] === '|') { cells.push(cell.trim()); cell = ''; continue }
    cell += t[i]
  }
  cells.push(cell.trim())
  return cells
}
const isAlignRow = line => isTableRow(line) && tableCells(line).every(c => c.length > 0 && [...c].every(ch => ch === '-' || ch === ':' || ch === ' ') && c.includes('-'))
const alignOf = c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null)

/** @returns {Array<object>} blocks */
export function parse(text) {
  const lines = String(text ?? '').split('\r\n').join('\n').split('\r').join('\n').split('\n')
  return blocks(lines)
}

function blocks(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }
    const t = line.trim()

    // ``` code, to its closing fence (or the end, for an answer cut short)
    if (t.startsWith(FENCE)) {
      const lang = t.slice(3).trim().split(' ')[0] || null
      const body = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(FENCE)) body.push(lines[i++])
      i++
      out.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }
    // $$ … $$ or \[ … \] on lines of their own: displayed maths
    if (t.startsWith('$$') || t.startsWith('\\[')) {
      const close = t.startsWith('$$') ? '$$' : '\\]'
      const rest = t.slice(2)
      if (rest.trimEnd().endsWith(close) && rest.trim().length > close.length - 0) {
        out.push({ type: 'math', tex: rest.trimEnd().slice(0, -close.length).trim() }); i++; continue
      }
      const body = [rest]
      i++
      while (i < lines.length && !lines[i].trimEnd().endsWith(close)) body.push(lines[i++])
      if (i < lines.length) body.push(lines[i].trimEnd().slice(0, -close.length))
      i++
      out.push({ type: 'math', tex: body.join('\n').trim() })
      continue
    }
    const h = headingOf(line)
    if (h) { out.push({ type: 'heading', level: h.level, inline: inline(h.text) }); i++; continue }
    if (isRule(line) && !listMarker(line)) { out.push({ type: 'hr' }); i++; continue }
    if (t.startsWith('>')) {
      const body = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { const q = lines[i].trim().slice(1); body.push(q.startsWith(' ') ? q.slice(1) : q); i++ }
      out.push({ type: 'quote', blocks: blocks(body) })
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && isAlignRow(lines[i + 1])) {
      const head = tableCells(line)
      const align = tableCells(lines[i + 1]).map(alignOf)
      i += 2
      const rows = []
      while (i < lines.length && isTableRow(lines[i])) rows.push(tableCells(lines[i++]))
      out.push({ type: 'table', align, head: head.map(inline), rows: rows.map(r => head.map((_, c) => inline(r[c] ?? ''))) })
      continue
    }
    const marker = listMarker(line)
    if (marker) {
      const list = { type: 'list', ordered: marker.ordered, start: marker.start, items: [] }
      const base = indentOf(line)
      while (i < lines.length) {
        const m = listMarker(lines[i])
        if (!m || indentOf(lines[i]) !== base || m.ordered !== list.ordered) break
        const body = [lines[i].slice(m.width)]
        i++
        // The item goes on while lines are indented past its marker, or blank
        // between such lines.
        while (i < lines.length) {
          if (isBlank(lines[i])) {
            const next = lines.slice(i + 1).find(l => !isBlank(l))
            if (next !== undefined && indentOf(next) > base && !(listMarker(next) && indentOf(next) === base)) { body.push(''); i++; continue }
            break
          }
          if (indentOf(lines[i]) > base) { body.push(lines[i].slice(Math.min(indentOf(lines[i]), m.width))); i++; continue }
          if (listMarker(lines[i]) || headingOf(lines[i]) || lines[i].trim().startsWith(FENCE) || lines[i].trim().startsWith('>')) break
          body.push(lines[i].trim()); i++   // a lazy continuation of the item's text
        }
        list.items.push(blocks(body))
        while (i < lines.length && isBlank(lines[i]) && listMarker(lines.slice(i).find(l => !isBlank(l)) ?? '') && indentOf(lines.slice(i).find(l => !isBlank(l))) === base) i++
      }
      out.push(list)
      continue
    }
    // A paragraph, to a blank line or the start of another block.
    const para = [t]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !headingOf(lines[i]) && !lines[i].trim().startsWith(FENCE) && !lines[i].trim().startsWith('>')
      && !listMarker(lines[i]) && !(lines[i].trim().startsWith('$$')) && !(isTableRow(lines[i]) && isAlignRow(lines[i + 1] ?? ''))) para.push(lines[i++].trim())
    out.push({ type: 'paragraph', inline: inline(para.join('\n')) })
  }
  return out
}

function safeHref(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Inline marks: **bold**, *italic*, `code`, [words](a web address), $maths$, \(maths\), line breaks. */
export function inline(text) {
  const out = []
  let plain = ''
  const flush = () => { if (plain) { out.push({ type: 'text', text: plain }); plain = '' } }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') { flush(); out.push({ type: 'break' }); i++; continue }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) { flush(); out.push({ type: 'code', text: text.slice(i + 1, end) }); i = end + 1; continue }
    }
    if (text.startsWith('$$', i)) {
      const end = text.indexOf('$$', i + 2)
      if (end > i + 2) { flush(); out.push({ type: 'math', tex: text.slice(i + 2, end).trim(), display: true }); i = end + 2; continue }
    }
    if (text.startsWith('\\(', i)) {
      const end = text.indexOf('\\)', i + 2)
      if (end > i + 2) { flush(); out.push({ type: 'math', tex: text.slice(i + 2, end).trim() }); i = end + 2; continue }
    }
    if (text.startsWith('\\[', i)) {
      const end = text.indexOf('\\]', i + 2)
      if (end > i + 2) { flush(); out.push({ type: 'math', tex: text.slice(i + 2, end).trim(), display: true }); i = end + 2; continue }
    }
    // A backslash before a mark makes it plain text (after \( and \[, which are maths).
    if (ch === '\\' && i + 1 < text.length && '\\`*_[]$#|'.includes(text[i + 1])) { plain += text[i + 1]; i += 2; continue }
    // $maths$: the marks hug the maths, and "$5 and $10" stays a price.
    if (ch === '$' && text[i + 1] && text[i + 1] !== ' ' && text[i + 1] !== '$') {
      let end = text.indexOf('$', i + 1)
      while (end !== -1 && text[end - 1] === '\\') end = text.indexOf('$', end + 1)
      const after = text[end + 1]
      if (end > i + 1 && text[end - 1] !== ' ' && !(after >= '0' && after <= '9') && !text.slice(i, end).includes('\n\n')) {
        flush(); out.push({ type: 'math', tex: text.slice(i + 1, end) }); i = end + 1; continue
      }
    }
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const mark = text.slice(i, i + 2)
      const end = text.indexOf(mark, i + 2)
      if (end > i + 2 && text[i + 2] !== ' ') { flush(); out.push({ type: 'strong', children: inline(text.slice(i + 2, end)) }); i = end + 2; continue }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] && text[i + 1] !== ' ' && text[i + 1] !== ch) {
      // _ only at a word's edge, so snake_case stays as written.
      const edge = ch === '*' || i === 0 || ' (\n'.includes(text[i - 1])
      const end = text.indexOf(ch, i + 1)
      if (edge && end > i + 1 && text[end - 1] !== ' ' && (ch === '*' || !text[end + 1] || !/[A-Za-z0-9]/.test(text[end + 1]))) {
        flush(); out.push({ type: 'em', children: inline(text.slice(i + 1, end)) }); i = end + 1; continue
      }
    }
    if (ch === '[') {
      const close = text.indexOf('](', i + 1)
      const end = close === -1 ? -1 : text.indexOf(')', close + 2)
      const href = end === -1 ? null : safeHref(text.slice(close + 2, end))
      if (href && !text.slice(i + 1, close).includes('[')) { flush(); out.push({ type: 'link', href, children: inline(text.slice(i + 1, close)) }); i = end + 1; continue }
    }
    if (text.startsWith('https://', i) || text.startsWith('http://', i)) {
      let end = i
      while (end < text.length && !' \n)<>"'.includes(text[end])) end++
      while (end > i && '.,;:!?'.includes(text[end - 1])) end--
      const href = safeHref(text.slice(i, end))
      if (href) { flush(); out.push({ type: 'link', href, children: [{ type: 'text', text: text.slice(i, end) }] }); i = end; continue }
    }
    plain += ch
    i++
  }
  flush()
  return out
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/**
 * @param {Array<object>} tree from parse()
 * @param {{ doc: Document, katex?: { render: Function } | null }} env
 * @returns {DocumentFragment}
 */
export function render(tree, { doc, katex = null }) {
  const frag = doc.createDocumentFragment()
  for (const b of tree) frag.append(block(b, doc, katex))
  return frag
}

function math(tex, display, doc, katex) {
  const box = doc.createElement(display ? 'div' : 'span')
  box.className = display ? 'md-math md-math-block' : 'md-math'
  if (katex) {
    try {
      katex.render(tex, box, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', output: 'htmlAndMathml' })
      return box
    } catch (err) {
      box.title = `Couldn't draw this: ${err?.message ?? 'not valid LaTeX'}`
    }
  }
  // Not drawable: shown as written, marked, so nothing is silently lost.
  box.classList.add('md-math-raw')
  box.textContent = tex
  return box
}

function inlineNodes(parent, nodes, doc, katex) {
  for (const n of nodes) {
    if (n.type === 'text') parent.append(doc.createTextNode(n.text))
    else if (n.type === 'break') parent.append(doc.createElement('br'))
    else if (n.type === 'code') { const c = doc.createElement('code'); c.textContent = n.text; parent.append(c) }
    else if (n.type === 'math') parent.append(math(n.tex, Boolean(n.display), doc, katex))
    else if (n.type === 'strong' || n.type === 'em') { const e = doc.createElement(n.type); inlineNodes(e, n.children, doc, katex); parent.append(e) }
    else if (n.type === 'link') {
      const a = doc.createElement('a')
      a.href = n.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = n.href
      inlineNodes(a, n.children, doc, katex)
      parent.append(a)
    }
  }
  return parent
}

function block(b, doc, katex) {
  switch (b.type) {
    case 'heading': {
      const h = doc.createElement(`h${Math.min(6, b.level + 2)}`)
      h.className = 'md-h'
      return inlineNodes(h, b.inline, doc, katex)
    }
    case 'paragraph': return inlineNodes(doc.createElement('p'), b.inline, doc, katex)
    case 'hr': return doc.createElement('hr')
    case 'math': return math(b.tex, true, doc, katex)
    case 'code': {
      const pre = doc.createElement('pre')
      pre.className = 'md-code'
      pre.tabIndex = 0
      if (b.lang) pre.dataset.lang = b.lang
      const code = doc.createElement('code')
      code.textContent = b.text
      pre.append(code)
      return pre
    }
    case 'quote': {
      const q = doc.createElement('blockquote')
      for (const inner of b.blocks) q.append(block(inner, doc, katex))
      return q
    }
    case 'list': {
      const l = doc.createElement(b.ordered ? 'ol' : 'ul')
      if (b.ordered && b.start !== 1) l.start = b.start
      for (const item of b.items) {
        const li = doc.createElement('li')
        // A one-paragraph item is drawn tight, without its paragraph's margins.
        if (item.length === 1 && item[0].type === 'paragraph') inlineNodes(li, item[0].inline, doc, katex)
        else for (const inner of item) li.append(block(inner, doc, katex))
        l.append(li)
      }
      return l
    }
    case 'table': {
      const wrap = doc.createElement('div')
      wrap.className = 'md-table'
      wrap.tabIndex = 0
      const table = doc.createElement('table')
      const head = doc.createElement('thead'), hr = doc.createElement('tr')
      b.head.forEach((cell, c) => { const th = doc.createElement('th'); if (b.align[c]) th.style.textAlign = b.align[c]; hr.append(inlineNodes(th, cell, doc, katex)) })
      head.append(hr)
      const body = doc.createElement('tbody')
      for (const row of b.rows) {
        const tr = doc.createElement('tr')
        row.forEach((cell, c) => { const td = doc.createElement('td'); if (b.align[c]) td.style.textAlign = b.align[c]; tr.append(inlineNodes(td, cell, doc, katex)) })
        body.append(tr)
      }
      table.append(head, body)
      wrap.append(table)
      return wrap
    }
    default: {
      const p = doc.createElement('p')
      p.textContent = ''
      return p
    }
  }
}

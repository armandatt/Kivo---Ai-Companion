// Bug batch 28 Nov, item 10: a ChatGPT answer pasted into a note keeps its
// structure as Markdown and drops inline fonts and colours. Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasStructure, htmlToMarkdown, type PasteNode } from './paste-markdown'

const text = (t: string): PasteNode => ({ nodeType: 3, nodeName: '#text', textContent: t, childNodes: [] })
const el = (name: string, children: PasteNode[] = [], attrs: Record<string, string> = {}): PasteNode => ({
  nodeType: 1, nodeName: name.toUpperCase(), childNodes: children,
  get textContent() { return children.map(c => c.textContent ?? '').join('') },
  getAttribute: (k: string) => attrs[k] ?? null,
})

test('REGRESSION item 10: headings, bold, lists, code, quotes, links and tables survive; styling does not', () => {
  const doc = el('body', [
    el('h2', [text('What WACC measures')]),
    el('p', [el('span', [text('It is the ')], { style: 'font-family: Söhne; color: #ececec' }), el('strong', [text('discount rate')]), text(' for the firm.')]),
    el('ol', [el('li', [el('p', [text('Equity')]), el('ul', [el('li', [text('at market value')])])]), el('li', [text('Debt')])]),
    el('pre', [el('code', [text('wacc = e/v*re\n')])]),
    el('blockquote', [el('p', [text('Use market values.')])]),
    el('p', [el('a', [text('source')], { href: 'https://example.com/wacc' }), text(' and '), el('code', [text('Re')])]),
    el('table', [el('tbody', [el('tr', [el('th', [text('Input')]), el('th', [text('Value')])]), el('tr', [el('td', [text('Re')]), el('td', [text('14%')])])])]),
  ])
  assert.equal(htmlToMarkdown(doc), [
    '## What WACC measures',
    'It is the **discount rate** for the firm.',
    '1. Equity\n  - at market value\n2. Debt',
    '```\nwacc = e/v*re\n```',
    '> Use market values.',
    '[source](https://example.com/wacc) and `Re`',
    '| Input | Value |\n| --- | --- |\n| Re | 14% |',
  ].join('\n\n'))
})

test('only HTML with structure is converted; a plain run of text pastes as text', () => {
  assert.equal(hasStructure('<span style="color:red">just words</span>'), false)
  assert.equal(hasStructure('<h3>A heading</h3>'), true)
  assert.equal(hasStructure('<ul><li>x</li></ul>'), true)
})

test('a javascript: link keeps its words and loses its address', () => {
  assert.equal(htmlToMarkdown(el('body', [el('p', [el('a', [text('click')], { href: 'javascript:alert(1)' })])])), 'click')
})

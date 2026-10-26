// Reading a note's text into blocks, and the toolbar's edits. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import { calloutHeader, inlineTokens, outline, parseBlocks as parseWithSpans, sourceOf, tagsOf, wordCount, type Block } from './note-blocks'
import { callout, divider, noteLink, prefixLines, tag, wrap } from './note-format'
import { filterNotes, groupNotes } from './notes-tree-data'

// The blocks' shape, without where each sits in the text (tested on its own below).
const bare = (b: Block): Block => { const rest = { ...b }; delete rest.at; delete rest.to; return rest.kind === 'callout' ? { ...rest, body: rest.body.map(bare) } : rest }
const parseBlocks = (body: string) => parseWithSpans(body).map(bare)

test('a callout: its type, its title and its > lines as its body', () => {
  const blocks = parseBlocks('> [!quote] Vaswani et al.\n> The dominant sequence transduction models\n> are based on RNNs.\n\nMy take: attention replaces recurrence.')
  assert.equal(blocks.length, 2)
  const [c, p] = blocks
  assert.equal(c!.kind, 'callout')
  if (c!.kind !== 'callout') return
  assert.equal(c.type, 'quote')
  assert.equal(c.title, 'Vaswani et al.')
  assert.equal(c.fold, null)
  assert.deepEqual(c.body, [{ kind: 'para', lines: ['The dominant sequence transduction models', 'are based on RNNs.'] }])
  assert.deepEqual(p, { kind: 'para', lines: ['My take: attention replaces recurrence.'] })
})

test('callout names: aliases, folding, an unknown type keeps its word, and a plain quote stays a quote', () => {
  assert.deepEqual(calloutHeader('[!TIP]'), { type: 'idea', fold: null, title: 'Idea' })
  assert.deepEqual(calloutHeader('[!question]- Why scale by √d?'), { type: 'question', fold: 'closed', title: 'Why scale by √d?' })
  assert.deepEqual(calloutHeader('[!faq]+'), { type: 'question', fold: 'open', title: 'Question' })
  assert.deepEqual(calloutHeader('[!callout]'), { type: 'note', fold: null, title: 'Callout' })
  assert.equal(calloutHeader('[! spaced out]'), null)
  assert.equal(calloutHeader('just a quote'), null)
  assert.deepEqual(parseBlocks('> one\n> two'), [{ kind: 'quote', lines: ['one', 'two'] }])
})

test('inside a callout: lists, a blank > line and a nested callout', () => {
  const [c] = parseBlocks('> [!summary]\n> - one\n> - two\n>\n> > [!warning] Careful\n> > not O(n)')
  assert.equal(c!.kind, 'callout')
  if (c!.kind !== 'callout') return
  assert.equal(c.body[0]!.kind, 'list')
  const nested = c.body[1]!
  assert.equal(nested.kind, 'callout')
  if (nested.kind === 'callout') assert.deepEqual([nested.type, nested.title, nested.body], ['warning', 'Careful', [{ kind: 'para', lines: ['not O(n)'] }]])
})

test('headings, lists, rules and code, as before', () => {
  const blocks = parseBlocks('# Idea\nText\n- a\n* b\n1. c\n---\n```\n# not a heading\n```')
  assert.deepEqual(blocks.map(b => b.kind), ['heading', 'para', 'list', 'list', 'rule', 'code'])
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, items: ['a', 'b'] })
  assert.deepEqual(blocks[5], { kind: 'code', text: '# not a heading' })
})

test('the outline: every heading, with anchors that are unique', () => {
  const o = outline(parseBlocks('# Idea and background\n## Attention\n## Attention\n### Q, K & V!'))
  assert.deepEqual(o.map(h => [h.level, h.id]), [[1, 'idea-and-background'], [2, 'attention'], [2, 'attention-2'], [3, 'q-k-v']])
})

test('inline marks: bold, italic, highlight, code, tags and addresses', () => {
  assert.deepEqual(inlineTokens('**big** and *small* and ==key== and `x` #CallOut https://arxiv.org/abs/1706.03762.'), [
    { kind: 'bold', text: 'big' }, { kind: 'text', text: ' and ' }, { kind: 'italic', text: 'small' }, { kind: 'text', text: ' and ' },
    { kind: 'highlight', text: 'key' }, { kind: 'text', text: ' and ' }, { kind: 'code', text: 'x' }, { kind: 'text', text: ' ' },
    { kind: 'tag', text: 'CallOut' }, { kind: 'text', text: ' ' },
    { kind: 'url', text: 'https://arxiv.org/abs/1706.03762', href: 'https://arxiv.org/abs/1706.03762' }, { kind: 'text', text: '.' },
  ])
})

test('what is not a mark stays text: arithmetic, C#, #1, a lone ==', () => {
  for (const s of ['2 * 3 * 4', 'C# and F#', 'item #1', 'a == b', 'x ** y', 'javascript:alert(1)']) {
    assert.deepEqual(inlineTokens(s), [{ kind: 'text', text: s }], s)
  }
})

test('the source line: its address and host, only for web addresses', () => {
  assert.deepEqual(sourceOf('Source: Attention paper https://www.arxiv.org/pdf/1706.03762\n\n# What it says'),
    { url: 'https://www.arxiv.org/pdf/1706.03762', view: 'https://www.arxiv.org/pdf/1706.03762', label: 'arxiv.org', pdf: true })
  // An arXiv abstract page won't be shown in a frame: its PDF is.
  assert.deepEqual(sourceOf('Source: https://arxiv.org/abs/1706.03762v7'),
    { url: 'https://arxiv.org/abs/1706.03762v7', view: 'https://arxiv.org/pdf/1706.03762v7', label: 'arxiv.org', pdf: true })
  assert.deepEqual(sourceOf('Source: https://en.wikipedia.org/wiki/Attention'),
    { url: 'https://en.wikipedia.org/wiki/Attention', view: 'https://en.wikipedia.org/wiki/Attention', label: 'en.wikipedia.org', pdf: false })
  assert.equal(sourceOf('Source: https://example.com/notes/Lecture3.PDF')?.pdf, true)
  assert.equal(sourceOf('Source: \n# What it says'), null)
  assert.equal(sourceOf('Source: ftp://example.com/x'), null)
  assert.equal(sourceOf('Not a source: https://example.com'), null)
})

test('words and tags of a note; a tag in code is not a tag', () => {
  assert.equal(wordCount('# Idea\n\nAttention is all you need — 8 heads'), 8)
  assert.deepEqual(tagsOf('#ml notes on #Attention\n```\n#notatag\n```\nmore #ML'), ['ml', 'Attention'])
})

// ── The toolbar ──────────────────────────────────────────────────────────────

test('wrap marks the selection, unmarks it when pressed again, and offers a placeholder', () => {
  assert.deepEqual(wrap('one two', 4, 7, '==', 'highlight'), { text: 'one ==two==', start: 6, end: 9 })
  assert.deepEqual(wrap('one ==two==', 6, 9, '==', 'highlight'), { text: 'one two', start: 4, end: 7 })
  assert.deepEqual(wrap('ab', 1, 1, '**', 'bold'), { text: 'a**bold**b', start: 3, end: 7 })
})

test('prefixLines puts a mark on each line, takes it off again, and swaps heading levels', () => {
  assert.equal(prefixLines('a\nb\nc', 0, 3, '- ').text, '- a\n- b\nc')
  assert.equal(prefixLines('- a\n- b', 0, 7, '- ').text, 'a\nb')
  assert.equal(prefixLines('## Title', 3, 3, '# ').text, '# Title')
  assert.equal(prefixLines('x\ny', 0, 3, '1. ').text, '1. x\n2. y')
})

test('callout: a pasted passage becomes the callout, and the cursor waits under it for your words', () => {
  const text = 'Intro\n\nThe dominant models\nuse attention.\n\nMore'
  const from = text.indexOf('The'), to = text.indexOf('.') + 1
  const out = callout(text, from, to, 'quote')
  assert.equal(out.text, 'Intro\n\n> [!quote] From the source\n> The dominant models\n> use attention.\n\n\n\nMore')
  assert.equal(out.start, out.end)
  // On the empty line between the callout and what followed.
  assert.equal(out.text.slice(out.start - 2, out.start + 2), '\n\n\n\n')
  assert.equal(out.text.slice(0, out.start).endsWith('attention.\n\n'), true)
  assert.deepEqual(parseBlocks(out.text).map(b => b.kind), ['para', 'callout', 'para'])
  // At the end of the note there is nothing after it.
  assert.equal(callout('quote this', 0, 10, 'quote').text, '> [!quote] From the source\n> quote this\n\n')
})

test('callout with nothing selected opens an empty one on its own line', () => {
  const out = callout('Some text', 9, 9, 'idea')
  assert.equal(out.text, 'Some text\n\n> [!idea] Idea\n> ')
  assert.equal(out.start, out.text.length)
  assert.equal(callout('', 0, 0, 'question').text, '> [!question] Question\n> ')
})

test('note links, tags and dividers', () => {
  assert.deepEqual(noteLink('see Deadlocks', 4, 13), { text: 'see [[Deadlocks]]', start: 17, end: 17 })
  assert.deepEqual(noteLink('', 0, 0), { text: '[[]]', start: 2, end: 2 })
  assert.deepEqual(tag('about self attention', 6, 20), { text: 'about #self-attention', start: 7, end: 21 })
  assert.equal(divider('text', 4).text, 'text\n\n---\n\n')
})

// ── The notebook ─────────────────────────────────────────────────────────────

const note = (id: string, subjectName: string | null, topicName: string | null, title = id): NoteSummary =>
  ({ id, title, subjectId: subjectName ? `s-${subjectName}` : null, subjectName, topicName, preview: '', createdAt: '', updatedAt: '' })

test('the notebook: subjects by name with no-subject last, notes under the subject alone first, then topics by name', () => {
  const groups = groupNotes([note('a', 'OS', 'Paging'), note('b', null, null), note('c', 'DL', 'CNNs'), note('d', 'OS', null), note('e', 'OS', 'deadlocks'), note('f', 'OS', 'Deadlocks')])
  assert.deepEqual(groups.map(g => [g.subjectName, g.count]), [['DL', 1], ['OS', 4], [null, 1]])
  assert.deepEqual(groups[1]!.topics.map(t => [t.topic, t.notes.map(n => n.id)]), [[null, ['d']], ['deadlocks', ['e', 'f']], ['Paging', ['a']]])
})

test('finding a note: every word, in its title, subject or topic', () => {
  const notes = [note('a', 'Deep Learning', 'Attention', 'Transformers'), note('b', 'OS', 'Paging', 'TLB misses')]
  assert.deepEqual(filterNotes(notes, 'deep trans').map(n => n.id), ['a'])
  assert.deepEqual(filterNotes(notes, 'paging').map(n => n.id), ['b'])
  assert.equal(filterNotes(notes, '  ').length, 2)
})

test('each top-level block knows where it is in the text, so a passage Nova cites is found on the page', () => {
  const body = '# Title\n\nFirst para\nsecond line\n\n- a\n- b\n\n> [!idea] Hm\n> inside\n\n```\ncode\n```'
  const blocks = parseWithSpans(body)
  assert.deepEqual(blocks.map(b => body.slice(b.at, b.to)), ['# Title', 'First para\nsecond line', '- a\n- b', '> [!idea] Hm\n> inside', '```\ncode\n```'])
  // Inside a callout: none (the callout is what is found).
  const c = blocks[3]!
  assert.ok(c.kind === 'callout' && c.body.every(x => x.at === undefined))
})

test('a table: its head and rows; a line of pipes without a rule under the head stays text', () => {
  const [t] = parseBlocks('| Algorithm | Greedy |\n| --- | :-: |\n| Dijkstra | yes |\n| Bellman-Ford | no |')
  assert.deepEqual(t, { kind: 'table', head: ['Algorithm', 'Greedy'], rows: [['Dijkstra', 'yes'], ['Bellman-Ford', 'no']] })
  assert.equal(parseBlocks('| not | a table |')[0]!.kind, 'para')
})

test('maths: $$ blocks with their number, $inline$, and prices left as written', () => {
  const blocks = parseBlocks('$$\n\\mathrm{softmax}(QK^T)V\n$$ (1)\n\nOne line: $$E=mc^2$$\n\nCosts $5 and $10, while $h_{t}$ depends on $h_{t-1}$.')
  assert.deepEqual(blocks[0], { kind: 'math', tex: '\\mathrm{softmax}(QK^T)V', tag: '(1)' })
  assert.equal(blocks[1]!.kind, 'para')
  const tokens = inlineTokens('Costs $5 and $10, while $h_{t}$ depends on $h_{t-1}$.')
  assert.deepEqual(tokens.filter(t => t.kind === 'math').map(t => t.text), ['h_{t}', 'h_{t-1}'])
  assert.ok(tokens.some(t => t.kind === 'text' && t.text.includes('$5 and $10')))
})

test('a paper card is a paper callout, and its Source line opens beside the note', () => {
  const body = '> [!paper] Attention Is All You Need\n> **Authors:** A, B\n> **Source:** https://arxiv.org/abs/1706.03762\n\n## Abstract\n\nText.'
  const [card] = parseBlocks(body)
  assert.equal(card!.kind === 'callout' && card.type, 'paper')
  assert.deepEqual(sourceOf(body), { url: 'https://arxiv.org/abs/1706.03762', view: 'https://arxiv.org/pdf/1706.03762', label: 'arxiv.org', pdf: true })
  assert.equal(calloutHeader('[!takeaways] Key points')?.type, 'takeaway')
})

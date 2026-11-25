// Sharing one note: files in a note's text, download names, a PDF's text. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileLine, parseBlocks } from './note-blocks'
import { downloadName, extractedSection } from './note-share-data'

test('a file kept with a note is a block of its own; only Kivo file ids, never another address', () => {
  assert.deepEqual(fileLine('[Lecture 4.pdf](kivo-file:cmabc12345xyz)'), { name: 'Lecture 4.pdf', id: 'cmabc12345xyz' })
  assert.equal(fileLine('[x](https://evil.example/a.pdf)'), null)
  assert.equal(fileLine('[x](kivo-file:../../etc)'), null)
  assert.equal(fileLine('[x](kivo-file:a1)'), null, 'a package ref is not a stored file')
  const blocks = parseBlocks('Intro\n\n[Lecture 4.pdf](kivo-file:cmabc12345xyz)\n\nAfter')
  assert.deepEqual(blocks.map(b => b.kind), ['para', 'file', 'para'])
})

test('a download keeps the name the server gave, exactly', () => {
  assert.equal(downloadName(`attachment; filename="DP _ notes.kivo"; filename*=UTF-8''DP%20%E2%80%94%20notes.kivo`, 'x.kivo'), 'DP — notes.kivo')
  assert.equal(downloadName('attachment; filename="Plain.pdf"', 'x.pdf'), 'Plain.pdf')
  assert.equal(downloadName(null, 'fallback.kivo'), 'fallback.kivo')
})

test("a PDF's text is added under a heading that says it may be incomplete", () => {
  const s = extractedSection('Line one\r\n\n\n\nLine two', 12, true)
  assert.match(s, /## Text from the PDF/)
  assert.match(s, /12 pages, the first part only/)
  assert.match(s, /the PDF above is the record/)
  assert.ok(s.includes('Line one\n\nLine two'))
})

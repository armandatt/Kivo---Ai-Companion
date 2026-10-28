// The PDF reader's arithmetic and how a passage goes into a note. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CSS_PER_POINT, captureScale, cleanPassage, clampZoom, fitZoom, inRect, pageAt, pageTops, quoteMarkdown, rectsOnPage, stepZoom, ZOOM_MAX, ZOOM_MIN } from './pdf-geometry'
import { addInto } from './reader-send'
import { sourceOf, parseBlocks } from './note-blocks'

const A4 = { w: 595, h: 842 }, LETTER = { w: 612, h: 792 }

test('zoom moves in steps, stays between 40% and 400%, and leaves a fit for the next step', () => {
  assert.equal(stepZoom(1, 1), 1.1); assert.equal(stepZoom(1, -1), 0.9)
  assert.equal(stepZoom(1.03, 1), 1.1); assert.equal(stepZoom(1.03, -1), 1)
  assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX); assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN)
  assert.equal(clampZoom(9), ZOOM_MAX); assert.equal(clampZoom(NaN), 1)
})

test('fit to width fills the reader with the widest page; fit to page shows a whole page', () => {
  const box = { width: 800, height: 600 }
  const width = fitZoom('width', [A4, LETTER], box)
  assert.ok(Math.abs(LETTER.w * CSS_PER_POINT * width - (800 - 48)) < 0.5)
  const page = fitZoom('page', [A4], box)
  assert.ok(A4.h * CSS_PER_POINT * page <= 600 - 48 + 0.5 && page < width)
  assert.equal(fitZoom('width', [], box), 1)
})

test('the page being read is the one under the reading line, at any zoom', () => {
  const tops = pageTops([A4, A4, A4], 1)
  assert.equal(pageAt(tops, 0, 800), 1)
  assert.equal(pageAt(tops, tops[1]! - 100, 800), 2)
  assert.equal(pageAt(tops, tops[2]!, 800), 3)
  const zoomed = pageTops([A4, A4, A4], 2)
  assert.ok(zoomed[1]! > tops[1]! * 1.9)
})

test('a selection becomes rectangles on its page as fractions, joined along a line, kept inside the page', () => {
  const page = { left: 100, top: 50, width: 400, height: 600 }
  const rects = rectsOnPage([
    { left: 120, top: 110, width: 80, height: 12 }, { left: 199, top: 110, width: 60, height: 12 },   // one line, two pieces
    { left: 120, top: 126, width: 500, height: 12 },                                                  // runs off the right edge
    { left: 300, top: 300, width: 0.5, height: 12 },                                                  // too small
  ], page)
  assert.equal(rects.length, 2)
  assert.ok(Math.abs(rects[0]!.x - 0.05) < 1e-9 && Math.abs(rects[0]!.w - (259 - 120) / 400) < 1e-9)
  assert.equal(rects[1]!.x + rects[1]!.w, 1)
  // At twice the size, the same words are the same fractions.
  const big = rectsOnPage([{ left: 140, top: 170, width: 160, height: 24 }], { left: 100, top: 50, width: 800, height: 1200 })
  assert.ok(Math.abs(big[0]!.x - 0.05) < 1e-9 && Math.abs(big[0]!.y - 0.1) < 1e-9)
  assert.ok(inRect({ x: 0.1, y: 0.1 + 0.005 }, big[0]!))
})

test('a selected passage reads as prose: hyphenated words joined, spaces made one', () => {
  assert.equal(cleanPassage('The gradi-\n ent flows   backwards\nthrough  layers.'), 'The gradient flows backwards through layers.')
})

test('a capture is drawn sharp whatever the zoom: a page about 1600 px wide, a small region scaled up but never past 5x', () => {
  assert.equal(Math.round(captureScale(LETTER, null) * LETTER.w), 1600)
  const half = captureScale(LETTER, { x: 0.1, y: 0.1, w: 0.5, h: 0.1 })
  assert.ok(half * LETTER.w * 0.5 >= 900 - 1)
  assert.equal(captureScale(LETTER, { x: 0, y: 0, w: 0.01, h: 0.01 }), 5)
})

test('a passage goes into a note as a quote callout naming the paper and page, linking back, never as the note\'s Source', () => {
  const md = quoteMarkdown('Attention weights are a softmax.\nOver the keys.', { title: 'Attention Is All You Need', url: 'https://arxiv.org/pdf/1706.03762#page=1' }, 4)
  assert.equal(md, '> [!quote] Attention Is All You Need · p. 4\n> Attention weights are a softmax.\n> Over the keys.\n> https://arxiv.org/pdf/1706.03762#page=4')
  const [b] = parseBlocks(md)
  assert.ok(b!.kind === 'callout' && b.type === 'quote')
  assert.equal(sourceOf(md), null)
})

test('an addition goes under My notes in a paper\'s note, at the end otherwise, and never twice', () => {
  const paper = '> [!paper] A paper\n> **Source:** https://arxiv.org/abs/1706.03762\n\n## Abstract\n\nText.\n\n## My notes\n\nMine.'
  const md = '> [!quote] A paper · p. 2\n> A passage.'
  const r = addInto(paper, md, 'Quote')
  assert.ok('body' in r)
  const body = (r as { body: string }).body
  assert.ok(body.indexOf(md) > body.indexOf('## My notes'))
  assert.ok(body.startsWith('> [!paper] A paper'))
  assert.deepEqual(addInto(body, md, 'Quote'), { already: true })
  const plain = addInto('# Notes\n\nSomething.', md, 'Quote')
  assert.ok('body' in plain && (plain as { body: string }).body.includes(md))
})

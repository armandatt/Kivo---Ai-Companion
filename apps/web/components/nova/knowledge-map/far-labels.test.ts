// Names over the map's cards and the tier they follow (lod.ts, 28 Nov 2026). Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planCardLabels, type LabelCandidate } from './far-labels'
import { LOD, tierAtZoom, tierFor } from './lod'

const topic = (id: string, text = `Topic ${id}`): LabelCandidate => ({ id, x: 0, y: 0, text, kind: 'topic', rank: 100, card: { w: 180, h: 58 } })
const subject = (id: string, plated = false): LabelCandidate => ({ id, x: 0, y: 0, text: `Subject ${id}`, kind: 'subject', rank: 0, card: { w: 208, h: 66 }, insideOnly: plated })

test('tiers from the card’s width on screen: far under 44px, close from 140px, mid between', () => {
  assert.equal(tierFor(43), 'far')
  assert.equal(tierFor(44), 'mid')
  assert.equal(tierFor(139), 'mid')
  assert.equal(tierFor(140), 'close')
  assert.equal(tierAtZoom(LOD.closeFromPx / LOD.refW), 'close')
})

test('hysteresis: a tier is entered at 1.0× its threshold and left only under 0.85×', () => {
  assert.equal(tierFor(130, 'close'), 'close', '130 > 140 × 0.85 = 119')
  assert.equal(tierFor(118, 'close'), 'mid')
  assert.equal(tierFor(139, 'mid'), 'mid', 'not up until 140')
  assert.equal(tierFor(38, 'mid'), 'mid', '38 > 44 × 0.85 = 37.4')
  assert.equal(tierFor(37, 'mid'), 'far')
  assert.equal(tierFor(43, 'far'), 'far', 'not up until 44')
  assert.equal(tierFor(20, 'close'), 'far', 'a big jump goes straight down')
})

test('far: no topic names; subject headers only (not a plated subject); always-named cards inside their card', () => {
  const k = 0.25
  const out = planCardLabels([topic('a'), topic('b'), subject('s'), subject('p', true)], k, 'far', new Set(['b']))
  assert.deepEqual(out.map(l => [l.id, l.inside]).sort(), [['b', true], ['s', false]])
  assert.equal(out.find(l => l.id === 'b')!.px, LOD.minTextPx)
})

test('mid: every card named inside, one line, cut to the card’s width', () => {
  const k = 0.4 // a 180-unit card is 72px wide: (72 - 10) / (10 × 0.6) = 10 characters
  const [l] = planCardLabels([topic('a', 'Weighted average cost of capital')], k, 'mid')
  assert.equal(l!.inside, true)
  assert.equal(l!.px, LOD.midTextPx)
  assert.ok(l!.text.length <= 10 && l!.text.endsWith('…'), l!.text)
})

test('every box keeps its name in mid: no cap a real map reaches', () => {
  const many = Array.from({ length: 1500 }, (_, i) => topic(`t${i}`))
  assert.equal(planCardLabels(many, 0.4, 'mid').length, 1500)
})

test('close: nothing over the cards, the faces say it', () => {
  assert.deepEqual(planCardLabels([topic('a'), subject('s')], 1, 'close'), [])
})

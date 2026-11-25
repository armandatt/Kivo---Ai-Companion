// Founder review #02: far out, names stay readable and never pile up.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FAR_LABEL_MAX, FAR_LABEL_PX, planFarLabels, type LabelCandidate } from './far-labels'

const subj = (id: string, x: number, y: number, rank = 0): LabelCandidate => ({ id, x, y, text: `Subject ${id}`, kind: 'subject', rank })
const top = (id: string, x: number, y: number, rank = 10): LabelCandidate => ({ id, x, y, text: `Topic ${id}`, kind: 'topic', rank })

test('names keep a fixed size on screen at any zoom', () => {
  for (const k of [0.1, 0.2, 0.35]) {
    const [l] = planFarLabels([subj('a', 0, 0)], k)
    assert.equal(l!.px, FAR_LABEL_PX.subject)
  }
})

test('every subject keeps its name when there is room, at the far-out limit too', () => {
  // Subjects 3000 map units apart: 300px apart at k = 0.1.
  const c = [subj('a', 0, 0), subj('b', 3000, 0), subj('c', 0, 3000)]
  assert.deepEqual(planFarLabels(c, 0.1).map(l => l.id).sort(), ['a', 'b', 'c'])
})

test('a topic name that would overlap a subject name is left out; subjects win', () => {
  const c = [top('t', 10, 0), subj('s', 0, 0)]
  assert.deepEqual(planFarLabels(c, 0.2).map(l => l.id), ['s'])
})

test('topics appear as the zoom gives them room, predictably', () => {
  const c = [subj('s', 0, 0), ...Array.from({ length: 6 }, (_, i) => top(`t${i}`, 0, 200 + i * 80, 10 + i))]
  const far = planFarLabels(c, 0.1).length, nearer = planFarLabels(c, 0.3).length
  assert.ok(nearer > far, `${nearer} > ${far}`)
  assert.deepEqual(planFarLabels(c, 0.3), planFarLabels([...c].reverse(), 0.3), 'same zoom, same names, whatever the order given')
})

test('a blocker (a subject plate already drawn) keeps names off it', () => {
  const plate = { minX: -50, minY: -20, maxX: 50, maxY: 20 }
  assert.equal(planFarLabels([subj('a', 0, 0)], 0.2, [plate]).length, 0)
})

test('long names are cut with an ellipsis, never run on', () => {
  const [l] = planFarLabels([{ ...subj('a', 0, 0), text: 'Computer Organisation and Architecture, second half' }], 0.2)
  assert.ok(l!.text.length <= 26 && l!.text.endsWith('…'))
})

test('a huge map stays within the cap and plans quickly', () => {
  const c: LabelCandidate[] = []
  for (let i = 0; i < 3000; i++) c.push(top(`t${i}`, (i % 60) * 260, Math.floor(i / 60) * 120, 10 + i))
  const t0 = performance.now()
  const out = planFarLabels(c, 0.34)
  const ms = performance.now() - t0
  assert.ok(out.length <= FAR_LABEL_MAX)
  assert.ok(ms < 60, `planned 3000 candidates in ${ms.toFixed(1)} ms`)
})

test('a card wide enough on screen holds its own name, cut to fit; neighbours never lose theirs', () => {
  // 20 topic cards 200 map units apart, 180 wide: at 0.44 each is 79px, the gaps 9px.
  const c = Array.from({ length: 20 }, (_, i): LabelCandidate => ({ id: `t${i}`, x: i * 200, y: 0, text: `Process topic ${i + 1}`, kind: 'topic', rank: 10, card: { w: 180, h: 58 } }))
  const out = planFarLabels(c, 0.44)
  assert.equal(out.length, 20, 'every card named')
  assert.ok(out.every(l => l.inside && l.text.length * 6.1 + 10 <= 180 * 0.44 + 1))
})

test('a note or page is named only inside its card, never beside it', () => {
  const note: LabelCandidate = { id: 'n', x: 0, y: 0, text: 'Lexers', kind: 'topic', rank: 200, card: { w: 164, h: 48 }, insideOnly: true }
  assert.equal(planFarLabels([note], 0.4).length, 1)
  assert.equal(planFarLabels([note], 0.1).length, 0)
})

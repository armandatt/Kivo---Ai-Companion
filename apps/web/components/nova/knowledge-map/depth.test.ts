// The map's depth and entrance. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { CARD_MS, EDGE_MS, LARGE_MAP, NODE_BUDGET, chooseMotion, chosenMotion, enteredBefore, entranceMode, entrancePlan, markEntered, regionsOf, thicknessOf } from './depth'

const topic = (over: Partial<Extract<MapNode, { type: 'topic' }>>) => ({
  id: 'topic:t', type: 'topic', label: 'T', subjectId: 's', subjectName: 'S', sessions: 3, level: 'developing', masteryPercent: 50, notes: 0, resources: 0, href: null, ...over,
}) as unknown as MapNode

test('thickness is read from the record: unstudied flat, mastery raises a topic, subjects stand highest', () => {
  assert.equal(thicknessOf(topic({ sessions: 0, level: null, masteryPercent: null })), 0, 'no session yet: flat (and still dashed)')
  const weak = thicknessOf(topic({ level: 'weak' })), dev = thicknessOf(topic({ level: 'developing' })), solid = thicknessOf(topic({ level: 'solid' }))
  assert.ok(weak > 0 && weak < dev && dev < solid)
  assert.ok(thicknessOf({ id: 'subject:s', type: 'subject' } as MapNode) > solid)
  assert.ok(thicknessOf(topic({ kind: 'milestone' })) > 0, 'a milestone is a stage, not unstudied')
})

const tree = new Map([['topic:a', 'subject:s'], ['topic:b', 'subject:s'], ['note:n', 'topic:a']])
const at = new Map([['subject:s', { x: 0, y: 0 }], ['topic:a', { x: 250, y: -40 }], ['topic:b', { x: 250, y: 40 }], ['note:n', { x: 500, y: -40 }], ['note:loose', { x: 0, y: 400 }]])
const ids = ['note:n', 'topic:b', 'subject:s', 'topic:a', 'note:loose']
const edges = [{ id: 'e1', from: 'subject:s', to: 'topic:a' }, { id: 'e2', from: 'subject:s', to: 'topic:b' }, { id: 'e3', from: 'topic:a', to: 'note:n' }, { id: 'gone', from: 'subject:s', to: 'topic:zzz' }]

test('the entrance follows the tree: a subject, then its topics, then their notes; a line once both cards are there', () => {
  const p = entrancePlan(ids, tree, at, edges, 'full')
  const d = (id: string) => p.node.get(id)!
  assert.ok(d('subject:s') < d('topic:a') && d('topic:a') < d('note:n'))
  assert.ok(d('topic:a') <= d('topic:b'), 'siblings in reading order')
  assert.ok(p.edge.get('e3')! > d('note:n'), 'drawn after the card it reaches')
  assert.equal(p.edge.has('gone'), false, 'a line to a card not drawn is not scheduled')
  assert.equal(p.node.size, ids.length, 'every card drawn has a place in it, loose ones too')
  assert.ok(p.total <= NODE_BUDGET.full + Math.max(CARD_MS.full, 240 + EDGE_MS.full), 'bounded, whatever the size')
  assert.ok(p.total >= 2500, `felt: ${p.total} ms`)
})

test('a deep tree is squeezed into the same time, never stretched', () => {
  const deep = Array.from({ length: 30 }, (_, i) => `topic:${i}`)
  const parent = new Map(deep.slice(1).map((id, i) => [id, deep[i]!]))
  const p = entrancePlan(deep, parent, new Map(), [], 'full')
  assert.ok(Math.max(...p.node.values()) <= NODE_BUDGET.full)
  const order = deep.map(id => p.node.get(id)!)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'still in order')
})

test('full once per session; brief on return or on a large map; none under reduced motion or when chosen', () => {
  assert.equal(entranceMode({ seen: false, reduced: false, motion: 'full', count: 40 }), 'full')
  assert.equal(entranceMode({ seen: true, reduced: false, motion: 'full', count: 40 }), 'brief')
  assert.equal(entranceMode({ seen: false, reduced: false, motion: 'full', count: LARGE_MAP + 1 }), 'brief')
  assert.equal(entranceMode({ seen: false, reduced: true, motion: 'full', count: 40 }), 'none')
  assert.equal(entranceMode({ seen: false, reduced: false, motion: 'reduced', count: 40 }), 'none')
})

test('a subject region holds its whole tree and nothing filed elsewhere', () => {
  const nodes = ids.map(id => ({ id, type: id.split(':')[0] as MapNode['type'] }))
  const [r, ...more] = regionsOf(nodes, tree, at)
  assert.equal(more.length, 0, 'one subject, one region; a loose note has none')
  assert.equal(r!.id, 'subject:s')
  assert.ok(r!.x < -104 && r!.x + r!.w > 500 + 82, 'from the subject card to the note at the far end')
  assert.ok(r!.y + r!.h < 400, 'the loose note is not inside it')
})

test('two subjects packed close never share ground', () => {
  const nodes = [{ id: 'subject:a', type: 'subject' as const }, { id: 'subject:b', type: 'subject' as const }]
  const pos = new Map([['subject:a', { x: 0, y: 0 }], ['subject:b', { x: 0, y: 66 + 36 }]])   // 36 apart, as the layout packs them
  const [a, b] = regionsOf(nodes, new Map(), pos)
  assert.ok(a!.y + a!.h <= b!.y, 'the upper one ends before the lower one starts')
})

function memoryStore() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }
const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') } }

test('motion and "seen" are remembered per device, and a store that refuses is survived', () => {
  const s = memoryStore()
  assert.equal(chosenMotion(s), 'full')
  chooseMotion(s, 'reduced'); assert.equal(chosenMotion(s), 'reduced')
  assert.equal(enteredBefore(s, 'all/root'), false)
  markEntered(s, 'all/root'); assert.equal(enteredBefore(s, 'all/root'), true)
  assert.equal(enteredBefore(s, 'ws/root'), false)
  assert.equal(chosenMotion(broken), 'full'); assert.equal(enteredBefore(broken, 'x'), false)
  assert.doesNotThrow(() => { chooseMotion(broken, 'reduced'); markEntered(broken, 'x') })
})

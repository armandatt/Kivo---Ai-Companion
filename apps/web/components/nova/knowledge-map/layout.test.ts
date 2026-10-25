// Where the map draws each card. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { CARD, layoutMap, withPositions } from './layout'

const subject = (id: string): MapNode => ({ id: `subject:${id}`, type: 'subject', label: id, href: null, subjectId: id, topics: 0, notes: 0, resources: 0 })
const topic = (id: string, s: string): MapNode => ({ id: `topic:${id}`, type: 'topic', label: id, href: null, subjectId: s, subjectName: s, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 })
const note = (id: string, s: string | null): MapNode => ({ id: `note:${id}`, type: 'note', label: id, href: null, subjectId: s, subjectName: s, topicName: null, topicLinked: false, updatedAt: '2026-10-01T00:00:00Z' })
const edge = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })

function world() {
  const nodes: MapNode[] = [subject('os'), subject('db')]
  const edges: MapEdge[] = []
  for (const [s, count] of [['os', 5], ['db', 3]] as const) {
    for (let i = 0; i < count; i++) {
      const t = topic(`${s}${i}`, s)
      nodes.push(t)
      edges.push(edge(`subject:${s}`, t.id, 'has_topic'))
      for (let j = 0; j < i * 2; j++) { const n = note(`${s}${i}n${j}`, s); nodes.push(n); edges.push(edge(t.id, n.id, 'about_topic')) }
    }
    for (let j = 0; j < 7; j++) { const n = note(`${s}d${j}`, s); nodes.push(n); edges.push(edge(`subject:${s}`, n.id, 'filed_under')) }
  }
  nodes.push(note('loose1', null), note('loose2', null))
  return { nodes, edges }
}

const overlap = (a: { x: number; y: number; t: MapNode['type'] }, b: { x: number; y: number; t: MapNode['type'] }) =>
  Math.abs(a.x - b.x) < (CARD[a.t].w + CARD[b.t].w) / 2 && Math.abs(a.y - b.y) < (CARD[a.t].h + CARD[b.t].h) / 2

test('the same data always draws the same map, with every card placed', () => {
  const { nodes, edges } = world()
  const a = layoutMap(nodes, edges), b = layoutMap(nodes, edges)
  assert.deepEqual([...a.at.entries()], [...b.at.entries()])
  assert.equal(a.at.size, nodes.length)
  assert.ok(a.loose, 'what is filed under nothing has its own block')
})

test('no two cards are drawn on top of each other', () => {
  const { nodes, edges } = world()
  const at = layoutMap(nodes, edges).at
  const type = new Map(nodes.map(n => [n.id, n.type]))
  const placed = [...at.values()].map(p => ({ id: p.id, x: p.x, y: p.y, t: type.get(p.id)! }))
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) assert.equal(overlap(placed[i]!, placed[j]!), false, `${placed[i]!.id} and ${placed[j]!.id}`)
  }
})

test('a saved position replaces the computed one for that card only, and the bounds follow it', () => {
  const { nodes, edges } = world()
  const auto = layoutMap(nodes, edges)
  const moved = withPositions(auto, nodes, new Map([['note:os1n0', { x: 5000, y: -4000 }], ['note:not-drawn', { x: 1, y: 1 }]]))
  assert.deepEqual(moved.at.get('note:os1n0'), { id: 'note:os1n0', x: 5000, y: -4000 })
  assert.equal(moved.at.has('note:not-drawn'), false, 'a position for a card not drawn is ignored')
  for (const [id, p] of auto.at) if (id !== 'note:os1n0') assert.deepEqual(moved.at.get(id), p)
  assert.ok(moved.bounds.maxX >= 5000 + CARD.note.w / 2 && moved.bounds.minY <= -4000 - CARD.note.h / 2)
  assert.equal(withPositions(auto, nodes, new Map()), auto, 'no positions: the computed layout itself')
})

test('a portrait frame stacks the subjects, and is as deterministic as the landscape one', () => {
  const { nodes, edges } = world()
  const tall = layoutMap(nodes, edges, { portrait: true })
  assert.deepEqual([...tall.at.entries()], [...layoutMap(nodes, edges, { portrait: true }).at.entries()])
  const os = tall.at.get('subject:os')!, db = tall.at.get('subject:db')!
  assert.equal(os.x, db.x, 'one subject under another')
  const w = tall.bounds.maxX - tall.bounds.minX, h = tall.bounds.maxY - tall.bounds.minY
  assert.ok(h > w, `taller than wide: ${w} × ${h}`)
})

test('subjects inside a subject sit around it, each with its own, with nothing drawn on top of anything (Semester Five)', () => {
  const { nodes, edges } = world()
  nodes.push(subject('sem5'), subject('nlp'))
  for (let i = 0; i < 4; i++) { const t = topic(`nlp${i}`, 'nlp'); nodes.push(t); edges.push(edge('subject:nlp', t.id, 'has_topic')) }
  for (const s of ['os', 'db', 'nlp']) edges.push(edge('subject:sem5', `subject:${s}`, 'contains'))
  for (const portrait of [false, true]) {
    const { at } = layoutMap(nodes, edges, { portrait })
    assert.equal(at.size, nodes.length)
    const type = new Map(nodes.map(n => [n.id, n.type]))
    const placed = [...at.values()].map(p => ({ id: p.id, x: p.x, y: p.y, t: type.get(p.id)! }))
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) assert.equal(overlap(placed[i]!, placed[j]!), false, `${portrait ? 'portrait' : 'landscape'}: ${placed[i]!.id} and ${placed[j]!.id}`)
    }
    // Each subject inside is nearer the group than any other subject is to it, and keeps its topics around it.
    const g = at.get('subject:sem5')!, nlp = at.get('subject:nlp')!
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    for (let i = 0; i < 4; i++) assert.ok(d(at.get(`topic:nlp${i}`)!, nlp) < d(at.get(`topic:nlp${i}`)!, g), 'a topic stays by its own subject')
    // A subject inside is not also a subject filed under it.
    assert.ok(d(nlp, g) > CARD.subject.w, 'drawn on a ring, not in the block under the group')
  }
})

test('a loop of subjects on record still draws every card once', () => {
  const nodes = [subject('a'), subject('b')]
  const edges = [edge('subject:a', 'subject:b', 'contains'), edge('subject:b', 'subject:a', 'contains')]
  assert.equal(layoutMap(nodes, edges).at.size, 2)
})

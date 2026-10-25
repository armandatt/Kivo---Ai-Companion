// Where the map draws each card. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { CARD, layoutMap, treeOf, withPositions } from './layout'

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

const ordered = (id: string, s: string, order: number, parentId?: string): MapNode => ({ ...topic(id, s), order, ...(parentId ? { parentId } : {}) } as MapNode)
const task = (id: string, order: number, parentId?: string): MapNode => ({ id: `task:${id}`, type: 'task', label: id, href: null, subjectId: 'dsa', subjectName: 'dsa', topicName: null, status: 'todo', priority: null, dueDay: null, estimatedMinutes: null, order, waitsOn: 0, ...(parentId ? { parentId } : {}) })

test('a tree reads in its saved order: each level a column to the right, siblings top to bottom, never alphabetical', () => {
  const nodes: MapNode[] = [subject('dsa'), ordered('unit2', 'dsa', 1), ordered('unit1', 'dsa', 0), ordered('zeta', 'dsa', 0, 'unit1'), ordered('alpha', 'dsa', 1, 'unit1'), task('build', 0), task('step', 0, 'build')]
  const edges: MapEdge[] = [
    edge('subject:dsa', 'topic:unit2', 'has_topic'), edge('subject:dsa', 'topic:unit1', 'has_topic'),
    edge('topic:unit1', 'topic:zeta', 'subtopic'), edge('topic:unit1', 'topic:alpha', 'subtopic'),
    edge('topic:alpha', 'task:build', 'has_task'), edge('task:build', 'task:step', 'step'),
    // A wait is drawn, never laid out.
    edge('task:step', 'topic:unit2', 'depends_on' as MapEdge['kind']),
  ]
  const { at } = layoutMap(nodes, edges)
  const p = (id: string) => at.get(id)!
  assert.ok(p('topic:unit1').y < p('topic:unit2').y, 'unit 1 (order 0) above unit 2')
  assert.ok(p('topic:zeta').y < p('topic:alpha').y, 'saved order, not by name')
  assert.ok(p('subject:dsa').x < p('topic:unit1').x && p('topic:unit1').x < p('topic:zeta').x && p('topic:alpha').x < p('task:build').x && p('task:build').x < p('task:step').x, 'each level one column deeper')
  const type = new Map(nodes.map(n => [n.id, n.type]))
  const placed = [...at.values()].map(q => ({ ...q, t: type.get(q.id)! }))
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.equal(overlap(placed[i]!, placed[j]!), false, `${placed[i]!.id} and ${placed[j]!.id}`)
  // Portrait: the same tree as an indented outline, in the same order.
  const tall = layoutMap(nodes, edges, { portrait: true }).at
  const order = [...tall.values()].sort((a, b) => a.y - b.y).map(q => q.id)
  assert.deepEqual(order, ['subject:dsa', 'topic:unit1', 'topic:zeta', 'topic:alpha', 'task:build', 'task:step', 'topic:unit2'])
  assert.ok(tall.get('task:step')!.x > tall.get('task:build')!.x)
})

test('the tree under a card can be read for folding: what hangs from it, at every level', () => {
  const nodes: MapNode[] = [subject('dsa'), ordered('unit1', 'dsa', 0), ordered('t1', 'dsa', 0, 'unit1'), task('build', 0)]
  const edges: MapEdge[] = [edge('subject:dsa', 'topic:unit1', 'has_topic'), edge('topic:unit1', 'topic:t1', 'subtopic'), edge('topic:t1', 'task:build', 'has_task')]
  const { children, roots } = treeOf(nodes, edges)
  assert.deepEqual(roots, ['subject:dsa'])
  assert.deepEqual(children.get('topic:unit1'), ['topic:t1'])
  assert.deepEqual(children.get('topic:t1'), ['task:build'])
})

test('editing a note never moves its branch: notes and pages hang in name order, not in the order they arrive', () => {
  const { nodes, edges } = world()
  // The server sends notes newest first: an edit reorders them, nothing else.
  const shuffled = [...nodes.filter(n => n.type !== 'note'), ...nodes.filter(n => n.type === 'note').reverse()]
  const a = layoutMap(nodes, edges), b = layoutMap(shuffled, edges)
  for (const n of nodes) assert.deepEqual(b.at.get(n.id), a.at.get(n.id), n.id)
  const kids = treeOf(nodes, edges).children.get('topic:os4')!
  assert.deepEqual(kids, [...kids].sort((x, y) => x.localeCompare(y)))
})

test('a large map lays out quickly, the same way every time', () => {
  const nodes: MapNode[] = [], edges: MapEdge[] = []
  for (let s = 0; s < 12; s++) {
    nodes.push(subject(`s${s}`))
    for (let i = 0; i < 40; i++) {
      const t = topic(`s${s}t${i}`, `s${s}`)
      nodes.push(t); edges.push(edge(`subject:s${s}`, t.id, 'has_topic'))
      for (let j = 0; j < 4; j++) { const sub = topic(`s${s}t${i}u${j}`, `s${s}`); nodes.push(sub); edges.push(edge(t.id, sub.id, 'subtopic')) }
    }
  }
  const started = performance.now()
  const a = layoutMap(nodes, edges)
  const ms = performance.now() - started
  assert.equal(a.at.size, nodes.length)
  assert.ok(ms < 1000, `${nodes.length} cards took ${Math.round(ms)} ms`)
  assert.deepEqual([...layoutMap(nodes, edges).at.entries()], [...a.at.entries()])
})

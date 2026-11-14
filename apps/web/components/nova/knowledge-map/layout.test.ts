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

const noOverlap = (nodes: MapNode[], at: Map<string, { x: number; y: number }>) => {
  const type = new Map(nodes.map(n => [n.id, n.type]))
  const list = [...at.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, t: type.get(id)! }))
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.equal(overlap(list[i]!, list[j]!), false, `${list[i]!.id} and ${list[j]!.id}`)
}
const boxOf = (at: Map<string, { x: number; y: number }>) => {
  const xs = [...at.values()].map(p => p.x), ys = [...at.values()].map(p => p.y)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

test('a subject with many topics is not one long column: they sit on both its sides, wrapped, in their order', () => {
  const nodes: MapNode[] = [subject('ml')], edges: MapEdge[] = []
  for (let i = 0; i < 40; i++) { const t = topic(`t${String(i).padStart(2, '0')}`, 'ml'); nodes.push(t); edges.push(edge('subject:ml', t.id, 'has_topic')) }
  const { at, left } = layoutMap(nodes, edges)
  noOverlap(nodes, at)
  const s = at.get('subject:ml')!
  const right = nodes.slice(1).filter(n => at.get(n.id)!.x > s.x), leftSide = nodes.slice(1).filter(n => at.get(n.id)!.x < s.x)
  assert.equal(right.length, 20, 'half to its right')
  assert.equal(leftSide.length, 20, 'half to its left')
  assert.deepEqual(leftSide.map(n => n.id), [...left!].sort(), 'the layout says which cards are on the left')
  assert.equal(new Set(right.map(n => at.get(n.id)!.x)).size, 3, 'each side a few short columns')
  const { w, h } = boxOf(at)
  assert.ok(h < 40 * 58 / 4, `height ${h} far under a single column`)
  assert.ok(w / h < 4.5, `not a wide strip either: ${Math.round(w)}×${Math.round(h)}`)
  // Each side reads outward column by column, top to bottom: the saved order, the first half to the right.
  const out = (ids: MapNode[]) => ids.map(n => n.id).sort((a, b) => Math.abs(at.get(a)!.x - s.x) - Math.abs(at.get(b)!.x - s.x) || at.get(a)!.y - at.get(b)!.y)
  assert.deepEqual([...out(right), ...out(leftSide)], nodes.slice(1).map(n => n.id))
  // The subject sits level with the middle of what hangs from it.
  const ys = right.map(n => at.get(n.id)!.y)
  assert.equal(s.y, (Math.min(...ys) + Math.max(...ys)) / 2)
})

test('a few topics keep one side; from four branches they sit around their subject, by weight', () => {
  const build = (count: number, deep = -1) => {
    const nodes: MapNode[] = [subject('os')], edges: MapEdge[] = []
    for (let i = 0; i < count; i++) {
      const t = topic(`u${i}`, 'os'); nodes.push(t); edges.push(edge('subject:os', t.id, 'has_topic'))
      if (i === deep) for (let j = 0; j < 6; j++) { const u = topic(`u${i}s${j}`, 'os'); nodes.push(u); edges.push(edge(t.id, u.id, 'subtopic')) }
    }
    return { nodes, edges, ...layoutMap(nodes, edges) }
  }
  const three = build(3)
  assert.equal(new Set(three.nodes.slice(1).map(n => three.at.get(n.id)!.x)).size, 1, 'three topics: one column, as before')
  assert.equal(three.left!.size, 0)
  const five = build(5)
  const sx = five.at.get('subject:os')!.x
  assert.deepEqual(five.nodes.slice(1).map(n => Math.sign(five.at.get(n.id)!.x - sx)), [1, 1, 1, -1, -1], 'in order: the first to the right')
  // A heavy first branch weighs a side on its own.
  const heavy = build(5, 0)
  assert.deepEqual(['topic:u0', 'topic:u1', 'topic:u4'].map(id => Math.sign(heavy.at.get(id)!.x - heavy.at.get('subject:os')!.x)), [1, -1, -1])
  noOverlap(heavy.nodes, heavy.at)
  // The left side is the same tree, mirrored: a subtopic further out than its topic.
  const deepLeft = build(5, 4)
  assert.ok(deepLeft.at.get('topic:u4s0')!.x < deepLeft.at.get('topic:u4')!.x)
})

test('many subjects pack into rows toward a balanced shape, uneven and deep branches never overlapping', () => {
  const nodes: MapNode[] = [], edges: MapEdge[] = []
  for (let s = 0; s < 10; s++) {
    nodes.push(subject(`s${s}`))
    const count = [2, 14, 5, 1, 30, 3, 9, 0, 6, 11][s]!
    for (let i = 0; i < count; i++) {
      const t = topic(`s${s}t${i}`, `s${s}`); nodes.push(t); edges.push(edge(`subject:s${s}`, t.id, 'has_topic'))
      // Some topics have topics inside, some with long runs of their own.
      if (i % 4 === 0) for (let j = 0; j < (i % 8 === 0 ? 9 : 2); j++) { const u = topic(`s${s}t${i}u${j}`, `s${s}`); nodes.push(u); edges.push(edge(t.id, u.id, 'subtopic')) }
      if (i === 1) { const n = note(`s${s}n${i}-a-very-long-note-title-that-is-truncated-on-its-card`, `s${s}`); nodes.push(n); edges.push(edge(t.id, n.id, 'about_topic')) }
    }
  }
  const a = layoutMap(nodes, edges)
  noOverlap(nodes, a.at)
  const { w, h } = boxOf(a.at)
  assert.ok(w / h > 0.6 && w / h < 3.5, `shape ${Math.round(w)}×${Math.round(h)}`)
  const roots = nodes.filter(n => n.type === 'subject').map(n => a.at.get(n.id)!.x)
  assert.ok(new Set(roots).size > 1, 'subjects sit side by side')
  const rowsY = new Set(nodes.filter(n => n.type === 'subject').map(n => Math.round(a.at.get(n.id)!.y)))
  assert.ok(rowsY.size > 1, 'and in more than one row')
  assert.deepEqual([...layoutMap(nodes, edges).at.entries()], [...a.at.entries()], 'the same data, the same map')
})

test('lines into wrapped columns run along the gaps, on either side, and only while the card is where the layout put it', () => {
  const nodes: MapNode[] = [subject('ml')], edges: MapEdge[] = []
  for (let i = 0; i < 28; i++) { const t = topic(`t${String(i).padStart(2, '0')}`, 'ml'); nodes.push(t); edges.push(edge('subject:ml', t.id, 'has_topic')) }
  const auto = layoutMap(nodes, edges)
  const s = auto.at.get('subject:ml')!
  let laned = 0
  for (const dir of [1, -1]) {
    const mine = nodes.slice(1).filter(n => Math.sign(auto.at.get(n.id)!.x - s.x) === dir)
    const inner = Math.min(...mine.map(n => Math.abs(auto.at.get(n.id)!.x - s.x)))
    for (const n of mine) {
      const p = auto.at.get(n.id)!, lane = auto.lanes!.get(n.id)
      if (Math.abs(p.x - s.x) === inner) { assert.equal(lane, undefined, 'the first column is reached directly'); continue }
      laned++
      const t = Math.abs(lane!.trunkX - s.x)
      assert.ok(lane && t < inner - CARD.topic.w / 2 && t > CARD.subject.w / 2, 'the trunk sits in the gap before the first column')
      for (const o of nodes.slice(1)) { const q = auto.at.get(o.id)!; assert.ok(Math.abs(lane!.laneY - q.y) >= CARD.topic.h / 2, `${n.id}'s lane clears ${o.id}`) }
    }
  }
  assert.ok(laned > 0)
  const moved = withPositions(auto, nodes, new Map([['topic:t13', { x: 9000, y: 9000 }]]))
  const l = moved.lanes!.get('topic:t13')!
  assert.notDeepEqual([l.x, l.y], [moved.at.get('topic:t13')!.x, moved.at.get('topic:t13')!.y], 'a moved card no longer matches its lane, so its line is straight')
})

test('subjects of very different sizes compose into a balanced whole: no cluster on another, consistent gaps, near the shape', () => {
  const nodes: MapNode[] = [], edges: MapEdge[] = []
  const sizes = [47, 6, 37, 3, 19, 12, 8, 1, 10, 7]
  sizes.forEach((count, s) => {
    nodes.push(subject(`s${s}`))
    for (let i = 0; i < count; i++) {
      const t = topic(`s${s}t${i}`, `s${s}`); nodes.push(t); edges.push(edge(`subject:s${s}`, t.id, 'has_topic'))
      if (i % 5 === 0) for (let j = 0; j < 3; j++) { const n = note(`s${s}t${i}n${j}`, `s${s}`); nodes.push(n); edges.push(edge(t.id, n.id, 'about_topic')) }
    }
  })
  const a = layoutMap(nodes, edges)
  noOverlap(nodes, a.at)
  const { w, h } = boxOf(a.at)
  assert.ok(w / h > 0.9 && w / h < 2.6, `shape ${Math.round(w)}×${Math.round(h)}`)
  // Each subject's cluster box, and none inside another's.
  const box = new Map<string, { x0: number; x1: number; y0: number; y1: number }>()
  for (const n of nodes) {
    const sid = `subject:${n.subjectId}`, p = a.at.get(n.id)!, c = CARD[n.type]
    const b = box.get(sid) ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    box.set(sid, { x0: Math.min(b.x0, p.x - c.w / 2), x1: Math.max(b.x1, p.x + c.w / 2), y0: Math.min(b.y0, p.y - c.h / 2), y1: Math.max(b.y1, p.y + c.h / 2) })
  }
  const list = [...box.entries()]
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [ia, p] = list[i]!, [ib, q] = list[j]!
    const apart = p.x1 + 100 <= q.x0 || q.x1 + 100 <= p.x0 || p.y1 + 90 <= q.y0 || q.y1 + 90 <= p.y0
    assert.ok(apart, `${ia} and ${ib} keep a clear gap`)
  }
  // The largest subject is not the tallest thing by far: it sits around its subject.
  const big = box.get('subject:s0')!
  assert.ok(big.y1 - big.y0 < (big.x1 - big.x0) * 1.2, `largest cluster ${Math.round(big.x1 - big.x0)}×${Math.round(big.y1 - big.y0)}`)
})

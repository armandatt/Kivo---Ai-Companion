// Exploring inside a card. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { layoutMap, treeOf } from './layout'
import { START, back, canExplore, crossLinks, current, enter, insideOf, keepLevels, MARKER_R, pathTo, placeOutside, reach, up } from './explore'

const subject = (id: string): MapNode => ({ id: `subject:${id}`, type: 'subject', label: id, href: null, subjectId: id, topics: 0, notes: 0, resources: 0 })
const topic = (id: string, s: string, parentId?: string, order = 0): MapNode => ({ id: `topic:${id}`, type: 'topic', label: id, href: null, subjectId: s, subjectName: s, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0, ...(parentId ? { parentId } : {}), order })
const note = (id: string, s: string | null): MapNode => ({ id: `note:${id}`, type: 'note', label: id, href: null, subjectId: s, subjectName: s, topicName: null, topicLinked: false, updatedAt: '2026-10-01T00:00:00Z' })
const edge = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })

// Kio › Nova Builder › Recursive Tasks › (Steps, Waits); a note inside links out.
function world() {
  const nodes: MapNode[] = [subject('Kio'), topic('Nova Builder', 'Kio'), topic('Recursive Tasks', 'Kio', 'Nova Builder', 0), topic('Steps', 'Kio', 'Recursive Tasks', 0),
    topic('Waits', 'Kio', 'Recursive Tasks', 1), topic('Billing', 'Kio', undefined, 1), note('design', 'Kio'), note('pricing', 'Kio')]
  const edges: MapEdge[] = [
    edge('subject:Kio', 'topic:Nova Builder', 'has_topic'), edge('topic:Nova Builder', 'topic:Recursive Tasks', 'subtopic'),
    edge('topic:Recursive Tasks', 'topic:Steps', 'subtopic'), edge('topic:Recursive Tasks', 'topic:Waits', 'subtopic'),
    edge('subject:Kio', 'topic:Billing', 'has_topic'), edge('topic:Steps', 'note:design', 'about_topic'), edge('topic:Billing', 'note:pricing', 'about_topic'),
    // A [[link]] from inside the branch out to a note elsewhere, and one coming in.
    edge('note:design', 'note:pricing', 'links_to'), edge('note:pricing', 'topic:Waits', 'links_to'),
  ]
  return { nodes, edges, tree: treeOf(nodes, edges) }
}

test('a card is explorable only when something is inside it', () => {
  const { tree } = world()
  assert.equal(canExplore(tree, 'topic:Nova Builder'), true)
  assert.equal(canExplore(tree, 'topic:Waits'), false, 'no empty nested map')
  assert.equal(canExplore(tree, 'note:design'), false)
})

test('an explored card holds every descendant, at any depth, and nothing else', () => {
  const { tree } = world()
  assert.deepEqual([...insideOf(tree, 'topic:Nova Builder')].sort(), ['note:design', 'topic:Nova Builder', 'topic:Recursive Tasks', 'topic:Steps', 'topic:Waits'])
  assert.deepEqual(pathTo(tree, 'topic:Recursive Tasks'), ['subject:Kio', 'topic:Nova Builder', 'topic:Recursive Tasks'], 'the breadcrumb trail')
})

test('links that leave the explored card are kept, with their direction, and tree lines are not counted', () => {
  const { edges, tree } = world()
  const links = crossLinks(insideOf(tree, 'topic:Nova Builder'), edges)
  assert.deepEqual(links.map(l => [l.edge.from, l.edge.to, l.inside, l.outside]), [
    ['note:design', 'note:pricing', 'note:design', 'note:pricing'],
    ['note:pricing', 'topic:Waits', 'topic:Waits', 'note:pricing'],
  ])
  assert.ok(links.every(l => l.edge.kind === 'links_to'), 'the edge itself is passed through unchanged')
})

test('an explored card keeps the places its cards have on the whole map', () => {
  const { nodes, edges, tree } = world()
  const whole = layoutMap(nodes, edges)
  const inside = insideOf(tree, 'topic:Nova Builder')
  // The page draws the whole map's layout, filtered: nothing moves on the way in.
  for (const id of inside) assert.ok(whole.at.has(id))
  const again = layoutMap(nodes, edges)
  for (const id of inside) assert.deepEqual(again.at.get(id), whole.at.get(id))
})

test('cards outside get one column right of the map, level with what joins them, never overlapping', () => {
  const at = new Map([['a', { x: 0, y: 0 }], ['b', { x: 0, y: 10 }], ['c', { x: 0, y: 400 }]])
  const links = [
    { edge: edge('a', 'x', 'links_to'), inside: 'a', outside: 'x' },
    { edge: edge('b', 'y', 'links_to'), inside: 'b', outside: 'y' },
    { edge: edge('y', 'c', 'links_to'), inside: 'c', outside: 'y' },
    { edge: edge('c', 'z', 'depends_on'), inside: 'c', outside: 'z' },
  ]
  const out = placeOutside(links, at, 500)
  assert.deepEqual([...out.keys()], ['x', 'y', 'z'])
  const ys = [...out.values()].map(p => p.y)
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! - ys[i - 1]! >= MARKER_R * 2, 'markers never overlap')
  assert.ok([...out.values()].every(p => p.x > 500), 'right of the explored map')
  assert.equal(out.get('y')!.y >= 10, true, 'a card joined twice sits by the first card that joins it')
})

test('going in and back returns to the view that was left, at every depth', () => {
  const v1 = { x: 10, y: 20, k: 0.8 }, v2 = { x: -300, y: 40, k: 1.4 }
  let s = enter(START, 'topic:Nova Builder', v1)
  s = enter(s, 'topic:Recursive Tasks', v2)
  assert.deepEqual(s.map(l => l.focus), [null, 'topic:Nova Builder', 'topic:Recursive Tasks'])
  s = back(s)
  assert.deepEqual(current(s), { focus: 'topic:Nova Builder', view: v2 })
  s = back(s)
  assert.deepEqual(current(s), { focus: null, view: v1 })
  assert.deepEqual(back(s), s, 'the whole map has nothing behind it')
  assert.equal(enter(s, 'topic:Nova Builder', v1).length, 2)
  assert.equal(enter(enter(s, 'topic:Nova Builder', v1), 'topic:Nova Builder', v2).length, 2, 'entering the card already explored adds nothing')
})

test('up goes to the card it sits inside, and is back when that is the view below', () => {
  const { tree } = world()
  const v = { x: 1, y: 2, k: 1 }
  const deep = enter(enter(START, 'topic:Nova Builder', v), 'topic:Recursive Tasks', v)
  assert.deepEqual(up(deep, tree), back(deep))
  // Opened straight on a deep card (a link): up opens the one around it.
  const direct = enter(START, 'topic:Recursive Tasks', null)
  assert.deepEqual(up(direct, tree).map(l => l.focus), [null, 'topic:Nova Builder'])
  assert.deepEqual(up(START, tree), [...START])
})

test('a card outside is reached in the deepest view that holds it', () => {
  const { tree } = world()
  const v = { x: 0, y: 0, k: 1 }
  const deep = enter(enter(START, 'topic:Nova Builder', v), 'topic:Recursive Tasks', v)
  assert.deepEqual(reach(deep, tree, 'topic:Steps').map(l => l.focus), [null, 'topic:Nova Builder', 'topic:Recursive Tasks'])
  assert.deepEqual(reach(deep, tree, 'note:design').map(l => l.focus), [null, 'topic:Nova Builder', 'topic:Recursive Tasks'])
  assert.deepEqual(reach(deep, tree, 'note:pricing').map(l => l.focus), [null], 'outside every explored card: the whole map')
  assert.deepEqual(reach(deep, tree, 'note:pricing')[0]!.view, v, 'with the view the learner left the whole map at')
})

test('after a reload, a view of a card that is gone, or now empty, closes with those inside it', () => {
  const { nodes, edges, tree } = world()
  const v = { x: 0, y: 0, k: 1 }
  const deep = enter(enter(START, 'topic:Nova Builder', v), 'topic:Recursive Tasks', v)
  const ids = new Set(nodes.map(n => n.id))
  assert.equal(keepLevels(deep, ids, tree), deep, 'unchanged: the same stack, so nothing re-renders')
  ids.delete('topic:Nova Builder')
  assert.deepEqual(keepLevels(deep, ids, tree).map(l => l.focus), [null])
  const emptied = treeOf(nodes, edges.filter(e => e.from !== 'topic:Recursive Tasks'))
  assert.deepEqual(keepLevels(deep, new Set(nodes.map(n => n.id)), emptied).map(l => l.focus), [null, 'topic:Nova Builder'])
})

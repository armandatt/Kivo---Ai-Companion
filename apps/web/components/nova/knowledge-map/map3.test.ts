// Knowledge Map 3.0: learning states and lenses, the overview and minimap,
// search, and switching scope. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { gapRank, gapsOf, isRecent, lensTargets, nextLens, tallyOf, topicState } from './lens'
import { detailAt, minimapFrame, viewCentredOn, viewOfBox, viewportOn } from './overview'
import { matchesOf, pathOf, searchMap } from './map-search'
import { scopeState } from './scope-switch'

type Topic = Extract<MapNode, { type: 'topic' }>
const topic = (id: string, over: Partial<Topic> = {}): Topic => ({
  id: `topic:${id}`, type: 'topic', label: id, href: null, subjectId: 's', subjectName: 'S',
  sessions: 2, level: 'developing', masteryPercent: 50, notes: 1, resources: 0, ...over,
})
const NOW = new Date('2026-11-14T12:00:00Z')

test('a topic’s state comes from its record: no session is not studied; a level only with sessions', () => {
  assert.equal(topicState(topic('a', { sessions: 0, level: null, masteryPercent: null })), 'unstudied')
  assert.equal(topicState(topic('a', { level: 'solid' })), 'solid')
  assert.equal(topicState(topic('a', { level: null })), 'unrated', 'studied with no estimate is not called weak')
  assert.equal(topicState(topic('a', { studied: false })), 'organising')
  assert.equal(topicState(topic('a', { kind: 'milestone' })), 'milestone')
  assert.equal(isRecent(topic('a', { lastStudiedAt: '2026-11-10T09:00:00Z' }), NOW), true)
  assert.equal(isRecent(topic('a', { lastStudiedAt: '2026-10-01T09:00:00Z' }), NOW), false)
  assert.equal(isRecent(topic('a', {}), NOW), false, 'no date on record: not recent')
})

test('gaps are things to act on, each from the record; milestones and organising topics are never gaps', () => {
  assert.deepEqual(gapsOf(topic('a', { reviewDue: true })), ['review_due'])
  assert.deepEqual(gapsOf(topic('a', { sessions: 0, level: null, notes: 0 })), ['unstudied', 'nothing_written'])
  assert.deepEqual(gapsOf(topic('a', { level: 'weak' })), ['weak'])
  assert.deepEqual(gapsOf(topic('a', { level: 'solid', notes: 0, resources: 2 })), [], 'a saved page counts as something written down')
  assert.deepEqual(gapsOf(topic('a', { kind: 'milestone', sessions: 0, notes: 0 })), [])
  assert.deepEqual(gapsOf(topic('a', { studied: false, sessions: 0, notes: 0 })), [])
  assert.ok(gapRank(topic('a', { reviewDue: true })) < gapRank(topic('b', { sessions: 0, level: null })), 'a review due comes first')
})

test('a lens only points at cards; structure points at none', () => {
  const nodes: MapNode[] = [topic('due', { reviewDue: true }), topic('fine', { level: 'solid' }), topic('org', { studied: false }), { id: 'note:n', type: 'note', label: 'n', href: null, subjectId: 's', subjectName: 'S', topicName: null, topicLinked: false, updatedAt: '' }]
  assert.equal(lensTargets('structure', nodes), null)
  assert.deepEqual([...lensTargets('gaps', nodes)!], ['topic:due'])
  assert.deepEqual([...lensTargets('learning', nodes)!].sort(), ['topic:due', 'topic:fine'])
  assert.equal(nextLens('structure'), 'learning'); assert.equal(nextLens('gaps'), 'structure')
})

test('a subject’s tally counts studied topics and reviews due, never organising topics or milestones', () => {
  const t = tallyOf([topic('a', { level: 'solid', reviewDue: true }), topic('b', { sessions: 0, level: null }), topic('c', { studied: false }), topic('d', { kind: 'milestone' }), topic('e', { level: 'weak' })])
  assert.deepEqual({ topics: t.topics, studied: t.studied, solid: t.solid, weak: t.weak, unstudied: t.unstudied, reviewDue: t.reviewDue }, { topics: 3, studied: 2, solid: 1, weak: 1, unstudied: 1, reviewDue: 1 })
})

test('the minimap holds the whole map, shows where the view is, and a click centres the view there', () => {
  const box = { minX: -500, minY: -200, maxX: 1500, maxY: 800 }
  const f = minimapFrame(box, 200, 120)
  const corner = (x: number, y: number) => [x * f.scale + f.ox, y * f.scale + f.oy]
  const [ax, ay] = corner(box.minX, box.minY), [bx, by] = corner(box.maxX, box.maxY)
  assert.ok(ax >= 0 && ay >= 0 && bx <= 200 && by <= 120, 'inside the minimap')
  // A view at 100% showing map x 0..1000, y 0..600.
  const v = { x: 0, y: 0, k: 1 }
  const r = viewportOn(f, v, 1000, 600)
  assert.ok(Math.abs(r.w - 1000 * f.scale) < 0.01 && r.whole === false)
  const back = viewCentredOn(f, r.x + r.w / 2, r.y + r.h / 2, 1, 1000, 600)
  assert.deepEqual(back, { x: 0, y: 0, k: 1 }, 'clicking the middle of the view keeps it where it is')
  assert.equal(viewportOn(f, { x: 600, y: 300, k: 0.1 }, 1000, 600).whole, true, 'zoomed out past the map: all of it is in view')
})

test('zoom to a subject: the whole region shows, never closer than the cap', () => {
  const v = viewOfBox({ minX: 0, minY: 0, maxX: 400, maxY: 200 }, 1200, 800, { maxK: 1 })
  assert.equal(v.k, 1)
  const big = viewOfBox({ minX: 0, minY: 0, maxX: 4000, maxY: 2000 }, 1200, 800)
  assert.ok(big.k < 0.3 && (4000 * big.k) <= 1200 - 96 + 1)
  assert.equal(detailAt(0.25), 0); assert.equal(detailAt(0.4), 1); assert.equal(detailAt(0.7), 2)
})

const n = (id: string, type: MapNode['type'], label: string, extra: Record<string, unknown> = {}) => ({ id, type, label, href: null, subjectId: 's', ...extra }) as unknown as MapNode
const nodes = [
  n('subject:ml', 'subject', 'Machine Learning'), n('topic:gd', 'topic', 'Gradient descent', { subjectName: 'Machine Learning' }),
  n('note:1', 'note', 'Notes on descent methods', { subjectName: 'Machine Learning', topicName: 'Gradient descent' }),
  n('resource:1', 'resource', 'Adam paper', { subjectName: 'Machine Learning', topicName: null, domain: 'arxiv.org' }),
  n('task:1', 'task', 'Revise gradient descent', { subjectName: 'Machine Learning', topicName: 'Gradient descent' }),
]

test('search: the name first, then a word in it, then what it is filed under; every kind of card is found', () => {
  assert.deepEqual(searchMap(nodes, 'grad').map(x => x.id), ['topic:gd', 'task:1', 'note:1'])
  assert.deepEqual(searchMap(nodes, 'arxiv').map(x => x.id), ['resource:1'], 'a saved page by its site')
  assert.deepEqual(searchMap(nodes, 'machine').map(x => x.id)[0], 'subject:ml')
  assert.deepEqual(searchMap(nodes, '   '), [])
  assert.equal(matchesOf(nodes, 'descent').size, 3)
})

test('a result says where it sits, from the top of the tree', () => {
  const parent = new Map([['note:1', 'topic:gd'], ['topic:gd', 'subject:ml']])
  const label = (id: string) => nodes.find(x => x.id === id)?.label
  assert.deepEqual(pathOf('note:1', parent, label), ['Machine Learning', 'Gradient descent'])
  assert.deepEqual(pathOf('subject:ml', parent, label), [])
})

test('switching scope: loading while asked and not shown; a failed request says so instead of leaving the old map silently', () => {
  const label = (id: string) => (id === 'w2' ? 'Thesis' : id)
  const base = { hasView: true, refreshing: false, error: false, label }
  assert.deepEqual(scopeState({ ...base, requested: 'all', shown: 'w1', refreshing: true }), { kind: 'switching', to: 'Everything' })
  assert.deepEqual(scopeState({ ...base, requested: 'all', shown: 'w1', error: true }), { kind: 'failed', to: 'Everything' })
  assert.deepEqual(scopeState({ ...base, requested: 'all', shown: null }), { kind: 'showing' }, 'everything arrived')
  assert.deepEqual(scopeState({ ...base, requested: 'w2', shown: null, refreshing: true }), { kind: 'switching', to: 'Thesis' })
  assert.deepEqual(scopeState({ ...base, requested: null, shown: 'w1' }), { kind: 'showing' }, 'the default is whatever came back')
  assert.deepEqual(scopeState({ ...base, requested: 'all', shown: 'w1', error: true, refreshing: true }), { kind: 'switching', to: 'Everything' }, 'a retry in flight')
})

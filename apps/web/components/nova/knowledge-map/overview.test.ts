// Everything as an overview, and what a card's inspector says first. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { crossSubjectLinks, foldedLabel, foldedTotal, overviewDensity, rootOf } from './overview-density'
import { nextStep, summaryOf } from './node-summary'
import { previewText } from './note-preview'

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: id.split(':')[0], label: id, href: null, subjectId: 's', ...extra }) as unknown as MapNode
// ML ─ Optimisation ─ Adam (subtopic) ─ note
//    └ note on ML itself, a task, a page under Optimisation; OS ─ Paging; one loose note
const nodes = [
  node('subject:ml'), node('topic:opt'), node('topic:adam'), node('note:n1'), node('note:n2'), node('task:t1'), node('resource:r1'),
  node('subject:os'), node('topic:paging'), node('note:loose'), node('subject:inner'),
]
const parent = new Map([
  ['topic:opt', 'subject:ml'], ['topic:adam', 'topic:opt'], ['note:n1', 'topic:adam'], ['note:n2', 'subject:ml'],
  ['task:t1', 'topic:opt'], ['resource:r1', 'topic:opt'], ['topic:paging', 'subject:os'], ['subject:inner', 'subject:ml'],
])

test('Everything draws subjects and their own topics; deeper topics, notes, pages and tasks fold into counts', () => {
  const d = overviewDensity(nodes, parent)
  assert.deepEqual([...d.hidden].sort(), ['note:loose', 'note:n1', 'note:n2', 'resource:r1', 'task:t1', 'topic:adam'])
  // What is not hidden: every subject (a subject inside one too) and every top-level topic.
  for (const id of ['subject:ml', 'subject:os', 'subject:inner', 'topic:opt', 'topic:paging']) assert.ok(!d.hidden.has(id), id)
  // Counted on the nearest card drawn: Adam's note goes to Optimisation, with Adam itself.
  assert.deepEqual(d.folded.get('topic:opt'), { topics: 1, notes: 1, resources: 1, tasks: 1 })
  assert.deepEqual(d.folded.get('subject:ml'), { topics: 0, notes: 1, resources: 0, tasks: 0 })
  assert.equal(d.loose, 1, 'a note filed under nothing is folded too, and counted')
  // Nothing is lost: every node is either drawn or counted.
  const counted = [...d.folded.values()].reduce((a, c) => a + foldedTotal(c), 0) + d.loose
  assert.equal(counted, d.hidden.size)
  assert.equal(foldedLabel({ topics: 1, notes: 2, resources: 1, tasks: 0 }), '1 topic · 2 notes · 1 page')
})

test('cross-subject links are only [[links]] written between two subjects’ items, counted per pair', () => {
  const edges: MapEdge[] = [
    { id: 'a', from: 'note:n1', to: 'topic:paging', kind: 'links_to' },
    { id: 'b', from: 'note:n2', to: 'topic:paging', kind: 'links_to' },
    { id: 'c', from: 'note:n1', to: 'note:n2', kind: 'links_to' },            // inside one subject: not a cross link
    { id: 'd', from: 'subject:ml', to: 'topic:opt', kind: 'has_topic' },      // structure, not a link
    { id: 'e', from: 'note:loose', to: 'topic:paging', kind: 'links_to' },    // from nothing filed: no subject on that side
  ]
  const isSubject = (id: string) => id.startsWith('subject:')
  assert.deepEqual(crossSubjectLinks(edges, parent, isSubject), [{ a: 'subject:ml', b: 'subject:os', count: 2 }])
  assert.equal(rootOf('note:n1', parent), 'subject:ml')
})

test('a topic’s inspector leads with status and what is filed there; sessions, dates and the schedule wait under More', () => {
  const t = node('topic:cp', { subjectName: 'Product Strategy', sessions: 3, level: 'weak', masteryPercent: 25, notes: 2, resources: 1, reviewDue: true, lastStudiedAt: '2026-11-12T10:00:00Z', details: { explanation: 'The problems the strategy has chosen to solve.' } })
  const s = summaryOf(t, { when: () => '2 days ago' })
  assert.deepEqual(s.status, { label: 'Weak', tone: 'weak', percent: 25 })
  assert.equal(s.counts, '2 notes · 1 saved page')
  assert.equal(s.description, 'The problems the strategy has chosen to solve.')
  assert.deepEqual(s.more.map(([k]) => k), ['Sessions', 'Last studied', 'Review'])
})

test('nothing is said that the record does not hold', () => {
  const fresh = summaryOf(node('topic:x', { sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 }), { when: () => '' })
  assert.deepEqual(fresh.status, { label: 'Not studied yet', tone: 'plain', percent: null }, 'no level, no percent')
  assert.equal(fresh.counts, null, 'no "0 notes" line')
  assert.equal(fresh.description, null, 'no description invented')
  assert.equal(fresh.more.find(([k]) => k === 'Review'), undefined, 'no review line with no session')
  const subject = summaryOf(node('subject:s', { topics: 4, notes: 0, resources: 0 }), { when: () => '', tally: { topics: 4, studied: 1, solid: 1, developing: 0, weak: 0, unstudied: 3, reviewDue: 0, notes: 0, resources: 0, tasks: 0 } })
  assert.deepEqual(subject.status, { label: '1 of 4 topics studied', tone: 'plain', percent: 25 })
  assert.equal(summaryOf(node('subject:s', { topics: 0, notes: 0, resources: 0 }), { when: () => '', tally: { topics: 0, studied: 0, solid: 0, developing: 0, weak: 0, unstudied: 0, reviewDue: 0, notes: 0, resources: 0, tasks: 0 } }).status, null)
})

test('a note’s preview is its opening words as plain text', () => {
  assert.equal(previewText('# Gradient descent\n\n> [!takeaway] Step size matters\n- **Adam** adapts it, see [[Optimisers|the optimisers note]] and [paper](https://x.org)\n```js\ncode()\n```\n![fig](kivo-image:1)'),
    'Gradient descent Step size matters Adam adapts it, see the optimisers note and paper')
  assert.ok(previewText('word '.repeat(200)).length <= 220)
})

test('one next step, from the topic’s own record: review due first, then not studied, weak, nothing written', () => {
  const t = (o: Record<string, unknown>) => node('topic:x', { sessions: 2, level: 'solid', masteryPercent: 80, notes: 1, resources: 0, ...o })
  assert.equal(nextStep(t({ reviewDue: true, level: 'weak' }))?.kind, 'revise')
  assert.equal(nextStep(t({ sessions: 0, level: null, masteryPercent: null }))?.kind, 'start')
  assert.equal(nextStep(t({ level: 'weak' }))?.kind, 'again')
  assert.equal(nextStep(t({ notes: 0 }))?.kind, 'note')
  assert.equal(nextStep(t({})), null, 'nothing to suggest: none made up')
  assert.equal(nextStep(t({ kind: 'milestone', sessions: 0 })), null)
  assert.equal(nextStep(node('note:n')), null)
})

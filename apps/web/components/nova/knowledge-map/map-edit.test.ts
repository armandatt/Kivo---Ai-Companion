// What the map may link and file, checked before anything is sent. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { removeLink, appendLink, filingChoices, placementLabel, placementOf, planLink, samePlacement } from './map-edit'

const subject = (id: string, label: string): MapNode => ({ id: `subject:${id}`, type: 'subject', label, href: null, subjectId: id, topics: 0, notes: 0, resources: 0 })
const topic = (id: string, label: string, s: string, sName: string): MapNode => ({ id: `topic:${id}`, type: 'topic', label, href: null, subjectId: s, subjectName: sName, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 })
const note = (id: string, label: string, s: string | null = null, topicName: string | null = null, topicLinked = false): MapNode =>
  ({ id: `note:${id}`, type: 'note', label, href: null, subjectId: s, subjectName: s ? 'OS' : null, topicName, topicLinked, updatedAt: '2026-10-01T00:00:00.000Z' })
const page = (id: string, s: string | null): MapNode =>
  ({ id: `resource:${id}`, type: 'resource', label: id, href: null, subjectId: s, subjectName: null, topicName: null, topicLinked: false, url: 'https://x.org', domain: 'x.org', savedAt: '', kind: 'saved' })

const nodes: MapNode[] = [
  subject('os', 'OS'), subject('db', 'DBMS'),
  topic('t1', 'Deadlocks', 'os', 'OS'), topic('t2', 'Paging', 'os', 'OS'), topic('t3', 'Indexing', 'db', 'DBMS'), topic('t4', 'indexing', 'os', 'OS'),
  note('n1', 'Banker'), note('n2', 'Summary'), note('n3', 'summary '), note('n4', 'Paging'), note('n5', 'Odd | title'),
  page('r1', null),
]
const edges: MapEdge[] = [{ id: 'e', from: 'note:n1', to: 'topic:t1', kind: 'links_to' }]
const byId = (id: string) => nodes.find(n => n.id === id)!

test('a note links to a note or topic that its title names unambiguously', () => {
  assert.deepEqual(planLink(byId('note:n4'), byId('note:n1'), nodes, edges), { ok: true, title: 'Banker', expect: { noteId: 'n1' } })
  assert.deepEqual(planLink(byId('note:n1'), byId('topic:t1'), nodes, []), { ok: true, title: 'Deadlocks', expect: { topicId: 't1' } })
})

test('a link is refused when [[Title]] could open something else, or is not a link at all', () => {
  const refused = (from: string, to: string, es: MapEdge[] = edges) => {
    const plan = planLink(byId(from), byId(to), nodes, es)
    assert.equal(plan.ok, false, `${from} -> ${to}`)
    return plan.ok ? '' : plan.reason
  }
  assert.match(refused('note:n1', 'topic:t1'), /already links/)
  assert.match(refused('note:n1', 'note:n2'), /More than one of your notes/)       // "Summary" and "summary "
  assert.match(refused('note:n1', 'topic:t2'), /A note is also called/)            // the note "Paging" wins
  assert.match(refused('note:n1', 'topic:t3'), /More than one topic/)              // Indexing in two subjects
  assert.match(refused('note:n1', 'note:n5'), /cannot hold/)
  assert.match(refused('note:n1', 'note:n1'), /itself/)
  assert.match(refused('topic:t1', 'note:n1'), /Only a note/)
  assert.match(refused('note:n1', 'resource:r1'), /another note or to a topic/)
})

test('a link is added on its own line at the end, and nothing written before it changes', () => {
  assert.equal(appendLink('', 'Banker'), '[[Banker]]')
  assert.equal(appendLink('First line', 'Banker'), 'First line\n\n[[Banker]]')
  assert.equal(appendLink('First line\n', 'Banker'), 'First line\n\n[[Banker]]')
  assert.equal(appendLink('First line\n\n', 'Banker'), 'First line\n\n[[Banker]]')
  const body = '  # Heading  \n- item with [[Other]]\n'
  assert.ok(appendLink(body, 'Banker')!.startsWith(body))
  // A note ending inside a ``` block: the link would be code, so it is not added.
  assert.equal(appendLink('```\ncode', 'Banker'), null)
})

test('filing offers only subjects and topics on the map, and knows where an item is now', () => {
  assert.deepEqual(filingChoices(nodes), [
    { subjectId: 'os', name: 'OS', topics: ['Deadlocks', 'indexing', 'Paging'] },
    { subjectId: 'db', name: 'DBMS', topics: ['Indexing'] },
  ])
  const filed = note('x', 'X', 'os', 'Deadlocks', true)
  assert.deepEqual(placementOf(filed), { subjectId: 'os', topicName: 'Deadlocks' })
  assert.deepEqual(placementOf(note('y', 'Y', 'os', 'Not a topic', false)), { subjectId: 'os', topicName: null })
  assert.equal(placementOf(note('z', 'Z')), null)
  assert.equal(placementOf(byId('topic:t1')), null)
  assert.ok(samePlacement({ subjectId: 'os', topicName: 'deadlocks ' }, { subjectId: 'os', topicName: 'Deadlocks' }))
  assert.equal(samePlacement(null, { subjectId: 'os', topicName: null }), false)
  assert.equal(placementLabel({ subjectId: 'os', topicName: 'Deadlocks' }, nodes), 'OS › Deadlocks')
  assert.equal(placementLabel(null, nodes), 'Not filed')
})

test('removing a [[link]] keeps its words and everything else exactly as written', () => {
  const body = 'See [[Paging]] and [[paging|page tables]].\n```\n[[Paging]] in code\n```\nAlso [[ Other  Note |x]] and [[Paging ]].'
  assert.equal(removeLink(body, 'Paging'), 'See Paging and page tables.\n```\n[[Paging]] in code\n```\nAlso [[ Other  Note |x]] and Paging.')
  assert.equal(removeLink('No links here, or [[unclosed', 'Paging'), null, 'nothing to remove')
  assert.equal(removeLink('[[Other]]', 'Paging'), null)
  assert.equal(removeLink('a [[b [[Paging]] c', 'Paging'), 'a [[b Paging c', 'read the way the server reads it')
})

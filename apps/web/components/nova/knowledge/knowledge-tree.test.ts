// The Knowledge explorer's tree, search and address. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KnowledgeOutlineRow, KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import { buildKnowledgeTree, indexTree, pathTo, searchTree, selectionFrom, selectionHref, subjectKey, topicKey, visibleRows, workspaceFor } from './knowledge-tree'

const studied = (id: string, topicName: string, due = false) => ({ id, topicName, reviewState: due ? 'due' : 'scheduled' }) as KnowledgeTopic
const row = (id: string, name: string, depth: number, isStudied = true, kind: 'milestone' | null = null): KnowledgeOutlineRow => ({ id, name, depth, kind, studied: isStudied })
const subject = (subjectId: string, subjectName: string, topics: KnowledgeTopic[], outline?: KnowledgeOutlineRow[]): KnowledgeSubject =>
  ({ subjectId, subjectName, topics, ...(outline ? { outline } : {}), summary: { topicCount: topics.length, dueCount: 0 } })

// Finance › Investing › Risk and Return, and a second "Basics" in another subject.
const finance = subject('fin', 'Finance', [studied('risk', 'Risk and Return', true), studied('bonds', 'Bonds'), studied('fbasics', 'Basics')], [
  row('inv', 'Investing', 0, false), row('risk', 'Risk and Return', 1), row('bonds', 'Bonds', 1),
  row('fbasics', 'Basics', 0),
])
const os = subject('os', 'Operating Systems', [studied('paging', 'Paging'), studied('obasics', 'Basics')])
const semester = subject('sem', 'Semester Five', [])
const subjects = [os, finance, semester]

test('subjects are the top level, by name; their topics nest as arranged, to any depth', () => {
  const roots = buildKnowledgeTree(subjects)
  assert.deepEqual(roots.map(r => r.name), ['Finance', 'Operating Systems', 'Semester Five'])
  const fin = roots[0]
  assert.deepEqual(fin.children.map(c => c.name), ['Investing', 'Basics'])
  assert.deepEqual(fin.children[0].children.map(c => c.name), ['Risk and Return', 'Bonds'])
  assert.equal(fin.children[0].children[0].parentKey, topicKey('inv'))
  // An organiser is not studied on its own; its children are.
  assert.equal(fin.children[0].topic, undefined)
  assert.equal(fin.children[0].children[0].topic?.id, 'risk')
  assert.equal(fin.topicCount, 3)
  assert.equal(fin.dueCount, 1)
  assert.equal(fin.children[0].dueCount, 1)
})

test('a subject with no outline lists its studied topics, by name', () => {
  const roots = buildKnowledgeTree([os])
  assert.deepEqual(roots[0].children.map(c => c.name), ['Basics', 'Paging'])
  assert.ok(roots[0].children.every(c => c.children.length === 0 && c.topic))
})

test('a subject inside another sits under it, before its topics; a missing parent or a loop leaves it on top', () => {
  const nested = buildKnowledgeTree(subjects, id => (id === 'os' ? 'sem' : null))
  assert.deepEqual(nested.map(r => r.name), ['Finance', 'Semester Five'])
  assert.deepEqual(nested[1].children.map(c => c.key), [subjectKey('os')])
  assert.equal(nested[1].topicCount, 2)

  assert.deepEqual(buildKnowledgeTree(subjects, id => (id === 'os' ? 'gone' : null)).map(r => r.name), ['Finance', 'Operating Systems', 'Semester Five'])
  const loop = buildKnowledgeTree(subjects, id => (id === 'os' ? 'sem' : id === 'sem' ? 'os' : null))
  assert.deepEqual(loop.map(r => r.name), ['Finance', 'Operating Systems', 'Semester Five'])
})

test('only open branches show their children', () => {
  const roots = buildKnowledgeTree(subjects)
  assert.deepEqual(visibleRows(roots, new Set()).map(r => r.node.name), ['Finance', 'Operating Systems', 'Semester Five'])
  const open = visibleRows(roots, new Set([subjectKey('fin'), topicKey('inv')]))
  assert.deepEqual(open.map(r => `${r.level}:${r.node.name}`), ['1:Finance', '2:Investing', '3:Risk and Return', '3:Bonds', '2:Basics', '1:Operating Systems', '1:Semester Five'])
  // A closed parent hides an open child.
  assert.deepEqual(visibleRows(roots, new Set([topicKey('inv')])).length, 3)
})

test('the path to a topic names every level, outermost first', () => {
  const index = indexTree(buildKnowledgeTree(subjects))
  assert.deepEqual(pathTo(index, topicKey('risk')).map(n => n.name), ['Finance', 'Investing', 'Risk and Return'])
  assert.deepEqual(pathTo(index, 'gone'), [])
})

test('search finds nested topics, any case, and says where each is, so two of one name differ', () => {
  const roots = buildKnowledgeTree(subjects)
  assert.deepEqual(searchTree(roots, 'RISK').map(r => [r.node.key, r.path.join(' / ')]), [[topicKey('risk'), 'Finance / Investing']])
  const basics = searchTree(roots, ' basics ')
  assert.deepEqual(basics.map(r => [r.node.id, r.path.join(' / ')]), [['fbasics', 'Finance'], ['obasics', 'Operating Systems']])
  assert.deepEqual(searchTree(roots, '  '), [])
  assert.deepEqual(searchTree(roots, 'nothing like it'), [])
})

test('the address names a subject or a topic; a topic wins when both are there', () => {
  assert.deepEqual(selectionFrom('?subject=fin'), { kind: 'subject', id: 'fin' })
  assert.deepEqual(selectionFrom('?topic=risk&subject=fin'), { kind: 'topic', id: 'risk' })
  assert.equal(selectionFrom(''), null)
  assert.equal(selectionHref('/knowledge', { kind: 'topic', id: 'a b' }), '/knowledge?topic=a%20b')
  assert.equal(selectionHref('/knowledge', null), '/knowledge')
})

test('Build with Nova opens the workspace holding the subject, or a subject it sits inside', () => {
  const index = indexTree(buildKnowledgeTree(subjects, id => (id === 'os' ? 'sem' : null)))
  const workspaces = [{ id: 'w-new', subjects: [{ id: 'fin' }] }, { id: 'w-sem', subjects: [{ id: 'sem' }] }]
  assert.equal(workspaceFor(index, 'fin', workspaces), 'w-new')
  assert.equal(workspaceFor(index, 'os', workspaces), 'w-sem')
  assert.equal(workspaceFor(index, 'os', []), null)
})

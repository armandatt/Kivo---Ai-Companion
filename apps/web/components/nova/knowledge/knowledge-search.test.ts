// The Knowledge page's search. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import { searchSubjects } from './knowledge-search'

const topic = (id: string, topicName: string) => ({ id, topicName }) as KnowledgeTopic
const subject = (subjectName: string, topics: KnowledgeTopic[]): KnowledgeSubject => ({
  subjectId: subjectName, subjectName, topics, summary: { topicCount: topics.length, dueCount: 0 },
})

const subjects = [
  subject('Operating Systems', [topic('t1', 'Deadlocks'), topic('t2', 'Paging')]),
  subject('Database Systems', [topic('t3', 'Transactions'), topic('t4', 'Indexing')]),
  subject('Engineering Mathematics', []),
]

test('an empty or blank search shows everything, as given', () => {
  assert.equal(searchSubjects(subjects, ''), subjects)
  assert.equal(searchSubjects(subjects, '   '), subjects)
})

test('a subject whose name matches is shown with all its topics', () => {
  const found = searchSubjects(subjects, 'operating')
  assert.deepEqual(found.map(s => s.subjectName), ['Operating Systems'])
  assert.deepEqual(found[0].topics.map(t => t.topicName), ['Deadlocks', 'Paging'])
})

test('otherwise only matching topics, under their subject, any case', () => {
  const found = searchSubjects(subjects, 'DEAD')
  assert.deepEqual(found.map(s => s.subjectName), ['Operating Systems'])
  assert.deepEqual(found[0].topics.map(t => t.topicName), ['Deadlocks'])
})

test('a match in two subjects keeps the server\'s order', () => {
  const found = searchSubjects(subjects, 'ing')
  assert.deepEqual(found.map(s => s.subjectName), ['Operating Systems', 'Database Systems', 'Engineering Mathematics'])
  assert.deepEqual(found[1].topics.map(t => t.topicName), ['Indexing'])
})

test('a subject with no topics is found by its name, and nothing matches nothing', () => {
  assert.deepEqual(searchSubjects(subjects, 'mathematics').map(s => s.subjectName), ['Engineering Mathematics'])
  assert.deepEqual(searchSubjects(subjects, 'zzz'), [])
})

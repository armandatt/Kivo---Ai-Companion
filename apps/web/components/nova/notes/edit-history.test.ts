// What the editor sends with each request (edit-history.ts): the
// conversation so far, so a request can refer to an earlier one, and Nova's
// open question, so an answer is read as one (12 Nov).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyOf, openQuestion, type EditEntry } from './edit-history'
import type { EditProposal } from '@repo/api/nova/product/note-edit.types'

const proposal = (over: Partial<EditProposal> = {}): EditProposal => ({ ok: true, kind: 'custom', noteVersion: 'v1', summary: 'Added an example.', changes: [{ id: 'e1', op: 'insert', start: 0, end: 0, before: '', after: 'x', anchor: null, section: null, why: null }], question: null, dropped: [], large: false, partial: false, ...over })
const entry = (id: string, state: EditEntry['state'], ask: string, p?: Partial<EditProposal>): EditEntry =>
  state === 'error' ? { id, ask: { kind: 'custom', instruction: ask }, state, message: 'x' } : { id, ask: { kind: 'custom', instruction: ask }, state, proposal: proposal(p), skip: [] }

test('each earlier request is sent with what came of it', () => {
  const h = historyOf([
    entry('1', 'applied', 'add an example to Dijkstra'),
    entry('2', 'discarded', 'shorten the intro'),
    entry('3', 'error', 'fix grammar'),
    entry('4', 'proposed', 'add a section on A*', { changes: [], question: 'Under which heading?' }),
  ])
  assert.deepEqual(h.map(t => t.outcome), ['applied', 'discarded', 'failed', 'question'])
  assert.equal(h[0]!.said, 'Added an example.')
  assert.equal(h[3]!.said, 'Under which heading?')
})

test('only the last ten, each kept short', () => {
  const many = Array.from({ length: 25 }, (_, i) => entry(String(i), 'applied', `request ${i} ${'x'.repeat(600)}`))
  const h = historyOf(many)
  assert.equal(h.length, 10)
  assert.ok(h[0]!.asked.startsWith('request 15'))
  assert.ok(h.every(t => t.asked.length <= 400))
})

test("Nova's open question is what the next message answers, and only while it is the last thing said", () => {
  const asked = entry('1', 'proposed', 'add a section', { changes: [], question: 'Under which heading?' })
  assert.equal(openQuestion([asked]), 'Under which heading?')
  assert.equal(openQuestion([asked, entry('2', 'applied', 'something else')]), null)
  assert.equal(openQuestion([entry('3', 'proposed', 'x')]), null)
})

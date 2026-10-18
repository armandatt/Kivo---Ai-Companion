// Saving where the cards are, in batches, without losing a move. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapPosition } from '@repo/api/nova/product/map-layout.types'
import { LayoutSaver, type SaverState, type SendResult } from './layout-saver'

// Timers the test runs by hand.
function clock() {
  let next: (() => void) | null = null
  return {
    timers: { set: (fn: () => void) => { next = fn; return 1 }, clear: () => { next = null } },
    tick: () => { const fn = next; next = null; fn?.() },
    armed: () => next !== null,
  }
}

function harness(answers: SendResult[]) {
  const sent: MapPosition[][] = []
  const states: SaverState[] = []
  const gates: Array<() => void> = []
  const c = clock()
  const saver = new LayoutSaver(async positions => {
    sent.push(positions)
    await new Promise<void>(resolve => gates.push(resolve))
    return answers.shift() ?? { ok: true }
  }, s => states.push(s), 800, c.timers)
  const settle = () => new Promise(resolve => setImmediate(resolve))
  return { saver, sent, states, c, open: async () => { gates.shift()?.(); await settle() }, settle }
}

test('moves are sent together after a pause, one request for many moves', async () => {
  const h = harness([])
  h.saver.queue('note:a', 1, 1)
  h.saver.queue('note:b', 2, 2)
  h.saver.queue('note:a', 3, 3)
  assert.equal(h.sent.length, 0, 'nothing is sent on each move')
  assert.equal(h.saver.state().status, 'pending')
  h.c.tick()
  await h.settle()
  assert.deepEqual(h.sent, [[{ node: 'note:a', x: 3, y: 3 }, { node: 'note:b', x: 2, y: 2 }]])
  assert.equal(h.saver.state().status, 'saving')
  await h.open()
  assert.deepEqual(h.saver.state(), { status: 'saved', unsaved: 0, message: null })
})

test('a move made while a save is in flight goes in the next save', async () => {
  const h = harness([])
  h.saver.queue('note:a', 1, 1)
  h.c.tick(); await h.settle()
  h.saver.queue('note:b', 5, 5)
  await h.open()
  assert.ok(h.c.armed(), 'the next save is scheduled')
  h.c.tick(); await h.settle()
  assert.deepEqual(h.sent[1], [{ node: 'note:b', x: 5, y: 5 }])
  await h.open()
  assert.equal(h.saver.state().status, 'saved')
})

test('a failed save keeps its moves, and Retry sends them; a newer move wins over the failed one', async () => {
  const h = harness([{ ok: false, message: 'Offline.' }])
  h.saver.queue('note:a', 1, 1)
  h.saver.queue('note:b', 2, 2)
  h.c.tick(); await h.settle()
  h.saver.queue('note:a', 9, 9)    // moved again while the first save is out
  await h.open()
  assert.deepEqual(h.saver.state(), { status: 'failed', unsaved: 2, message: 'Offline.' })
  assert.deepEqual(h.saver.pending().sort((x, y) => x.node.localeCompare(y.node)), [{ node: 'note:a', x: 9, y: 9 }, { node: 'note:b', x: 2, y: 2 }])
  const retried = h.saver.retry()
  await h.settle()
  await h.open()
  await retried
  assert.deepEqual(h.sent[1]!.sort((x, y) => x.node.localeCompare(y.node)), [{ node: 'note:a', x: 9, y: 9 }, { node: 'note:b', x: 2, y: 2 }])
  assert.deepEqual(h.saver.state(), { status: 'saved', unsaved: 0, message: null })
})

test('a send that throws is a failure, not a lost move', async () => {
  const c = clock()
  const saver = new LayoutSaver(async () => { throw new Error('network') }, () => {}, 800, c.timers)
  saver.queue('topic:t', 4, 4)
  await saver.flush()
  assert.equal(saver.state().status, 'failed')
  assert.deepEqual(saver.pending(), [{ node: 'topic:t', x: 4, y: 4 }])
})

test('discard (for a reset) drops what is queued and waits for the save in flight', async () => {
  const h = harness([{ ok: false, message: 'Offline.' }])
  h.saver.queue('note:a', 1, 1)
  h.c.tick(); await h.settle()
  h.saver.queue('note:b', 2, 2)
  let discarded = false
  const done = h.saver.discard().then(() => { discarded = true })
  await h.settle()
  assert.equal(discarded, false, 'it waits while a save is out')
  await h.open()
  await done
  assert.deepEqual(h.saver.state(), { status: 'saved', unsaved: 0, message: null }, 'even a failed save in flight leaves nothing queued')
  assert.equal(h.c.armed(), false)
})

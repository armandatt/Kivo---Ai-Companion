import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLine, splitLines } from './stream-post'

test('only whole lines come out; the rest waits for the next chunk', () => {
  assert.deepEqual(splitLines('{"text":"a"}\n{"te'), { lines: ['{"text":"a"}'], rest: '{"te' })
  assert.deepEqual(splitLines('{"text":"a"}\n'), { lines: ['{"text":"a"}'], rest: '' })
  assert.deepEqual(splitLines('partial'), { lines: [], rest: 'partial' })
})

test('a line that is not an object is ignored, never thrown', () => {
  assert.deepEqual(readLine('{"final":{"ok":true},"status":200}'), { final: { ok: true }, status: 200 })
  assert.equal(readLine('not json'), null)
  assert.equal(readLine('42'), null)
})

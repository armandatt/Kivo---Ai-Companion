import { test } from 'node:test'
import assert from 'node:assert/strict'
import { followImport } from './import-follow'

// A server answering from a script: each GET of a job returns the next state.
function server(script: Record<string, unknown[]>, opts: { failFetches?: number } = {}) {
  const calls: string[] = []
  let fails = opts.failFetches ?? 0
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (fails > 0) { fails--; throw new Error('network') }
    const id = decodeURIComponent(url.split('/').pop()!)
    if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true, status: 'running', jobId: id }))
    const list = script[id]!
    return new Response(JSON.stringify(list.length > 1 ? list.shift() : list[0]))
  }
  return { fetch, calls, sleep: async () => {} }
}
const running = (jobId: string, stalled = false) => ({ ok: true, status: 'running', jobId, stage: 'notes', stalled })
const complete = (jobId: string, root: string) => ({ ok: true, status: 'complete', jobId, rootSubjectId: root, rootSubjectIds: [root], counts: { subjects: 1 } })

test('running then complete: the map ids come from the server, and polling stops there', async () => {
  const s = server({ j1: [running('j1'), running('j1'), complete('j1', 'root-1')] })
  const stages: Array<string | null> = []
  const r = await followImport('j1', { ...s, onStage: x => stages.push(x) })
  assert.deepEqual(r, { status: 'complete', jobId: 'j1', rootSubjectId: 'root-1', rootSubjectIds: ['root-1'], counts: { subjects: 1 } })
  assert.equal(s.calls.length, 3, 'no read after the terminal state')
  assert.deepEqual(stages, ['notes', 'notes'])
})

test('failed is shown, never waited on', async () => {
  const s = server({ j: [{ ok: true, status: 'failed', jobId: 'j', message: 'It stopped.' }] })
  assert.deepEqual(await followImport('j', s), { status: 'failed', jobId: 'j', message: 'It stopped.' })
})

test('a stalled run is resumed once; stalled again is a failure with Try again, not a spinner', async () => {
  const ok = server({ j: [running('j', true), running('j'), complete('j', 'r')] })
  assert.equal((await followImport('j', ok)).status, 'complete')
  assert.ok(ok.calls.includes('POST /api/nova/portable/import/j'))
  const stuck = server({ j: [running('j', true), running('j', true)] })
  const r = await followImport('j', stuck)
  assert.equal(r.status, 'failed')
})

test('a complete job with no map id is not navigated to', async () => {
  const s = server({ j: [{ ok: true, status: 'complete', jobId: 'j', rootSubjectId: '', rootSubjectIds: [], counts: {} }] })
  assert.equal((await followImport('j', s)).status, 'failed')
})

test('dropped connections are retried, not taken as an outcome', async () => {
  const s = server({ j: [complete('j', 'r')] }, { failFetches: 3 })
  assert.equal((await followImport('j', s)).status, 'complete')
})

test('two imports followed at once keep their own ids', async () => {
  const s = server({ a: [running('a'), complete('a', 'root-a')], b: [running('b'), running('b'), complete('b', 'root-b')] })
  const [a, b] = await Promise.all([followImport('a', s), followImport('b', s)])
  assert.deepEqual([a.status === 'complete' && a.rootSubjectId, b.status === 'complete' && b.rootSubjectId], ['root-a', 'root-b'])
})

test('a cancelled follow (the page left) stops', async () => {
  const s = server({ j: [running('j')] })
  const signal = { aborted: false }
  const p = followImport('j', { ...s, signal, sleep: async () => { signal.aborted = true } })
  assert.equal((await p).status, 'cancelled')
})

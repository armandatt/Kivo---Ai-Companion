// What the learner is told when a save is refused. Run with `npm test`.
//
// The API is deployed separately from this app and can be a version behind:
// an older one answers a save from the web app with 401, exactly as it
// answers a signed-out browser. Only the second is a reason to sign in.

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { saveLink } from './saved-api'

const LINK = { clientEventId: 'web-1', url: 'https://example.com/os/deadlocks', title: 'Deadlocks', subjectId: null, topicName: null }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

// Answers each path from the table, and records what was asked.
function server(routes: Record<string, () => Response>) {
  const calls: Array<{ path: string; method: string; body: string | null }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push({ path, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null })
    const route = routes[path]
    if (!route) throw new Error(`unexpected request to ${path}`)
    return route()
  }) as typeof fetch
  return calls
}

const REFUSED = () => json(401, { success: false, error: 'unauthenticated', message: 'Connect Nova again.' })

test('a signed-out learner is told to sign in', async () => {
  server({ '/api/nova/learning-events': REFUSED, '/api/me': () => json(401, { error: 'unauthenticated' }) })
  const result = await saveLink(LINK)
  assert.equal(result.success, false)
  assert.equal(!result.success && result.error, 'unauthenticated')
})

test('a signed-in learner whose save an older API refuses is not sent to sign in', async () => {
  server({ '/api/nova/learning-events': REFUSED, '/api/me': () => json(200, { id: 'u1' }) })
  const result = await saveLink(LINK)
  assert.equal(result.success, false)
  assert.equal(!result.success && result.error, 'failed', 'not "unauthenticated": the page offers sign-in for that')
  assert.ok(!result.success && result.message.startsWith("You're signed in"), 'and they are told so')
})

test('when the session cannot be checked, sign-in is offered: the safe reading', async () => {
  server({ '/api/nova/learning-events': REFUSED, '/api/me': () => { throw new Error('offline') } })
  const result = await saveLink(LINK)
  assert.equal(!result.success && result.error, 'unauthenticated')
})

test('a save that works never asks about the session, and sends no identity of its own', async () => {
  const calls = server({ '/api/nova/learning-events': () => json(200, { success: true, resourceId: 'r1', duplicate: false }) })
  const result = await saveLink(LINK)
  assert.equal(result.success, true)
  assert.deepEqual(calls.map(c => c.path), ['/api/nova/learning-events'])
  const sent = JSON.parse(calls[0]!.body!) as Record<string, unknown>
  assert.deepEqual(Object.keys(sent).sort(), ['capturedAt', 'clientEventId', 'eventType', 'subjectId', 'title', 'topicName', 'url'])
  assert.equal(sent.eventType, 'resource_saved')
})

test('a retry sends the same clientEventId, so the server can save once', async () => {
  const calls = server({ '/api/nova/learning-events': REFUSED, '/api/me': () => json(200, { id: 'u1' }) })
  await saveLink(LINK)
  await saveLink(LINK)
  const ids = calls.filter(c => c.method === 'POST').map(c => (JSON.parse(c.body!) as { clientEventId: string }).clientEventId)
  assert.deepEqual(ids, ['web-1', 'web-1'])
})

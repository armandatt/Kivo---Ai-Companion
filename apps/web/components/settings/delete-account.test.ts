// What the Delete account button does with the server's answer. Run with `npm test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { requestAccountDeletion } from './delete-account'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function server(routes: Record<string, () => Response>) {
  const calls: Array<{ path: string; method: string }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push({ path, method: init?.method ?? 'GET' })
    const route = routes[path]
    if (!route) throw new Error(`unexpected request to ${path}`)
    return route()
  }) as typeof fetch
  return calls
}

test('when the server confirms the deletion, the session is cleared and the outcome is ok', async () => {
  const calls = server({ '/api/delete-account': () => json(200, { ok: true }), '/api/logout': () => json(200, { message: 'Logged out' }) })
  assert.deepEqual(await requestAccountDeletion(), { ok: true })
  assert.deepEqual(calls, [{ path: '/api/delete-account', method: 'DELETE' }, { path: '/api/logout', method: 'POST' }], 'signed out after the confirmation, not before')
})

test('when the server fails, nothing is cleared, and the learner is told the account was not deleted', async () => {
  const calls = server({ '/api/delete-account': () => json(500, { error: 'Internal error' }), '/api/logout': () => json(200, {}) })
  const outcome = await requestAccountDeletion()
  assert.equal(outcome.ok, false)
  assert.ok(!outcome.ok && outcome.reason === 'failed' && outcome.message.includes('not deleted'))
  assert.deepEqual(calls.map(c => c.path), ['/api/delete-account'], 'the session is left alone, so they can try again')
})

test('when the request never arrives, it is a failure, not a success', async () => {
  const calls = server({ '/api/delete-account': () => { throw new Error('offline') }, '/api/logout': () => json(200, {}) })
  const outcome = await requestAccountDeletion()
  assert.ok(!outcome.ok && outcome.reason === 'failed')
  assert.deepEqual(calls.map(c => c.path), ['/api/delete-account'])
})

test('an answer that is 200 but does not confirm the deletion is not taken as one', async () => {
  for (const body of [{}, { ok: false }, { error: 'nope' }, 'not json at all']) {
    const calls = server({ '/api/delete-account': () => typeof body === 'string' ? new Response(body, { status: 200 }) : json(200, body), '/api/logout': () => json(200, {}) })
    const outcome = await requestAccountDeletion()
    assert.equal(outcome.ok, false, JSON.stringify(body))
    assert.deepEqual(calls.map(c => c.path), ['/api/delete-account'])
  }
})

test('a signed-out browser is told so, and nothing is claimed deleted', async () => {
  const calls = server({ '/api/delete-account': () => json(401, { error: 'Unauthenticated' }) })
  const outcome = await requestAccountDeletion()
  assert.ok(!outcome.ok && outcome.reason === 'signed_out' && outcome.message.includes('nothing was deleted'))
  assert.equal(calls.length, 1)
})

test('if clearing the session fails after a confirmed deletion, the deletion still stands', async () => {
  server({ '/api/delete-account': () => json(200, { ok: true }), '/api/logout': () => { throw new Error('offline') } })
  assert.deepEqual(await requestAccountDeletion(), { ok: true })
})

// The page itself: it leaves only on a confirmed deletion, and shows the
// reason otherwise.
test('the settings page leaves only when the deletion is confirmed, and shows why when it is not', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const page = readFileSync(resolve(here, 'account-settings.tsx'), 'utf8')
  const handler = page.slice(page.indexOf('async function handleDeleteAccount'), page.indexOf('return (', page.indexOf('async function handleDeleteAccount')))
  assert.ok(handler.includes('requestAccountDeletion()'))
  assert.ok(!handler.includes("fetch("), 'the page does not call the server itself')
  const leave = handler.indexOf('window.location.href')
  assert.ok(leave > handler.indexOf('outcome.ok'), 'it leaves only inside the confirmed branch')
  assert.ok(handler.includes('setDeleteError(outcome.message)'))
  assert.ok(page.includes('{deleteError}'), 'and the message is on the page')
})

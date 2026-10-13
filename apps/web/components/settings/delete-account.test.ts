// What the Delete account button does with the server's answer. Run with `npm test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { requestAccountDeletion } from './delete-account'
import { trappedTabTarget } from './dialog-focus'

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

// ── Reaching it from Settings ─────────────────────────────────────────────────
// The section the Settings page renders. Read as source, like the test above:
// the web app has no component test runner.

const here = dirname(fileURLToPath(import.meta.url))
const section  = readFileSync(resolve(here, 'delete-account-section.tsx'), 'utf8')
const settings = readFileSync(resolve(here, '../../app/(dashboard)/settings/page.tsx'), 'utf8')

test('Settings renders the delete-account section, for every account', () => {
  assert.ok(settings.includes("import { DeleteAccountSection } from '@/components/settings/delete-account-section'"))
  const at = settings.indexOf('<DeleteAccountSection />')
  assert.ok(at > -1, 'the section is on the page')
  // Not inside a companion-only block: the nearest conditional before it has closed.
  const before = settings.slice(0, at)
  assert.ok(before.lastIndexOf("companion === 'Nova' && (") < before.lastIndexOf(')}'), 'it is outside the Nova-only blocks')
  assert.ok(!settings.includes('<form'), 'the page itself has no form the section could be submitted by')
})

test('the section sends the request only through the one helper, and only from its own submit', () => {
  assert.ok(section.includes("import { requestAccountDeletion } from './delete-account'"))
  assert.equal(section.split('requestAccountDeletion()').length - 1, 1, 'one call site')
  assert.ok(!section.includes('fetch('), 'it does not call the server itself')
  assert.ok(!section.includes('/api/'), 'and names no route')
  const handler = section.slice(section.indexOf('async function handleDeleteAccount'), section.indexOf('return (', section.indexOf('async function handleDeleteAccount')))
  assert.ok(handler.includes('requestAccountDeletion()'), 'the call is in the submit handler')
  assert.ok(handler.indexOf('if (!ready || deleting) return') < handler.indexOf('requestAccountDeletion()'), 'guarded before the call')
  assert.ok(handler.includes('e.preventDefault()'))
  // Nothing runs it on mount or on opening the dialog.
  for (const effect of section.split('useEffect(').slice(1)) assert.ok(!effect.slice(0, effect.indexOf('}, [')).includes('requestAccountDeletion'))
  assert.equal(section.split('handleDeleteAccount').length - 1, 2, 'defined once, used once: by the form')
  assert.ok(section.includes('onSubmit={handleDeleteAccount}'))
})

test('the request cannot be sent until the word is typed, and not twice', () => {
  assert.ok(section.includes("const CONFIRM_WORD = 'DELETE'"))
  assert.ok(section.includes('const ready = typed === CONFIRM_WORD'))
  assert.ok(section.includes('type="submit" disabled={!ready || deleting}'))
  // The button that opens the dialog, and the ones that close it, submit nothing.
  const buttons = section.split('<button').slice(1).map(b => b.slice(0, b.indexOf('>')))
  assert.equal(buttons.filter(b => b.includes('type="submit"')).length, 1)
  assert.equal(buttons.filter(b => b.includes('type="button"')).length, buttons.length - 1)
  // Closing empties what was typed, so reopening starts from nothing.
  assert.ok(section.includes("setOpen(false); setTyped(''); setError('')"))
})

test('the section leaves only on a confirmed deletion, and shows the reason otherwise', () => {
  const handler = section.slice(section.indexOf('async function handleDeleteAccount'), section.indexOf('return (', section.indexOf('async function handleDeleteAccount')))
  const leave = handler.indexOf('window.location.href')
  assert.ok(leave > handler.indexOf('outcome.ok'), 'it leaves only inside the confirmed branch')
  assert.ok(handler.indexOf('setError(outcome.message)') > leave, 'a refusal is shown, and the page is not left')
  assert.ok(handler.includes('setDeleting(false)'), 'and they can try again')
  assert.ok(section.includes('{error && <p role="alert"'), 'the message is on the page')
  // While the request is out the dialog cannot be dismissed from under its answer.
  assert.ok(section.includes('if (deleting) return'))
})

test('the dialog is a labelled modal that Escape and Cancel close', () => {
  assert.ok(section.includes('role="dialog" aria-modal="true" aria-labelledby="delete-account-title"'))
  assert.ok(section.includes("e.key === 'Escape'"))
  assert.ok(section.includes('htmlFor="delete-account-confirm"'))
  // Written with the app's tokens, so it reads in the light theme too.
  assert.ok(!section.includes('#'), 'no hard-coded colours')
  assert.ok(!section.includes('style={{'))
})

// ── Keyboard focus in the dialog ──────────────────────────────────────────────
// The rule for where Tab goes is run for real, on stand-in elements. That the
// section applies it is read from source: no browser renders the dialog here,
// so these do not show that focus actually moves on screen.

test('Tab and Shift+Tab wrap at the ends of the dialog and are left alone in between', () => {
  const [close, field, cancel, confirm, dialog] = ['close', 'field', 'cancel', 'confirm', 'dialog']
  const stops = [close, field, cancel, confirm]
  assert.equal(trappedTabTarget(stops, confirm, false, dialog), close, 'Tab on the last stop goes to the first')
  assert.equal(trappedTabTarget(stops, close, true, dialog), confirm, 'Shift+Tab on the first goes to the last')
  assert.equal(trappedTabTarget(stops, field, false, dialog), null, 'in between, the browser moves focus itself')
  assert.equal(trappedTabTarget(stops, cancel, true, dialog), null)
  // The confirm button is disabled until the word is typed, so Cancel is the last stop then.
  assert.equal(trappedTabTarget([close, field, cancel], cancel, false, dialog), close)
})

test('focus that is on the dialog itself, or outside it, is brought back in', () => {
  const stops = ['close', 'field', 'cancel']
  for (const active of ['dialog', 'a link on the page behind', null]) {
    assert.equal(trappedTabTarget(stops, active, false, 'dialog'), 'close')
    assert.equal(trappedTabTarget(stops, active, true, 'dialog'), 'cancel')
  }
})

test('while every control is disabled, Tab stays on the dialog', () => {
  assert.equal(trappedTabTarget([], 'dialog', false, 'dialog'), 'dialog')
  assert.equal(trappedTabTarget([], null, true, 'dialog'), 'dialog')
})

test('the section moves focus in on opening, traps Tab, and gives focus back on closing', () => {
  assert.ok(section.includes("import { trappedTabTarget } from './dialog-focus'"))
  // In: the field on opening; the dialog itself while its controls are disabled.
  assert.ok(section.includes('(deleting ? dialogRef.current : inputRef.current)?.focus()'))
  assert.ok(section.includes('ref={dialogRef} tabIndex={-1}'), 'the dialog can hold focus')
  assert.ok(section.includes('ref={inputRef} id="delete-account-confirm"'))
  // Trapped: every Tab while open is asked about, and only enabled controls count.
  assert.ok(section.includes("if (e.key !== 'Tab') return"))
  assert.ok(section.includes('trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, dialog)'))
  assert.ok(section.includes('if (target) { e.preventDefault(); target.focus() }'))
  assert.ok(section.includes('button:not([disabled])') && section.includes('input:not([disabled])'))
  // Back: closing returns focus to the button that opened it, and is refused mid-request.
  const close = section.slice(section.indexOf('const close = useCallback'), section.indexOf('}, [deleting])'))
  assert.ok(close.indexOf('if (deleting) return') < close.indexOf('setOpen(false)'))
  assert.ok(close.indexOf('openerRef.current?.focus()') > close.indexOf('setOpen(false)'))
  assert.ok(section.includes('ref={openerRef} type="button"'))
  assert.ok(section.includes("if (e.key === 'Escape') { close(); return }"), 'Escape goes through the same close')
})

test('the dialog is described, says when it is busy, and its error is announced', () => {
  assert.ok(section.includes('aria-describedby="delete-account-warning"') && section.includes('<p id="delete-account-warning"'))
  assert.ok(section.includes('aria-busy={deleting}'))
  assert.ok(section.includes('aria-label="Close"'))
  assert.ok(section.includes('{error && <p role="alert"'))
})

test('the copy does not promise that everything is erased', () => {
  const copy = section.slice(section.indexOf('return ('))
  for (const promise of ['all data', 'all your data', 'everything', 'the data stored with it']) assert.ok(!copy.includes(promise), promise)
  // What the deletion service leaves in place is said (services/accountDeletion.service.ts).
  assert.ok(copy.includes('A Telegram chat with Rex, or one that another account is also connected to, is not deleted.'))
})

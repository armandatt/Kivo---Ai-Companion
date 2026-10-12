// Who is let into the dashboard. Run with `npm test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dashboardEntry } from './dashboard-entry'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string) => readFileSync(resolve(web, path), 'utf8')

test('a new account with no profile yet (a first Google sign-in) is sent to the quiz', () => {
  assert.equal(dashboardEntry({ exists: true, onboardingComplete: undefined }), '/onboarding')
  assert.equal(dashboardEntry({ exists: true, onboardingComplete: null }), '/onboarding')
})

test('an account that started the quiz and did not finish is sent back to it', () => {
  assert.equal(dashboardEntry({ exists: true, onboardingComplete: false }), '/onboarding')
})

test('an account that finished the quiz is let in', () => {
  assert.equal(dashboardEntry({ exists: true, onboardingComplete: true }), 'enter')
})

test('a session whose account no longer exists is sent to sign in, whatever it claims', () => {
  assert.equal(dashboardEntry({ exists: false, onboardingComplete: true }), '/signin')
  assert.equal(dashboardEntry({ exists: false, onboardingComplete: undefined }), '/signin')
})

// The fault this guards against: Next's redirect() works by throwing, so a
// redirect called inside the layout's try block was caught as if the database
// had failed, and the account was let in.
test('the layout redirects outside its try block, so the redirect cannot be swallowed', () => {
  const layout = read('app/(dashboard)/layout.tsx')
  const tryStart = layout.indexOf('try {', layout.indexOf('export default'))
  const tryEnd   = layout.indexOf('} catch', tryStart)
  assert.ok(tryStart > 0 && tryEnd > tryStart, 'the lookup is still guarded')
  assert.ok(!layout.slice(tryStart, tryEnd).includes('redirect('), 'no redirect inside the guarded lookup')
  assert.ok(layout.slice(tryEnd).includes('redirect(entry)'), 'the decision is acted on after it')
})

// Neither destination may ask the question again, or a request could loop.
test('the quiz and the sign-in page sit outside the dashboard layout and send nobody back', () => {
  for (const page of ['app/onboarding/page.tsx', 'app/(auth)/signin/page.tsx']) {
    assert.ok(!read(page).includes('dashboardEntry'), `${page} does not decide dashboard entry`)
  }
  assert.ok(!read('app/onboarding/page.tsx').includes('redirect('), 'the quiz page redirects nobody')
  // Finishing the quiz is what flips the answer, so the quiz leads out, not round.
  assert.ok(read('components/onboarding-flow.tsx').includes("router.push('/home')"))
})

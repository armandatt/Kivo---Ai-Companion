// The web app's auth proxy: every sign-in, signup and reset request from the
// browser goes through it to the API. What it does when it is not configured,
// when the API cannot be reached or answers with something that is not the
// API, and that it never puts a request's details in the log or the reply.
// The API is a stubbed fetch. Run with `npm test`.

import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from '@repo/api/auth/proxy-headers'
import { AUTH_ROUTE_MAX_DURATION_SECONDS, AUTH_UNAVAILABLE, UPSTREAM_TIMEOUT_MS, apiBase, proxyAuth } from './auth-proxy'

const SITE = 'https://www.thekio.in'
const API = 'https://kio-api.example'
const BODY = { email: 'asha.rao@example.com', password: 'correct horse 42' }
const saved = { ...process.env }
// The shared secret's variable, set and removed by the tests below.
const SECRET_VAR = 'JWT_SECRET'

let logged: string[]
const original = { error: console.error, warn: console.warn }

beforeEach(() => {
  logged = []
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')) }
  console.warn = (...args: unknown[]) => { logged.push(args.join(' ')) }
  process.env[SECRET_VAR] = 'test-secret-not-a-real-one'
})

afterEach(() => {
  console.error = original.error
  console.warn = original.warn
  process.env = { ...saved }
})

type Call = { url: string; init: RequestInit }

function stub(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchStub = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return reply(call)
  }) as typeof fetch
  return { calls, fetch: fetchStub }
}

function browserRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: JSON.stringify(BODY),
  })
}

const env = (extra: Record<string, string | undefined> = {}) => ({ API_URL: API, NEXT_PUBLIC_APP_URL: SITE, NODE_ENV: 'production', ...extra })
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function nothingLeaked(body: unknown) {
  const text = JSON.stringify(body)
  for (const secret of [BODY.email, BODY.password, 'test-secret-not-a-real-one']) {
    assert.ok(!text.includes(secret), 'the reply repeats part of the request')
    assert.ok(!logged.join('\n').includes(secret), 'the log repeats part of the request')
  }
}

test('the API base is API_URL without a trailing slash; production has no default', () => {
  assert.equal(apiBase({ API_URL: `${API}/` }), API)
  assert.equal(apiBase({ API_URL: `  ${API}  ` }), API)
  assert.equal(apiBase({}), 'http://localhost:3001')
  assert.equal(apiBase({ NODE_ENV: 'production' }), null)
  assert.equal(apiBase({ API_URL: 'kio-api.example', NODE_ENV: 'production' }), null)
  assert.equal(apiBase({ API_URL: 'ftp://kio-api.example' }), null)
})

test('forgot-password is passed on to the API and its reply comes back as it was', async () => {
  const api = stub(() => json(200, { message: "If an account with that email exists, we've sent instructions to it." }))
  const response = await proxyAuth(browserRequest('/api/forgot-password'), '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env() })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { message: "If an account with that email exists, we've sent instructions to it." })
  assert.equal(api.calls[0]!.url, `${API}/api/forgot-password`)
  assert.equal(api.calls[0]!.init.body, JSON.stringify(BODY))
  const headers = api.calls[0]!.init.headers as Record<string, string>
  assert.match(headers[PROXY_PROOF_HEADER]!, /^[0-9a-f]{64}$/)
  assert.equal(headers[PROXY_CLIENT_IP_HEADER], '203.0.113.7')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.deepEqual(logged, [])
})

test('a missing API_URL in production is a 503 with a short message, and the reason is logged', async () => {
  const api = stub(() => json(200, {}))
  const response = await proxyAuth(browserRequest('/api/forgot-password'), '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env({ API_URL: undefined }) })

  assert.equal(response.status, 503)
  const body = await response.json()
  assert.deepEqual(body, { error: AUTH_UNAVAILABLE })
  assert.equal(api.calls.length, 0)
  assert.match(logged.join('\n'), /API_URL is not set/)
  nothingLeaked(body)
})

test('an API_URL that is not an http(s) URL is refused the same way', async () => {
  const api = stub(() => json(200, {}))
  const response = await proxyAuth(browserRequest('/api/login'), '/api/login', { grantSession: true, fetch: api.fetch, env: env({ API_URL: 'kio-api.example' }) })

  assert.equal(response.status, 503)
  assert.equal(api.calls.length, 0)
  assert.match(logged.join('\n'), /API_URL is not an http\(s\) URL/)
})

test('a missing JWT_SECRET in production is a 503 that names the setting, not a crash', async () => {
  delete process.env[SECRET_VAR]
  ;(process.env as Record<string, string>).NODE_ENV = 'production'
  const api = stub(() => json(200, {}))
  const response = await proxyAuth(browserRequest('/api/forgot-password'), '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env() })

  assert.equal(response.status, 503)
  const body = await response.json()
  assert.deepEqual(body, { error: AUTH_UNAVAILABLE })
  assert.equal(api.calls.length, 0)
  assert.match(logged.join('\n'), /JWT_SECRET is not set/)
  nothingLeaked(body)
})

test('an API that cannot be reached is a 502, logged by the kind of failure only', async () => {
  const api = stub(() => { throw Object.assign(new TypeError(`fetch failed for ${BODY.email}`), { code: 'ECONNREFUSED' }) })
  const response = await proxyAuth(browserRequest('/api/signup'), '/api/signup', { grantSession: false, fetch: api.fetch, env: env() })

  assert.equal(response.status, 502)
  const body = await response.json()
  assert.deepEqual(body, { error: AUTH_UNAVAILABLE })
  assert.match(logged.join('\n'), /could not be reached for \/api\/signup \(TypeError ECONNREFUSED\)/)
  nothingLeaked(body)
})

test('an API that does not answer in time is a 504, with the request given a deadline', async () => {
  const api = stub(() => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) })
  const response = await proxyAuth(browserRequest('/api/login'), '/api/login', { grantSession: true, fetch: api.fetch, env: env() })

  assert.equal(response.status, 504)
  assert.ok(api.calls[0]!.init.signal, 'the request carries a deadline')
  assert.ok(UPSTREAM_TIMEOUT_MS > 0)
  assert.match(logged.join('\n'), /did not answer \/api\/login in time/)
})

test('a reply that is not JSON (a host error page) is a 502, not passed through', async () => {
  const api = stub(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  const response = await proxyAuth(browserRequest('/api/forgot-password'), '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env() })

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: AUTH_UNAVAILABLE })
  assert.match(logged.join('\n'), /502 and no JSON/)
})

test("a platform's own reply (Railway's 'Application not found') is a 502 that points at API_URL", async () => {
  const api = stub(() => json(404, { status: 'error', code: 404, message: 'Application not found', request_id: 'abc' }))
  const response = await proxyAuth(browserRequest('/api/forgot-password'), '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env() })

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: AUTH_UNAVAILABLE })
  assert.match(logged.join('\n'), /not Kio's; check API_URL/)
})

test("the API's own refusals reach the browser with their status, message and Retry-After", async () => {
  const wrong = stub(() => json(401, { error: 'Invalid email or password' }))
  const refused = await proxyAuth(browserRequest('/api/login'), '/api/login', { grantSession: true, fetch: wrong.fetch, env: env() })
  assert.equal(refused.status, 401)
  assert.deepEqual(await refused.json(), { error: 'Invalid email or password' })
  assert.equal(refused.headers.get('set-cookie'), null)

  const limited = stub(() => json(429, { error: 'Too many attempts.', retryAfterSeconds: 60 }, { 'retry-after': '60' }))
  const paused = await proxyAuth(browserRequest('/api/login'), '/api/login', { grantSession: true, fetch: limited.fetch, env: env() })
  assert.equal(paused.status, 429)
  assert.equal(paused.headers.get('retry-after'), '60')

  const apiError = stub(() => json(500, { error: 'Something went wrong. Please try again.' }))
  const failed = await proxyAuth(browserRequest('/api/forgot-password'), '/api/forgot-password', { grantSession: false, fetch: apiError.fetch, env: env() })
  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: 'Something went wrong. Please try again.' })
  assert.deepEqual(logged, [])
})

test('a signed-in reply sets a secure, HttpOnly session cookie only when the route grants one', async () => {
  const api = stub(() => json(200, { success: true, user: { id: 'u1', email: BODY.email, name: 'Asha', image: null } }))

  const granted = await proxyAuth(browserRequest('/api/login'), '/api/login', { grantSession: true, fetch: api.fetch, env: env() })
  const cookie = granted.headers.get('set-cookie') ?? ''
  assert.match(cookie, /^kevo_session=[^;]+/)
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /Secure/i)
  assert.match(cookie, /SameSite=lax/i)
  assert.match(cookie, /Path=\//)

  const notGranted = await proxyAuth(browserRequest('/api/signup'), '/api/signup', { grantSession: false, fetch: api.fetch, env: env() })
  assert.equal(notGranted.headers.get('set-cookie'), null)
})

test('a request from another site never reaches the API', async () => {
  const api = stub(() => json(200, {}))
  const response = await proxyAuth(
    browserRequest('/api/forgot-password', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
    '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env() },
  )
  assert.equal(response.status, 403)
  assert.equal(api.calls.length, 0)
})

test('the bare domain and www are both this site, so either can send auth requests', async () => {
  const api = stub(() => json(200, { message: 'ok' }))
  for (const host of ['https://thekio.in', 'https://www.thekio.in']) {
    const req = new Request(`${host}/api/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: host, 'sec-fetch-site': 'same-origin', host: new URL(host).host },
      body: JSON.stringify({ email: BODY.email }),
    })
    const response = await proxyAuth(req, '/api/forgot-password', { grantSession: false, fetch: api.fetch, env: env() })
    assert.equal(response.status, 200, host)
  }
})

test('every route that waits on the API may run longer than the wait, so a slow API is answered, not cut off', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const apiDir = fileURLToPath(new URL('.', import.meta.url))
  const routes = (readdirSync(apiDir, { recursive: true }) as string[])
    .filter((path) => path.endsWith('route.ts'))
    .map((path) => ({ path, source: readFileSync(join(apiDir, path), 'utf8') }))
    .filter(({ source }) => source.includes('proxyAuth(') || source.includes('UPSTREAM_TIMEOUT_MS'))

  assert.deepEqual(routes.map(({ path }) => path.split('\\').join('/')).sort(), [
    'forgot-password/route.ts',
    'login/route.ts',
    'onboarding/route.ts',
    'reset-password/route.ts',
    'signup/resend/route.ts',
    'signup/route.ts',
    'signup/verify/route.ts',
  ])
  assert.ok(AUTH_ROUTE_MAX_DURATION_SECONDS * 1000 > UPSTREAM_TIMEOUT_MS, 'the wait must end before the function does')
  for (const { path, source } of routes) {
    const declared = source.match(/^export const maxDuration = (\d+)$/m)
    assert.ok(declared, `${path} declares no maxDuration`)
    assert.equal(Number(declared[1]), AUTH_ROUTE_MAX_DURATION_SECONDS, path)
  }
})

test('the pages ask for the same things the API does: any valid email, and a reset token kept out of the address bar', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const signup = read('../(auth)/signup/page.tsx')
  assert.ok(signup.includes('isValidSignupEmail(normalized)'))
  assert.ok(!/gmail/i.test(signup), 'the signup page still talks about Gmail')
  const reset = read('../reset-password/page.tsx')
  assert.ok(reset.includes("window.history.replaceState(null, '', window.location.pathname)"))
})

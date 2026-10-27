// The extension's own modules, and an audit of what it is able to do at all.
// Run: npm test --workspace nova-extension   (node --test, no dependencies)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { ADAPTERS, describePage } from '../src/lib/page.js'
import { WORDS, buildEvent, buildQuestion, createClient, disconnectOutcome, newActionId } from '../src/lib/api.js'
import { createStore } from '../src/lib/store.js'
import { NO_PROBE, probePage, readProbe } from '../src/lib/browser.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src  = name => readFileSync(join(root, 'src', name), 'utf8')
const sources = ['popup.js', 'lib/api.js', 'lib/browser.js', 'lib/page.js', 'lib/store.js'].map(name => ({ name, text: src(name) }))
const code = text => text.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*')).join('\n')

// ── What the extension is allowed to do ───────────────────────────────────────

test('manifest: activeTab, scripting and storage, and nothing else', () => {
  const manifest = JSON.parse(src('manifest.template.json'))
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage'])
  for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'web_accessible_resources', 'externally_connectable', 'content_security_policy', 'chrome_url_overrides', 'devtools_page', 'side_panel', 'omnibox', 'commands']) {
    assert.equal(manifest[key], undefined, `${key} is not declared`)
  }
  assert.ok(!JSON.stringify(manifest).match(/<all_urls>|\*:\/\/|history|tabs"|webRequest|cookies|bookmarks|clipboard|downloads|webNavigation|debugger/))
  assert.deepEqual(Object.keys(manifest.action).sort(), ['default_icon', 'default_popup', 'default_title'])
})

test('there is no background script and no content script: nothing runs while the popup is closed', () => {
  assert.deepEqual(readdirSync(join(root, 'src')).sort(), ['lib', 'manifest.template.json', 'popup.css', 'popup.html', 'popup.js'])
  assert.deepEqual(readdirSync(join(root, 'src', 'lib')).sort(), ['api.js', 'browser.js', 'page.js', 'store.js'])
})

test('the code uses four browser APIs, all in one file: the active tab, opening a tab, extension storage, and one read of that tab', () => {
  const used = new Set()
  for (const { text } of sources) for (const m of code(text).matchAll(/chrome\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) used.add(`${m[1]}.${m[2]}`)
  assert.deepEqual([...used].sort(), ['scripting.executeScript', 'storage.local', 'tabs.create', 'tabs.query'])
  // lib/browser.js is the adapter: no other file names the browser's API.
  for (const { name, text } of sources) if (name !== 'lib/browser.js') assert.ok(!code(text).match(/\bchrome\b/), `${name} goes through lib/browser.js`)
  const all = sources.map(s => code(s.text)).join('\n')
  assert.match(all, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/)
  assert.equal((all.match(/chrome\.tabs\.query/g) ?? []).length, 1, 'the active tab is the only tab ever asked about')
})

test('inside a page it reads the selection and the canonical link, once, and nothing else', () => {
  const adapter = code(src('lib/browser.js'))
  assert.equal((adapter.match(/executeScript/g) ?? []).length, 1, 'one way into a page')
  assert.match(adapter, /chrome\.scripting\.executeScript\(\{ target: \{ tabId \}, func: probePage \}\)/, 'that one tab, that one function, no files and no all-frames')
  const probe = adapter.match(/export function probePage\(\) \{[\s\S]*?\n\}/)[0]
  assert.match(probe, /window\.getSelection/)
  assert.match(probe, /link\[rel~="canonical"\]\[href\]/)
  assert.ok(!probe.match(/innerText|textContent|innerHTML|outerHTML|\.body|forms|\.value|cookie|localStorage|sessionStorage|fetch|XMLHttpRequest|querySelectorAll|addEventListener|MutationObserver/), 'no page text, forms, cookies, storage, requests or listeners')
  assert.equal((probe.match(/document\./g) ?? []).length, 1, 'one look at the document: the canonical link')
})

test('what the page probe returns is read as data, and a long selection is not cut silently', () => {
  assert.deepEqual(readProbe({ selection: '  Spaced repetition\nworks. ', canonical: 'https://user:pw@example.com/a#top' }, 2000),
    { available: true, selection: 'Spaced repetition\nworks.', tooLong: false, canonicalUrl: 'https://example.com/a' })
  assert.deepEqual(readProbe({ selection: 'x'.repeat(2001), canonical: null }, 2000), { available: true, selection: '', tooLong: true, canonicalUrl: null })
  for (const canonical of ['javascript:alert(1)', 'chrome://settings', 'not an address', 42, `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(readProbe({ selection: '', canonical }, 2000).canonicalUrl, null)
  }
  for (const raw of [null, undefined, 'text', 42, [], { selection: 42 }]) assert.deepEqual(readProbe(raw, 2000), { available: true, selection: '', tooLong: false, canonicalUrl: null })
  assert.deepEqual(NO_PROBE, { available: false, selection: '', tooLong: false, canonicalUrl: null })
  assert.equal(typeof probePage, 'function')
})

test('the selection is sent only by its own button, and never with a page save or a study request', () => {
  const selected = buildEvent({ eventType: 'selection_saved', clientEventId: 'x', page, excerpt: 'A passage.' })
  assert.equal(selected.excerpt, 'A passage.')
  for (const eventType of ['resource_saved', 'study_requested']) {
    assert.ok(!('excerpt' in buildEvent({ eventType, clientEventId: 'x', page, excerpt: 'A passage.' })), `${eventType} carries no passage`)
  }
  const popup = code(src('popup.js'))
  assert.match(popup, /send\('selection_saved', saveSelection, /)
  assert.equal((popup.match(/'selection_saved'/g) ?? []).length, 2, 'named where it is sent and where its result is shown')
})

test('Add to notes opens Nova\'s capture page with the page and selection in the fragment, and sends nothing itself', () => {
  const popup = code(src('popup.js'))
  const at = popup.indexOf('const toNotes')
  assert.ok(at !== -1)
  const handler = popup.slice(at, popup.indexOf('const buttons', at))
  assert.match(handler, /openNova\(`\/notes\/capture#\$\{p\.toString\(\)\}`\)/)
  assert.doesNotMatch(handler, /client\.|fetch\(|sendEvent/, 'no request: the web page saves it, signed in as usual')
  assert.match(handler, /p\.set\('via', 'extension'\)/)
})

test('it keeps nothing in page-readable storage, writes no markup and runs nothing on a timer', () => {
  const all = sources.map(s => code(s.text)).join('\n')
  assert.ok(!all.match(/chrome\.history|chrome\.cookies|chrome\.webRequest|chrome\.webNavigation|chrome\.runtime\.onMessage|captureVisibleTab|chrome\.tabs\.(onUpdated|onActivated|sendMessage|get\b)/), 'no way into a page, its history or its traffic')
  assert.ok(!all.match(/localStorage|sessionStorage|document\.cookie|indexedDB|chrome\.storage\.sync/), 'no page-readable or synced storage')
  assert.ok(!all.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/), 'page titles are set as text, never as markup')
  assert.ok(!all.match(/setInterval|chrome\.alarms|chrome\.idle/), 'nothing runs on a timer')
})

test('the only address it talks to is Nova, fixed at build time', () => {
  const all = sources.map(s => code(s.text)).join('\n')
  const urls = [...all.matchAll(/https?:\/\/[^\s'"`]+/g)].map(m => m[0])
  assert.deepEqual(urls, [], 'no address is written into the code')
  assert.equal((all.match(/\bfetch\(/g) ?? []).length, 1, 'one fetch, inside the client the popup builds')
  assert.match(code(src('lib/api.js')), /doFetch\(`\$\{baseUrl\}\$\{path\}`/)
  assert.match(code(src('lib/api.js')), /credentials: 'omit'/)
  assert.ok(!all.match(/openai|anthropic|gemini|\/api\/nova\/message/i), 'no LLM call and no chat route')
  const paths = [...code(src('lib/api.js')).matchAll(/call\('([^']+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(paths, ['/api/nova/extension/ask', '/api/nova/extension/connect', '/api/nova/extension/context', '/api/nova/extension/disconnect', '/api/nova/learning-events'])
})

test('the popup page loads only its own files', () => {
  const html = src('popup.html')
  assert.deepEqual([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).sort(), ['popup.css', 'popup.js'])
  assert.ok(!html.match(/<script(?![^>]*src=)[^>]*>\s*\S/), 'no inline script')
  assert.ok(!html.match(/\son[a-z]+="/), "no inline handlers")
})

test('every permission is explained in the popup', () => {
  const popup = src('popup.js')
  assert.match(popup, /"activeTab" lets Nova read this tab\\'s address and title when you click its icon/)
  assert.match(popup, /"scripting" lets it read your selected text and the page\\'s own address on that tab, at that moment/)
  assert.match(popup, /"storage" keeps this browser connected/)
  assert.match(popup, /It is sent only if you press Save selection/)
  assert.match(popup, /Nothing else inside the page: no other text, no forms, no passwords/)
  assert.match(popup, /Not your other tabs, and not your history/)
})

test('the build refuses an insecure Nova address and writes exactly one', () => {
  const out = mkdtempSync(join(tmpdir(), 'nova-ext-'))
  const run = url => execFileSync('node', [join(root, 'scripts', 'build.mjs')], { env: { ...process.env, NOVA_URL: url, NOVA_EXTENSION_OUT: out }, stdio: 'pipe' }).toString()
  assert.throws(() => run('http://nova.example.com'))
  assert.throws(() => run('not a url'))
  run('https://nova.example.com/some/path?x=1')
  assert.equal(readFileSync(join(out, 'config.js'), 'utf8').match(/NOVA_URL = "(.*)"/)[1], 'https://nova.example.com')
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage'])
  assert.equal(manifest.host_permissions, undefined)
  assert.equal(readFileSync(join(out, 'icons', '128.png')).subarray(1, 4).toString(), 'PNG')
})

test('a build for real use refuses a missing, local or insecure Nova address', () => {
  const out = mkdtempSync(join(tmpdir(), 'nova-ext-'))
  const clean = { ...process.env }
  delete clean.NOVA_URL
  const run = env => execFileSync('node', [join(root, 'scripts', 'build.mjs')], { env: { ...clean, NOVA_EXTENSION_OUT: out, NOVA_RELEASE: '1', ...env }, stdio: 'pipe' }).toString()
  // The address a failure check uses, the development default, and plain http.
  for (const env of [{}, { NOVA_URL: 'http://127.0.0.1:9' }, { NOVA_URL: 'https://127.0.0.1:9' }, { NOVA_URL: 'http://localhost:3000' }, { NOVA_URL: 'http://kivo.example' }, { NOVA_URL: 'https://user:pw@kivo.example' }, { NOVA_URL: 'https://nova.local' }]) {
    assert.throws(() => run(env), /Bad NOVA_URL/, JSON.stringify(env))
  }
  run({ NOVA_URL: 'https://kivo.example' })
  assert.equal(readFileSync(join(out, 'config.js'), 'utf8').match(/NOVA_URL = "(.*)"/)[1], 'https://kivo.example')
  // Without the flag, development still builds against this machine.
  execFileSync('node', [join(root, 'scripts', 'build.mjs')], { env: { ...clean, NOVA_EXTENSION_OUT: out }, stdio: 'pipe' })
  assert.equal(readFileSync(join(out, 'config.js'), 'utf8').match(/NOVA_URL = "(.*)"/)[1], 'http://localhost:3000')
  assert.match(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['build:safari:release'], /^NOVA_RELEASE=1 node scripts\/build\.mjs && xcodebuild /)
})

test('a question about the page carries the question, the address, the title and the selection, and never the page', () => {
  assert.deepEqual(buildQuestion({ question: '  What is the spacing effect? ', page, title: ' A page ', excerpt: 'A passage.' }),
    { question: 'What is the spacing effect?', url: 'https://example.com/a', title: 'A page', excerpt: 'A passage.' })
  assert.equal(buildQuestion({ question: 'Why?', page, excerpt: '' }).excerpt, null)
  const popup = code(src('popup.js'))
  assert.equal((popup.match(/client\.ask\(/g) ?? []).length, 1, 'asked only from the form the learner submits')
  assert.match(popup, /onsubmit: async event => \{\s*event\.preventDefault\(\)\s*if \(!question\.value\.trim\(\)\) return/)
  assert.match(src('popup.js'), /Nova has not read this page: it saw only the title/)
})

// ── Reading the current page ──────────────────────────────────────────────────

test('an ordinary page is described by its address, title and site', () => {
  assert.deepEqual(describePage({ url: 'https://www.example.com/graphs/bfs?x=1', title: '  Breadth-first\n search  ' }), {
    supported: true, url: 'https://www.example.com/graphs/bfs?x=1', domain: 'example.com', kind: 'page', title: 'Breadth-first search',
  })
})

test('a fragment and a login are left out of the address', () => {
  assert.equal(describePage({ url: 'https://user:secret@example.com/a#part', title: 'A' }).url, 'https://example.com/a')
})

test('a page with no title is called by its site, and a very long title is cut', () => {
  assert.equal(describePage({ url: 'https://docs.example.org/x', title: '' }).title, 'docs.example.org')
  assert.equal(describePage({ url: 'https://docs.example.org/x' }).title, 'docs.example.org')
  assert.equal(describePage({ url: 'https://example.com/', title: 'x'.repeat(900) }).title.length, 300)
})

test('browser pages, files and other extensions are not offered', () => {
  for (const url of ['chrome://settings', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///Users/me/secret.pdf', 'view-source:https://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'devtools://devtools/x', 'edge://flags']) {
    assert.deepEqual(describePage({ url, title: 'x' }), { supported: false, reason: 'not_a_web_page' }, url)
  }
  for (const tab of [null, undefined, {}, { url: '' }, { title: 'no url' }]) assert.deepEqual(describePage(tab), { supported: false, reason: 'no_page' })
})

test('every site gets the same treatment: one generic adapter, no special cases', () => {
  assert.equal(ADAPTERS.length, 1)
  const kinds = ['https://www.youtube.com/watch?v=abc', 'https://leetcode.com/problems/two-sum/', 'https://github.com/a/b', 'https://example.edu/course'].map(url => describePage({ url, title: 'T' }).kind)
  assert.deepEqual(kinds, ['page', 'page', 'page', 'page'])
  assert.ok(!code(src('lib/page.js')).match(/youtube|leetcode|github|coursera/i))
})

// ── The event ─────────────────────────────────────────────────────────────────

const page = { supported: true, url: 'https://example.com/a', title: 'A page', domain: 'example.com', kind: 'page' }

test('an event carries the action and the page, and nothing about who the learner is', () => {
  const event = buildEvent({ eventType: 'resource_saved', clientEventId: 'id-1234567890123456', page, title: '  My title ', subjectId: 's1', topicName: ' Graphs ', now: new Date('2026-10-06T12:00:00Z') })
  assert.deepEqual(event, {
    eventType: 'resource_saved', clientEventId: 'id-1234567890123456', url: 'https://example.com/a', title: 'My title',
    capturedAt: '2026-10-06T12:00:00.000Z', subjectId: 's1', topicName: 'Graphs', canonicalUrl: null,
  })
  assert.equal(buildEvent({ eventType: 'resource_saved', clientEventId: 'x', page: { ...page, canonicalUrl: 'https://example.com/canonical' } }).canonicalUrl, 'https://example.com/canonical')
  assert.ok(!Object.keys(event).some(k => /profile|learner|user|companion|token|source|domain|body|html|metadata/i.test(k)))
})

test('a topic is sent only with a subject', () => {
  assert.equal(buildEvent({ eventType: 'resource_saved', clientEventId: 'x', page, subjectId: '', topicName: 'Graphs' }).topicName, null)
  assert.equal(buildEvent({ eventType: 'resource_saved', clientEventId: 'x', page, subjectId: '', topicName: 'Graphs' }).subjectId, null)
  assert.equal(buildEvent({ eventType: 'study_requested', clientEventId: 'x', page, subjectId: 's1', topicName: '   ' }).topicName, null)
})

test('each action gets its own id', () => {
  const ids = new Set(Array.from({ length: 200 }, newActionId))
  assert.equal(ids.size, 200)
  assert.match([...ids][0], /^[0-9a-f-]{36}$/)
})

// ── Talking to Nova ───────────────────────────────────────────────────────────

function client(respond, token = 'nvx_test') {
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return respond(url, init) }
  return { calls, api: createClient({ baseUrl: 'https://nova.test', fetch: fake, getToken: async () => token }) }
}
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('the credential goes in the Authorization header and cookies are never sent', async () => {
  const { calls, api } = client(() => json(200, { status: 'ready' }))
  await api.context()
  assert.equal(calls[0].url, 'https://nova.test/api/nova/extension/context')
  assert.equal(calls[0].init.headers.authorization, 'Bearer nvx_test')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer')
  assert.ok(!calls[0].url.includes('nvx_test'), 'never in the address')
})

test('redeeming a code sends no credential', async () => {
  const { calls, api } = client(() => json(200, { ok: true, token: 'nvx_new' }), null)
  const res = await api.connect('ABCDE-FGHJK', 'Chrome on macOS')
  assert.ok(res.ok)
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: 'ABCDE-FGHJK', label: 'Chrome on macOS' })
})

// The popup's own function, run against a stand-in for the browser's navigator.
const labelIn = navigator => new Function('navigator', `${src('popup.js').match(/function browserLabel\(\) \{[\s\S]*?\n\}/)[0]}\nreturn browserLabel()`)(navigator)

test('a connection is labelled with the browser it was made in', () => {
  const chromeAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  const safariAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
  const hints = (brand, platform) => ({ platform, brands: [{ brand: 'Not?A_Brand' }, { brand: 'Chromium' }, { brand }] })

  // Chrome and its relatives say who they are, and are believed as before.
  assert.equal(labelIn({ userAgentData: hints('Google Chrome', 'macOS'), userAgent: chromeAgent, platform: 'MacIntel' }), 'Google Chrome on macOS')
  assert.equal(labelIn({ userAgentData: hints('Microsoft Edge', 'Windows'), userAgent: chromeAgent, platform: 'Win32' }), 'Microsoft Edge on Windows')
  assert.equal(labelIn({ userAgentData: { platform: 'macOS', brands: [{ brand: 'Chromium' }] }, userAgent: chromeAgent, platform: 'MacIntel' }), 'Chrome on macOS')

  // Safari does not, and was being called Chrome.
  assert.equal(labelIn({ userAgent: safariAgent, platform: 'MacIntel' }), 'Safari on macOS')
  assert.equal(labelIn({ userAgent: safariAgent.replace('Macintosh; Intel Mac OS X 10_15_7', 'iPhone; CPU iPhone OS 26_0 like Mac OS X'), platform: 'iPhone' }), 'Safari on iPhone')

  // Anything else that says nothing keeps the old answer.
  assert.equal(labelIn({ userAgent: chromeAgent, platform: 'MacIntel' }), 'Chrome on MacIntel')
  assert.equal(labelIn({}), 'Chrome')
  for (const navigator of [{ userAgent: safariAgent, platform: 'MacIntel' }, { userAgentData: hints('Google Chrome', 'macOS') }, {}]) assert.ok(labelIn(navigator).length <= 60, 'fits the label Nova keeps')
})

test('with no credential, nothing is sent at all', async () => {
  const { calls, api } = client(() => json(200, {}), null)
  assert.deepEqual(await api.sendEvent({ any: 'thing' }), { ok: false, kind: 'unauthenticated', message: WORDS.unauthenticated })
  assert.equal(calls.length, 0)
})

test('failures come back in words a person can read, never as a status code or an address', async () => {
  const cases = [
    [() => { throw new TypeError('Failed to fetch') }, 'offline'],
    [() => json(401, { error: 'Unauthenticated' }), 'unauthenticated'],
    [() => json(429, { success: false, error: 'rate_limited', message: "That's a lot at once. Give it a minute." }), 'rate_limited'],
    [() => json(500, null), 'failed'],
    [() => json(502, { nonsense: true }), 'failed'],
    [() => json(400, { success: false, error: 'invalid_url', message: 'Nova can only keep ordinary web pages.' }), 'invalid_url'],
    [() => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } }), 'failed'],
  ]
  for (const [respond, kind] of cases) {
    const { api } = client(respond)
    const res = await api.sendEvent({ eventType: 'resource_saved' })
    assert.equal(res.ok, false)
    assert.equal(res.kind, kind)
    assert.ok(res.message.length > 10)
    assert.ok(!res.message.match(/\b(4|5)\d\d\b|POST|GET|\/api\/|fetch|JSON|token <|TypeError|https?:/), `human words: ${res.message}`)
  }
})

test('a retry sends the same action id, so Nova can store it once', async () => {
  let n = 0
  const { calls, api } = client(() => (++n === 1 ? (() => { throw new TypeError('network') })() : json(201, { success: true })))
  const event = buildEvent({ eventType: 'resource_saved', clientEventId: newActionId(), page })
  assert.equal((await api.sendEvent(event)).ok, false)
  assert.equal((await api.sendEvent(event)).ok, true)
  assert.equal(JSON.parse(calls[0].init.body).clientEventId, JSON.parse(calls[1].init.body).clientEventId)
})

// ── What it keeps ─────────────────────────────────────────────────────────────

function area() {
  const data = {}
  return { data, get: async key => ({ [key]: data[key] }), set: async items => Object.assign(data, items), remove: async key => { delete data[key] } }
}

test('the extension stores its credential and nothing else', async () => {
  const storage = area(), store = createStore(storage)
  assert.equal(await store.token(), null)
  await store.save('nvx_abc')
  assert.equal(await store.token(), 'nvx_abc')
  assert.deepEqual(Object.keys(storage.data), ['nova.connection'])
  assert.deepEqual(Object.keys(storage.data['nova.connection']).sort(), ['connectedAt', 'token'])
})

test('disconnecting forgets the credential completely', async () => {
  const storage = area(), store = createStore(storage)
  await store.save('nvx_abc')
  await store.clear()
  assert.equal(await store.token(), null)
  assert.deepEqual(storage.data, {})
})

test('Disconnect says Nova closed the connection only when Nova did', async () => {
  const answer = (status, body = {}) => createClient({ baseUrl: 'https://kivo.example', getToken: async () => 'nvx_abc', fetch: async () => new Response(JSON.stringify(body), { status }) }).disconnect()
  const down   = createClient({ baseUrl: 'https://kivo.example', getToken: async () => 'nvx_abc', fetch: async () => { throw new TypeError('Load failed') } }).disconnect()

  // Nova said so, or no longer knows the credential: closed either way.
  assert.deepEqual(disconnectOutcome(await answer(200, { ok: true })), { confirmed: true, message: WORDS.disconnected })
  assert.deepEqual(disconnectOutcome(await answer(401, { error: 'Unauthenticated' })), { confirmed: true, message: WORDS.disconnected })

  // Nova was not reached, or failed: nothing was closed there, and the words say so.
  for (const result of [await down, await answer(500, { error: 'Failed to disconnect' }), await answer(429), await answer(502)]) {
    const outcome = disconnectOutcome(result)
    assert.equal(outcome.confirmed, false)
    assert.equal(outcome.message, WORDS.disconnect_unconfirmed)
    assert.match(outcome.message, /Browser Extension page/)
    assert.doesNotMatch(outcome.message, /can no longer save/)
  }
})

test('the browser forgets its credential on Disconnect whatever Nova answered', () => {
  const body = code(src('popup.js')).match(/async function disconnect\(\) \{[\s\S]*?\n\}/)[0]
  assert.match(body, /disconnectOutcome\(await client\.disconnect\(\)\)/)
  assert.match(body, /await store\.clear\(\)/, 'cleared without a condition')
  assert.doesNotMatch(body, /\bif\b|\?\s*await|return/, 'no path leaves the credential in place')
  assert.match(body, /outcome\.confirmed \? null : /, 'an unconfirmed disconnect points at Saved')
})

test('the Safari project matches the extension: same version, and an app that opens on the macOS the extension supports', () => {
  const project = readFileSync(join(root, 'safari/Nova/Nova.xcodeproj/project.pbxproj'), 'utf8')
  const all = name => [...project.matchAll(new RegExp(`${name} = ([^;]+);`, 'g'))].map(m => m[1])
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  assert.deepEqual([...new Set(all('MARKETING_VERSION'))], [version])
  assert.deepEqual([...new Set(all('MACOSX_DEPLOYMENT_TARGET'))], ['12.0'])
  assert.ok(all('MARKETING_VERSION').length === 4 && all('MACOSX_DEPLOYMENT_TARGET').length === 4)
})

test('a damaged stored value is treated as not connected', async () => {
  for (const bad of [{ token: 42 }, { token: '' }, 'string', null, []]) {
    const storage = area(); storage.data['nova.connection'] = bad
    assert.equal(await createStore(storage).token(), null)
  }
})

// ── The release ZIP ───────────────────────────────────────────────────────────

const packageWith = (env, release = mkdtempSync(join(tmpdir(), 'nova-ext-release-'))) => {
  const clean = { ...process.env }
  delete clean.NOVA_URL
  const out = execFileSync(process.execPath, [join(root, 'scripts', 'package.mjs')], { env: { ...clean, NOVA_EXTENSION_RELEASE: release, ...env }, stdio: 'pipe' }).toString()
  return { out, zip: readFileSync(join(release, readdirSync(release)[0])), name: readdirSync(release)[0] }
}

// The names in a ZIP's central directory, in order.
function zipNames(buf) {
  const names = []
  for (let at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at !== -1 && buf.readUInt32LE(at) === 0x02014b50; ) {
    const length = buf.readUInt16LE(at + 28)
    names.push(buf.subarray(at + 46, at + 46 + length).toString('utf8'))
    at += 46 + length + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return names
}

test('a release is refused without an https address that is somewhere else', () => {
  for (const env of [{}, { NOVA_URL: 'http://kivo.example' }, { NOVA_URL: 'https://localhost:3000' }, { NOVA_URL: 'https://127.0.0.1' }, { NOVA_URL: 'https://user:pw@kivo.example' }, { NOVA_URL: 'nonsense' }]) {
    assert.throws(() => packageWith(env), /Cannot package/, JSON.stringify(env))
  }
})

test('the release ZIP holds the built extension and nothing else', () => {
  const { zip, name, out } = packageWith({ NOVA_URL: 'https://kivo.example/some/path' })
  assert.equal(name, `nova-extension-${JSON.parse(src('manifest.template.json')).version}.zip`)
  assert.deepEqual(zipNames(zip), ['config.js', 'icons/128.png', 'icons/16.png', 'icons/48.png', 'lib/api.js', 'lib/browser.js', 'lib/page.js', 'lib/store.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js'])
  assert.match(out, /sha256 [0-9a-f]{64}/)
  assert.match(out, /for https:\/\/kivo\.example\n/)
})

test('the same sources and address give the same ZIP, byte for byte', () => {
  const first = packageWith({ NOVA_URL: 'https://kivo.example' }).zip
  const again = packageWith({ NOVA_URL: 'https://kivo.example' }).zip
  assert.ok(first.equals(again))
  assert.ok(!first.equals(packageWith({ NOVA_URL: 'https://other.example' }).zip), 'the address is part of what is shipped')
})

test('the extension and its package.json agree on the version, and the description fits the store', () => {
  const manifest = JSON.parse(src('manifest.template.json'))
  assert.equal(manifest.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  assert.ok(manifest.description.length <= 132)
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
})

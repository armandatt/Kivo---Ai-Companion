// Nova's browser agent and where captures are filed: what the code may do,
// and how the loop behaves. Run: npm test --workspace nova-extension (node --test).
// The page functions themselves (lib/agent-page.js) run in a real browser in
// test/browser/agent-pages.mjs (Chrome for Testing, fixture pages).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { allowedUrl, carriesPrivate, createBrowserTools, needsConfirmation, partsOf, quoteOnPage, readableUrl, sitePattern } from '../src/lib/agent-tools.js'
import { DEFAULT_LIMITS, createAgent, newState, stepInput } from '../src/lib/agent.js'
import { filterOptions, subjectOptions, topicOptions } from '../src/lib/places.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src  = name => readFileSync(join(root, 'src', name), 'utf8')
const code = text => text.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*')).join('\n')
const AGENT = ['lib/agent.js', 'lib/agent-tools.js', 'lib/agent-page.js', 'lib/agent-runtime.js', 'lib/agent-view.js'].map(name => ({ name, text: code(src(name)) }))

// ── What the agent may do at all ──────────────────────────────────────────────

test('the agent uses only tab, scripting, permission, session and badge APIs, and nothing that reaches cookies, history, traffic or downloads', () => {
  const used = new Set()
  for (const { text } of AGENT) for (const m of text.matchAll(/chrome\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) used.add(`${m[1]}.${m[2]}`)
  const allowed = new Set(['tabs.get', 'tabs.create', 'tabs.update', 'tabs.remove', 'tabs.goBack', 'tabs.goForward', 'tabs.query', 'scripting.executeScript', 'permissions.remove', 'permissions.contains', 'storage.session', 'storage.local', 'runtime.getPlatformInfo', 'runtime.id', 'runtime.getURL', 'action.setBadgeText', 'action.setBadgeBackgroundColor', 'sidePanel.setOptions'])
  for (const api of used) assert.ok(allowed.has(api), `${api} is not something the agent may use`)
  const all = AGENT.map(r => r.text).join('\n')
  assert.ok(!all.match(/chrome\.(cookies|history|webRequest|webNavigation|downloads|bookmarks|debugger|tabs\.captureVisibleTab)/), 'no cookies, history, traffic, downloads, debugger or screenshots')
  assert.ok(!all.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|indexedDB|document\.cookie/), 'no markup, no code from text, no page storage, no cookies')
  assert.ok(!all.match(/world: ?'MAIN'/), 'its functions run in the extension\'s own world, never the page\'s')
  // The one timer: the keep-alive while a task runs (a trivial call), stopped when it is not.
  const runtime = code(src('lib/agent-runtime.js'))
  // (settleDom's own timer runs inside the page, only while it waits for the page to settle.)
  assert.equal((AGENT.filter(r => r.name !== 'lib/agent-page.js').map(r => r.text).join('\n').match(/setInterval/g) ?? []).length, 1)
  assert.match(runtime, /setInterval\(\(\) => \{ void chrome\.runtime\.getPlatformInfo\(\) \}, KEEPALIVE_MS\)/)
  assert.match(runtime, /awake\(s\.status === 'running'\)/)
})

test('it opens its own tabs in the background (in front when watched), injects only its own functions, and asks for sites one at a time (or any site, by the learner\'s choice), given back when the task ends', () => {
  const tools = code(src('lib/agent-tools.js'))
  assert.match(tools, /chrome\.tabs\.create\(\{ url: allowed\.url, active: watch\(\)/, 'in the background, or in front when the learner watches')
  assert.ok(!tools.match(/files:/), 'it injects functions it ships, never files or code from the network')
  const funcs = [...tools.matchAll(/run\((?:current|tabId|searchTab), ([a-zA-Z]+)/g)].map(m => m[1]).filter(f => f !== 'func')
  const page = src('lib/agent-page.js')
  assert.ok(funcs.length >= 6)
  for (const f of new Set(funcs)) assert.match(page, new RegExp(`export function ${f}\\(`), `${f} is one of the page functions in lib/agent-page.js`)
  assert.match(tools, /export const ANY_SITE = \['https:\/\/\*\/\*', 'http:\/\/\*\/\*'\]/)
  const view = code(src('lib/agent-view.js'))
  assert.match(view, /browser\.allowSites\(origins\)/, 'asked from the learner\'s click in the panel')
  assert.match(view, /ask\(\[p\.pattern\], false\)/, 'one site')
  assert.match(view, /ask\(ANY_SITE, true\)/, 'or any site, for this task')
  const runtime = code(src('lib/agent-runtime.js'))
  assert.match(runtime, /chrome\.permissions\.remove\(\{ origins \}\)/, 'given back when the task ends')
})

test('the page reader never reads what the learner typed, passwords, cookies or storage', () => {
  const observe = src('lib/agent-page.js').match(/export function observePage\([\s\S]*?\n\}/)[0]
  assert.ok(!observe.match(/cookie|localStorage|sessionStorage|fetch|XMLHttpRequest/), 'no cookies, storage or requests')
  // A field's value is read only as "filled or empty", and as text only where the agent typed it itself (never a secret field).
  const valueLines = observe.split('\n').filter(l => /\.value\b/.test(l) && !l.trim().startsWith('//'))
  assert.equal(valueLines.length, 2)
  assert.ok(valueLines.some(l => l.includes('Boolean(el.value)')), 'filled or empty')
  assert.ok(valueLines.some(l => l.includes("!secret && el.getAttribute('data-kivo-filled') === '1'")), 'only what the agent typed, never a secret field')
  const inspect = src('lib/agent-page.js').match(/export function inspectTarget\([\s\S]*?\n\}/)[0]
  assert.ok(!inspect.match(/\.value\b/), 'what a field holds is never read, not even for its label')
  const act = src('lib/agent-page.js').match(/export function actOn\([\s\S]*?\n\}/)[0]
  assert.match(act, /type === 'password' \|\| ac\.startsWith\('cc-'\) \|\| ac === 'one-time-code'/, 'never a password, card or code field')
})

test('the only addresses the agent names are the two search pages (and the SVG namespace)', () => {
  const urls = [...AGENT.map(r => r.text).join('\n').matchAll(/https?:\/\/[^\s'"`*]+/g)].map(m => m[0])
  assert.deepEqual([...new Set(urls)].filter(u => u !== 'http://www.w3.org/2000/svg'), ['https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}', 'https://www.bing.com/search?q=${encodeURIComponent(q)}'], 'plus the SVG namespace of the watch-mode pointer, an identifier')
})

// ── Rules code applies, whatever the model asks ───────────────────────────────

test('only ordinary public web pages are opened', () => {
  assert.equal(allowedUrl('https://arxiv.org/abs/2005.11401').ok, true)
  for (const bad of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'chrome-extension://x/y', 'http://localhost:3000/admin', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.20.1.1/', 'https://user:pw@example.com/', 'http://printer.local/', 'not a url']) {
    assert.equal(allowedUrl(bad).ok, false, bad)
  }
  assert.equal(sitePattern('https://docs.github.com/en/rest?x=1'), 'https://docs.github.com/*', 'access is asked for one site')
})

test('an arXiv PDF is read from its abstract page', () => {
  assert.equal(readableUrl('https://arxiv.org/pdf/2005.11401.pdf'), 'https://arxiv.org/abs/2005.11401')
  assert.equal(readableUrl('https://example.com/a.pdf'), 'https://example.com/a.pdf')
})

test('consequential actions wait for the learner; routine ones do not', () => {
  const button = (label, extra = {}) => ({ exists: true, tag: 'button', label, isSubmit: false, form: null, ...extra })
  const form = (extra = {}) => ({ isSearch: false, hasPassword: false, hasPayment: false, method: 'post', fields: 4, ...extra })
  for (const label of ['Buy now', 'Delete', 'Post comment', 'Send message', 'Publish', 'Place order', 'Book now', 'Finish quiz']) assert.match(needsConfirmation(button(label), 'click'), /could change something/, label)
  for (const label of ['Show more', 'Next', 'Settings', 'Expand', 'Dark mode', 'Answer B']) assert.equal(needsConfirmation(button(label), 'click'), null, label)
  // Forms: moving through one is routine; submitting it, signing in or paying is not.
  assert.equal(needsConfirmation(button('Next', { isSubmit: true, form: form() }), 'click'), null, 'a quiz page\'s Next')
  assert.match(needsConfirmation(button('Submit', { isSubmit: true, form: form() }), 'click'), /submit the form/)
  assert.match(needsConfirmation(button('Save', { isSubmit: true, form: form() }), 'click'), /submit the form/)
  assert.match(needsConfirmation(button('Continue', { isSubmit: true, form: form({ hasPassword: true }) }), 'click'), /sign in/)
  assert.match(needsConfirmation(button('Continue', { isSubmit: true, form: form({ hasPayment: true }) }), 'click'), /payment/)
  assert.equal(needsConfirmation(button('Search', { isSubmit: true, form: form({ isSearch: true }) }), 'click'), null, 'a search form is fine')
  assert.match(needsConfirmation({ exists: true, tag: 'input', isField: true, form: form() }, 'press', { key: 'Enter' }), /submit the form/, 'Enter in a form field submits it')
  // Typing: any ordinary field (the learner asked); never a secret one.
  assert.equal(needsConfirmation({ exists: true, tag: 'input', isField: true, label: 'Full name' }, 'fill'), null)
  assert.equal(needsConfirmation({ exists: true, tag: 'input', isField: true, secret: 'password' }, 'fill'), 'never')
  assert.equal(needsConfirmation({ exists: true, tag: 'input', isField: true, secret: 'payment' }, 'fill'), 'never')
  // Settings: an ordinary one is routine, a security or privacy one is not.
  assert.equal(needsConfirmation({ exists: true, tag: 'input', role: '', label: 'Dark mode' }, 'check'), null)
  assert.match(needsConfirmation({ exists: true, tag: 'input', role: '', label: 'Make profile public' }, 'check'), /security or privacy/)
  assert.match(needsConfirmation({ exists: true, tag: 'input', role: 'switch', label: 'Two-factor authentication' }, 'click'), /security or privacy/)
  // Links: navigation is routine; a link that deletes or buys is not; a download is not.
  assert.equal(needsConfirmation({ exists: true, tag: 'a', label: 'Documentation' }, 'click'), null)
  assert.match(needsConfirmation({ exists: true, tag: 'a', label: 'Delete repository' }, 'click'), /could change/)
  assert.match(needsConfirmation({ exists: true, tag: 'a', label: 'file', download: true }, 'click'), /download/)
})

test('text from the learner\'s notes going into a website waits for them, whatever the page said', () => {
  const note = 'My private notes on HNSW: the graph has layers, and search starts at the top layer with few nodes, descending greedily.'
  assert.equal(carriesPrivate(`Here is my answer. ${note.slice(10, 90)} Thanks`, [note]), true)
  assert.equal(carriesPrivate('A short answer about graphs.', [note]), false)
  assert.equal(carriesPrivate('Completely different text that is long enough to be checked against the pool of notes.', [note]), false)
})

test('a finding must be on the page word for word (spacing, case and curly quotes aside)', () => {
  const page = 'Retrieval-Augmented Generation combines a  parametric memory with a non-parametric memory: a dense vector index of Wikipedia.\nIt is “state of the art”.'
  assert.equal(quoteOnPage('combines a parametric memory with a non-parametric memory', page), true)
  assert.equal(quoteOnPage('COMBINES A PARAMETRIC MEMORY with a non-parametric memory', page), true)
  assert.equal(quoteOnPage('It is "state of the art".', page), true)
  assert.equal(quoteOnPage('combines a parametric memory with a symbolic memory', page), false, 'a changed word is not a quote')
  assert.equal(quoteOnPage('memory', page), false, 'too short to be a finding')
})

test('long pages are read in parts, cut at line breaks', () => {
  const text = Array.from({ length: 400 }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n')
  const parts = partsOf(text, 6000)
  assert.ok(parts.length > 2)
  assert.ok(parts.every(p => p.length <= 6000))
  assert.equal(parts.join('\n').replace(/\s/g, ''), text.replace(/\s/g, ''), 'nothing is lost between parts')
})

test('an action the model was led to by a page is still refused by code (a link to this computer)', async () => {
  const chrome = new Proxy({}, { get: () => { throw new Error('the browser was not asked') } })
  const tools = createBrowserTools({ chrome })
  const out = await tools.open({ url: 'http://localhost:8080/delete-everything' })
  assert.equal(out.ok, false)
  assert.match(out.result, /this computer or a private network/)
})

test('a site the learner has not allowed is not opened: the task asks them', async () => {
  const chrome = { permissions: { contains: async () => false }, tabs: { create: () => { throw new Error('opened without permission') } } }
  const tools = createBrowserTools({ chrome })
  const out = await tools.open({ url: 'https://github.com/kivo/issues' })
  assert.equal(out.ok, false)
  assert.deepEqual(out.needsAccess, { site: 'github.com', pattern: 'https://github.com/*', url: 'https://github.com/kivo/issues' })
})

// ── The searchable picker ─────────────────────────────────────────────────────

const PLACES = [
  { subjectId: 'ai', subjectName: 'Artificial Intelligence', topicId: null, topicName: null, path: ['Artificial Intelligence'] },
  { subjectId: 'ai', subjectName: 'Artificial Intelligence', topicId: 'ml', topicName: 'Machine Learning', path: ['Artificial Intelligence', 'Machine Learning'] },
  { subjectId: 'ai', subjectName: 'Artificial Intelligence', topicId: 'dl', topicName: 'Deep Learning', path: ['Artificial Intelligence', 'Machine Learning', 'Deep Learning'] },
  { subjectId: 'ai', subjectName: 'Artificial Intelligence', topicId: 'vdb', topicName: 'Vector Databases', path: ['Artificial Intelligence', 'Vector Databases'] },
  { subjectId: 'ph', subjectName: 'Physics', topicId: null, topicName: null, path: ['Physics'] },
  { subjectId: 'ph', subjectName: 'Physics', topicId: 'pi', topicName: 'Introduction', path: ['Physics', 'Introduction'] },
  { subjectId: 'ch', subjectName: 'Chemistry', topicId: null, topicName: null, path: ['Science', 'Chemistry'] },
  { subjectId: 'ch', subjectName: 'Chemistry', topicId: 'ci', topicName: 'Introduction', path: ['Science', 'Chemistry', 'Introduction'] },
]

test('subjects are listed once each with their path; topics only for the chosen subject, nested ones with theirs', () => {
  assert.deepEqual(subjectOptions(PLACES).map(s => s.label), ['Artificial Intelligence', 'Physics', 'Science › Chemistry'])
  assert.deepEqual(topicOptions(PLACES, 'ai').map(t => t.label), ['Machine Learning', 'Machine Learning › Deep Learning', 'Vector Databases'])
  assert.deepEqual(topicOptions(PLACES, 'ch').map(t => [t.id, t.label]), [['ci', 'Introduction']], 'the same name in another subject is that subject\'s own')
})

test('search matches word starts, best first, and says how many more there are', () => {
  assert.deepEqual(filterOptions(topicOptions(PLACES, 'ai'), 'vec').shown.map(o => o.id), ['vdb'])
  assert.deepEqual(filterOptions(topicOptions(PLACES, 'ai'), 'deep learn').shown.map(o => o.id), ['dl'])
  assert.deepEqual(filterOptions(topicOptions(PLACES, 'ai'), 'quantum').shown, [])
  const many = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, label: `Topic ${i}`, name: `Topic ${i}` }))
  const f = filterOptions(many, 'topic', 50)
  assert.equal(f.shown.length, 50)
  assert.equal(f.more, 450)
})

// ── The loop ──────────────────────────────────────────────────────────────────

const PAGE_TEXT = 'Retrieval-Augmented Generation (RAG) models combine parametric and non-parametric memory for language generation. The retriever finds documents and the generator conditions on them.'
const OBS = url => ({ tab: 1, url, title: 'RAG paper', headings: ['Abstract'], text: PAGE_TEXT, part: 1, parts: 1, links: [], elements: [{ i: 4, role: 'radio', name: 'B', group: 'Question 1', state: 'not checked' }], dialog: null, alerts: [], signIn: false, challenge: false, more: false, kind: 'page' })

function fakeTools({ failOpen = false, access = null, start = null } = {}) {
  const calls = []
  let page = start ? { url: start, title: 'Start' } : null
  let current = start ? 1 : null
  const tools = {
    calls,
    current: () => current,
    page: () => (page ? { ...page, kind: 'page' } : null),
    snapshot: () => ({ tabs: [], current }),
    tabList: () => (page ? [{ tab: 1, url: page.url, title: page.title, learners: true }] : []),
    ownTabs: () => [1],
    async check(action) {
      if (action.tool === 'click' && action.args.index === 99) return '"Buy now" could change something on that site.'
      if (action.tool === 'fill' && action.args.index === 13) return 'never'
      return null
    },
    async observe() { calls.push(['observe']); return page ? { ok: true, result: 'Read part 1 of 1', observation: OBS(page.url) } : { ok: false, result: 'No page is open.' } },
    async search({ query }) { calls.push(['search', query]); current = 1; return { ok: true, result: '3 results', observation: { tab: 1, url: 'https://html.duckduckgo.com/html/', title: 'Search', headings: [], text: '(0) RAG paper', part: 1, parts: 1, links: [{ i: 0, text: 'RAG paper', href: 'https://arxiv.org/abs/2005.11401' }], elements: [], kind: 'search_results' } } },
    async open({ url }) {
      calls.push(['open', url])
      if (access && url.includes(access)) { access = null; return { ok: false, needsAccess: { site: 'github.com', pattern: 'https://github.com/*', url }, result: 'needs access' } }
      if (failOpen) return { ok: false, result: 'The page did not finish loading in time.' }
      page = { url, title: 'RAG paper' }; current = 1
      return { ok: true, result: 'Read part 1 of 1', observation: OBS(url) }
    },
    async read() { calls.push(['read']); return { ok: true, result: 'Part 1', observation: null } },
    async scroll() { return { ok: true, result: 'scrolled' } },
    async wait() { return { ok: true, result: 'waited' } },
    async back() { return { ok: true, result: 'back' } },
    async forward() { return { ok: true, result: 'forward' } },
    async click(args) { calls.push(['click', args.index]); return { ok: true, result: 'Clicked; the page changed.', observation: OBS(page?.url ?? 'u') } },
    async fill(args) { calls.push(['fill', args.index, args.text]); return { ok: true, result: `Typed into the field; it now shows "${args.text}".` } },
    async select(args) { calls.push(['select', args.index, args.option]); return { ok: true, result: `Chose "${args.option}".` } },
    async setChecked(args) { calls.push(['check', args.index, args.checked]); return { ok: true, result: 'It is now checked.' } },
    async press(args) { calls.push(['press', args.key]); return { ok: true, result: `Pressed ${args.key}.` } },
    async switchTab() { return { ok: true, result: 'switched' } },
    async closeTab() { return { ok: true, result: 'closed' } },
    verifyQuote(quote) { return page && quoteOnPage(quote, PAGE_TEXT) ? { ok: true, source: page } : { ok: false, result: 'That quote is not on the current page word for word.' } },
  }
  return tools
}

function scriptedClient(actions, { workspace = null } = {}) {
  const sent = []
  const captured = []
  return {
    sent, captured,
    async agentStep(input) {
      sent.push(input)
      const next = actions.shift()
      if (!next) return { ok: true, data: { success: true, thought: 'done', action: { tool: 'finish', args: { status: 'done', answer: 'Fallback.', completed: [], remaining: [], concepts: [], gaps: [] } } } }
      if (next === 'down') return { ok: false, kind: 'failed', message: "Nova's model didn't answer." }
      if (next === 'expired') return { ok: true, data: { success: false, error: 'task_expired', message: 'Start the task again.' } }
      const { plan, ...action } = next
      return { ok: true, data: { success: true, thought: 'because', plan: plan ?? null, expect: '', action } }
    },
    async agentWorkspace(body) { sent.push({ workspace: body }); return workspace ? { ok: true, data: { success: true, ...workspace } } : { ok: false, message: 'none' } },
    async capture(body) { captured.push(body); return { ok: true, data: { success: true, draft: { id: 'd1' }, itemId: `i${captured.length}` } } },
  }
}
const A = {
  search: q => ({ tool: 'search', args: { query: q } }),
  open: u => ({ tool: 'open', args: { url: u, newTab: false } }),
  extract: q => ({ tool: 'extract', args: { quote: q, note: 'RAG mixes retrieval and generation.', concept: 'RAG memory' } }),
  finish: (status = 'done') => ({ tool: 'finish', args: { status, answer: 'RAG combines memories [1].', completed: ['Read the paper'], remaining: [], concepts: ['RAG'], gaps: ['Retriever training'] } }),
}
const START = { ticket: 'tk', summary: 'Subjects: Artificial Intelligence', notes: [], places: [] }
const run = async (actions, opts = {}) => {
  const state = newState({ objective: opts.objective ?? 'Understand RAG', start: START, startTab: opts.startTab ?? null, limits: opts.limits ?? DEFAULT_LIMITS })
  const tools = opts.tools ?? fakeTools()
  const client = scriptedClient(actions, opts)
  const saved = []
  const agent = createAgent({ state, tools, client, save: async s => { saved.push(s.status) } })
  await agent.start()
  return { state, tools, client, agent, saved }
}

test('a research task runs to the end: search, open, a verified finding, an answer citing its source', async () => {
  const { state, client, saved } = await run([A.search('RAG architectures'), A.open('https://arxiv.org/abs/2005.11401'), A.extract('combine parametric and non-parametric memory for language generation'), A.finish()])
  assert.equal(state.status, 'done')
  assert.deepEqual(state.sources, [{ n: 1, url: 'https://arxiv.org/abs/2005.11401', title: 'RAG paper' }])
  assert.equal(state.findings.length, 1)
  assert.equal(state.findings[0].source, 1)
  assert.equal(state.result.answer, 'RAG combines memories [1].')
  assert.equal(client.sent[0].workspace, 'Subjects: Artificial Intelligence', 'the workspace is checked before anything')
  assert.equal(client.sent[0].ticket, 'tk', 'every step names its task')
  assert.ok(saved.length >= 4, 'the state is saved after every step')
})

test('a task on the learner\'s page reads it first, then acts on its elements and verifies each', async () => {
  const tools = fakeTools({ start: 'https://quiz.example/q1' })
  const { state, client } = await run([
    { tool: 'check', args: { index: 4, checked: true }, plan: [{ step: 'Answer question 1', done: false }, { step: 'Go to the next page', done: false }] },
    { tool: 'fill', args: { index: 7, text: 'Ada Lovelace', submit: false } },
    { tool: 'select', args: { index: 8, option: 'Intermediate' } },
    { tool: 'press', args: { key: 'Tab', index: null } },
    A.finish('partial'),
  ], { tools, startTab: { id: 1, url: 'https://quiz.example/q1', title: 'Quiz' } })
  assert.equal(tools.calls[0][0], 'observe', 'the page is read before the first decision')
  assert.equal(client.sent[0].observation.elements[0].group, 'Question 1', 'the model sees questions and their options')
  assert.deepEqual(tools.calls.slice(1), [['check', 4, true], ['fill', 7, 'Ada Lovelace'], ['select', 8, 'Intermediate'], ['press', 'Tab']])
  assert.deepEqual(state.plan.map(p => p.step), ['Answer question 1', 'Go to the next page'], 'the plan is kept between steps')
  assert.deepEqual(client.sent[1].plan, state.plan, 'and sent back with each step')
  assert.equal(state.result.status, 'partial')
})

test('a quote that is not on the page is not kept', async () => {
  const { state } = await run([A.open('https://arxiv.org/abs/2005.11401'), A.extract('RAG is always better than fine-tuning in every benchmark'), A.finish()])
  assert.equal(state.findings.length, 0)
  assert.match(state.steps.find(s => s.action.tool === 'extract').result, /not on the current page/)
})

test('the same action again is refused, and three refusals end the task', async () => {
  const same = A.search('rag')
  const { state, tools } = await run([same, same, same, same])
  assert.equal(tools.calls.filter(c => c[0] === 'search').length, 1, 'searched once')
  assert.equal(state.status, 'failed')
  assert.match(state.error, /repeating itself/)
})

test('a page that fails to load is recorded and the task goes on', async () => {
  const { state } = await run([A.open('https://slow.example/'), A.search('rag'), A.finish()], { tools: fakeTools({ failOpen: true }) })
  assert.equal(state.steps[0].ok, false)
  assert.match(state.steps[0].result, /did not finish loading/)
  assert.equal(state.status, 'done')
})

test('pause stops at the next safe boundary (after the step in flight); resume carries on', async () => {
  const state = newState({ objective: 'Understand RAG', start: START })
  let agent
  const client = { async agentStep() { agent.pause(); return { ok: true, data: { success: true, thought: '', action: A.search(`q${state.steps.length}`) } } } }
  const tools = fakeTools()
  agent = createAgent({ state, tools, client })
  await agent.start()
  assert.equal(state.status, 'paused')
  assert.equal(state.steps.length, 1, 'the step in flight finished; nothing after it')
  assert.equal(tools.calls.length, 1)
  const resumed = { async agentStep() { return { ok: true, data: { success: true, thought: '', action: A.finish() } } } }
  const again = createAgent({ state, tools: fakeTools(), client: resumed })
  await again.start()
  assert.equal(state.status, 'done')
})

test('stop ends the task at once: the decision that arrives after it is not carried out', async () => {
  const state = newState({ objective: 'x', start: START })
  let agent
  const tools = fakeTools()
  const client = { async agentStep() { await agent.stop(); return { ok: true, data: { success: true, thought: '', action: { tool: 'click', args: { index: 3 } } } } } }
  agent = createAgent({ state, tools, client })
  await agent.start()
  assert.equal(state.status, 'stopped')
  assert.equal(state.steps.length, 0, 'nothing more was done')
  assert.equal(tools.calls.filter(c => c[0] === 'click').length, 0)
})

test('ask_user waits for the learner, with choices, and their answer goes into the next decision', async () => {
  const { state, agent, client } = await run([{ tool: 'ask_user', args: { question: 'Which email should go in the form?', choices: ['Work', 'Personal'] } }, A.finish()])
  assert.equal(state.status, 'asking')
  assert.deepEqual(state.pending.choices, ['Work', 'Personal'])
  await agent.answer('Work')
  assert.equal(state.status, 'done')
  assert.match(client.sent[1].steps[0].result, /The learner answered: Work/)
})

test('a click that could buy something waits for the learner, and a no is respected', async () => {
  const { state, agent, tools } = await run([{ tool: 'click', args: { index: 99 } }, A.finish()])
  assert.equal(state.status, 'confirming')
  assert.match(state.pending.reason, /could change something/)
  await agent.confirm(false)
  assert.equal(tools.calls.filter(c => c[0] === 'click').length, 0, 'not clicked')
  assert.match(state.steps[0].result, /did not allow/)
  assert.equal(state.status, 'done')
})

test('a yes carries out exactly that action once, then the task goes on', async () => {
  const { state, agent, tools } = await run([{ tool: 'click', args: { index: 99 } }, A.finish()])
  await agent.confirm(true)
  assert.deepEqual(tools.calls.filter(c => c[0] === 'click'), [['click', 99]])
  assert.equal(state.steps[0].ok, true)
  assert.equal(state.status, 'done')
})

test('a password field is never typed into, whatever the model asks', async () => {
  const { state, tools } = await run([{ tool: 'fill', args: { index: 13, text: 'hunter2', submit: false } }, A.finish()])
  assert.equal(tools.calls.filter(c => c[0] === 'fill').length, 0)
  assert.match(state.steps[0].result, /never types into password/)
})

test('a site that is not allowed waits for the learner; allowed, the same action runs and the site is given back at the end', async () => {
  const { state, agent, tools } = await run([A.open('https://github.com/kivo/issues/1'), A.finish()], { tools: fakeTools({ access: 'github.com' }) })
  assert.equal(state.status, 'access')
  assert.equal(state.pending.site, 'github.com')
  await agent.access(true, { pattern: 'https://github.com/*' })
  assert.deepEqual(state.granted, ['https://github.com/*'], 'kept so it is given back when the task ends')
  assert.equal(tools.calls.filter(c => c[0] === 'open').length, 2, 'the same open, once more')
  assert.equal(state.status, 'done')
})

test('a site refused: the task is told and goes on without it', async () => {
  const { state, agent } = await run([A.open('https://github.com/kivo/issues/1'), A.finish('partial')], { tools: fakeTools({ access: 'github.com' }) })
  await agent.access(false)
  assert.match(state.steps[0].result, /did not allow Nova to use github\.com/)
  assert.equal(state.granted.length, 0)
  assert.equal(state.status, 'done')
})

test('hand_over (a sign-in, a human check) waits for the learner and reads the page again when they are back', async () => {
  const tools = fakeTools({ start: 'https://app.example/login' })
  const { state, agent, client } = await run([{ tool: 'hand_over', args: { reason: 'Sign in to the app, then press Done.' } }, A.finish()], { tools, startTab: { id: 1, url: 'https://app.example/login', title: 'Sign in' } })
  assert.equal(state.status, 'asking')
  assert.equal(state.pending.kind, 'needs_you')
  await agent.answer('done')
  assert.equal(tools.calls.filter(c => c[0] === 'observe').length, 2, 'read again when the learner is back')
  assert.match(client.sent[1].steps.at(-1).result, /did what was needed/)
  assert.equal(state.status, 'done')
})

test('the workspace is read through Kivo, and what it returned is kept as the learner\'s private material', async () => {
  const workspace = { kind: 'search', text: 'Notes:\n- "HNSW" (id n1): layered graph search starts at the top layer with few nodes and descends greedily.', found: 1 }
  const { state, client } = await run([{ tool: 'workspace_search', args: { query: 'HNSW' } }, { tool: 'read_note', args: { id: 'n1' } }, A.finish()], { workspace })
  assert.deepEqual(client.sent[1].workspace, { ticket: 'tk', op: 'search', query: 'HNSW' })
  assert.deepEqual(client.sent[3].workspace, { ticket: 'tk', op: 'note', id: 'n1' })
  assert.equal(client.sent[2].data.kind, 'search', 'the result goes into the next decision')
  assert.ok(state.privateTexts.some(t => t.includes('layered graph search')), 'so it cannot be typed into a site without the learner\'s OK')
})

test('save_to_drafts captures through Kivo, the same path as a selected passage', async () => {
  const { state, client } = await run([{ tool: 'save_to_drafts', args: { title: 'HNSW in one paragraph', text: 'HNSW builds a layered proximity graph.', note: '' } }, A.finish()])
  assert.equal(client.captured.length, 1)
  assert.equal(client.captured[0].title, 'HNSW in one paragraph')
  assert.equal(client.captured[0].newDraft, true)
  assert.equal(state.saved.length, 1)
  assert.equal(client.sent[1].saved, 1)
})

test('at the step limit the model is told no steps are left, and the task finishes', async () => {
  const { state, client } = await run([A.search('a'), A.search('b'), A.finish()], { limits: { steps: 2, minutes: 10, modelCalls: 30 } })
  assert.equal(state.status, 'done')
  assert.equal(client.sent[2].stepsLeft, 0)
})

test('when the model is unavailable the task pauses with a reason, and can resume', async () => {
  const { state, agent } = await run(['down', A.finish()])
  assert.equal(state.status, 'paused')
  assert.match(state.error, /didn't answer/)
  await agent.start()
  assert.equal(state.status, 'done')
})

test('a task the server no longer accepts (expired, or out of steps) ends, saying so', async () => {
  const { state } = await run(['expired'])
  assert.equal(state.status, 'failed')
  assert.match(state.error, /Start the task again/)
})

test('each step sends the objective, the conversation, the workspace, the plan, recent steps and the current page only', async () => {
  const state = newState({ objective: 'Understand RAG', history: [{ question: 'What is RAG?', answer: 'Retrieval plus generation.' }], start: { ...START, summary: 'S' } })
  for (let i = 0; i < 20; i++) state.steps.push({ action: A.search(`q${i}`), ok: true, result: 'r', thought: '' })
  const input = stepInput(state, fakeTools(), OBS('u'))
  assert.equal(input.steps.length, 14, 'only the latest steps')
  assert.equal(input.stepsLeft, DEFAULT_LIMITS.steps - 20)
  assert.deepEqual(Object.keys(input).sort(), ['data', 'findings', 'history', 'objective', 'observation', 'plan', 'saved', 'seen', 'sources', 'steps', 'stepsLeft', 'tabs', 'ticket', 'watching', 'workspace'])
})

test('pages read earlier in a task go with each later step (short), so a comparison has both', async () => {
  const { client } = await run([A.open('https://shop.example/aero'), A.open('https://shop.example/titan'), A.finish()])
  const last = client.sent.at(-1)
  assert.deepEqual(last.seen.map(p => p.url), ['https://shop.example/aero'], 'the page before this one, not the current one')
  assert.ok(last.seen[0].text.length <= 1200)
})

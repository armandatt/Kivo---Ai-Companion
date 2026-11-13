// Research mode and where captures are filed: what the code may do, and how
// the loop behaves. Run: npm test --workspace nova-extension (node --test).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { allowedUrl, createBrowserTools, needsConfirmation, partsOf, quoteOnPage, readableUrl } from '../src/lib/agent-tools.js'
import { DEFAULT_LIMITS, createAgent, newState, stepInput } from '../src/lib/agent.js'
import { filterOptions, subjectOptions, topicOptions } from '../src/lib/places.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src  = name => readFileSync(join(root, 'src', name), 'utf8')
const code = text => text.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*')).join('\n')
const RESEARCH = ['research.js', 'lib/agent.js', 'lib/agent-tools.js', 'lib/agent-page.js'].map(name => ({ name, text: code(src(name)) }))

// ── What research may do at all ───────────────────────────────────────────────

test('research uses only tab, scripting, permission and session APIs, and nothing that reaches cookies, history or traffic', () => {
  const used = new Set()
  for (const { text } of RESEARCH) for (const m of text.matchAll(/chrome\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) used.add(`${m[1]}.${m[2]}`)
  for (const m of code(src('lib/agent-tools.js')).matchAll(/chrome\.tabs\.([a-zA-Z]+)/g)) used.add(`tabs.${m[1]}`)
  const allowed = new Set(['tabs.get', 'tabs.create', 'tabs.update', 'tabs.remove', 'scripting.executeScript', 'permissions.request', 'permissions.remove', 'permissions.contains', 'storage.session'])
  for (const api of used) assert.ok(allowed.has(api), `${api} is not something research may use`)
  const all = RESEARCH.map(r => r.text).join('\n')
  assert.ok(!all.match(/chrome\.(cookies|history|webRequest|webNavigation|downloads|bookmarks|debugger|tabs\.query|tabs\.captureVisibleTab)/), 'no cookies, history, traffic, downloads or screenshots')
  assert.ok(!all.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|indexedDB|document\.cookie/), 'no markup, no code from text, no page storage')
  assert.ok(!all.match(/setInterval/), 'nothing on a timer')
})

test('research opens its own tabs in the background and asks for exactly http(s) access, per task', () => {
  const tools = code(src('lib/agent-tools.js'))
  assert.match(tools, /chrome\.tabs\.create\(\{ url: allowed\.url, active: false/)
  assert.ok(!tools.match(/files:/), 'it injects functions it ships, never files or code from the network')
  const funcs = [...tools.matchAll(/run\((?:current|tabId), ([a-zA-Z]+)/g)].map(m => m[1])
  const page = src('lib/agent-page.js')
  for (const f of new Set(funcs)) assert.match(page, new RegExp(`export function ${f}\\(`), `${f} is one of the page functions in lib/agent-page.js`)
  const ui = code(src('research.js'))
  assert.match(ui, /const ORIGINS = \['https:\/\/\*\/\*', 'http:\/\/\*\/\*'\]/)
  assert.match(ui, /chrome\.permissions\.request\(\{ origins: ORIGINS \}\)/)
  assert.match(ui, /chrome\.permissions\?\.remove\?\.\(\{ origins: ORIGINS \}\)/, 'given back when the task ends')
})

test('the page reader never reads form values, passwords or storage', () => {
  const observe = src('lib/agent-page.js').match(/export function observePage\([\s\S]*?\n\}/)[0]
  assert.ok(!observe.match(/\.value\b|cookie|localStorage|sessionStorage|fetch|XMLHttpRequest/), 'no field values, cookies, storage or requests')
  assert.match(observe, /\['hidden', 'password', 'file'\]\.includes\(type\)/, 'password, hidden and file fields are skipped')
  const inspect = src('lib/agent-page.js').match(/export function inspectTarget\([\s\S]*?\n\}/)[0]
  assert.ok(!inspect.match(/\.value\b/), 'what a field holds is never read, not even for its label')
})

test('the only addresses research names are the two search pages', () => {
  const urls = [...RESEARCH.map(r => r.text).join('\n').matchAll(/https?:\/\/[^\s'"`*]+/g)].map(m => m[0])
  assert.deepEqual([...new Set(urls)], ['https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}', 'https://www.bing.com/search?q=${encodeURIComponent(q)}'])
})

test('a site\'s human check is left to the learner: the task waits, and resumes when they say so', async () => {
  const tools = fakeTools()
  tools.search = async () => ({ ok: false, needsUser: { message: 'The search site wants to check that a person is searching.', tab: 1 }, result: 'The search site asked for a human check.' })
  const { state, agent } = await run([A.search('rag'), A.finish()], { tools })
  assert.equal(state.status, 'asking')
  assert.equal(state.pending.kind, 'needs_you')
  await agent.answer('done')
  assert.match(state.steps[1].result, /did what the site asked/)
  assert.equal(state.status, 'done')
})

// ── Rules code applies, whatever the model asks ───────────────────────────────

test('only ordinary public web pages are opened', () => {
  assert.equal(allowedUrl('https://arxiv.org/abs/2005.11401').ok, true)
  for (const bad of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'chrome-extension://x/y', 'http://localhost:3000/admin', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.20.1.1/', 'https://user:pw@example.com/', 'http://printer.local/', 'not a url']) {
    assert.equal(allowedUrl(bad).ok, false, bad)
  }
})

test('an arXiv PDF is read from its abstract page', () => {
  assert.equal(readableUrl('https://arxiv.org/pdf/2005.11401.pdf'), 'https://arxiv.org/abs/2005.11401')
  assert.equal(readableUrl('https://example.com/a.pdf'), 'https://example.com/a.pdf')
})

test('anything that could change something on a site waits for the learner', () => {
  const button = label => ({ exists: true, tag: 'button', label, isSubmit: false, form: null })
  assert.match(needsConfirmation(button('Buy now'), 'click'), /could change something/)
  assert.match(needsConfirmation(button('Delete'), 'click'), /could change something/)
  assert.match(needsConfirmation(button('Post comment'), 'click'), /could change something/)
  assert.equal(needsConfirmation(button('Show more'), 'click'), null)
  assert.match(needsConfirmation({ exists: true, tag: 'button', label: 'Continue', isSubmit: true, form: { isSearch: false, hasPassword: true } }, 'click'), /submit a form/)
  assert.equal(needsConfirmation({ exists: true, tag: 'button', label: 'Search', isSubmit: true, form: { isSearch: true } }, 'click'), null, 'a search form is fine')
  assert.match(needsConfirmation({ exists: true, tag: 'a', label: 'file', download: true }, 'click'), /download/)
  assert.equal(needsConfirmation({ exists: true, isSearchBox: true, label: 'Search docs' }, 'type'), null)
  assert.match(needsConfirmation({ exists: true, isSearchBox: false, label: 'Email' }, 'type'), /not a search box/)
  assert.equal(needsConfirmation({ exists: true, isPassword: true }, 'type'), 'never')
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

function fakeTools({ failOpen = false } = {}) {
  const calls = []
  let page = null
  const tools = {
    calls,
    tabList: () => (page ? [{ tab: 1, url: page.url, title: page.title }] : []),
    ownTabs: () => [1],
    async check(action) { return action.tool === 'click' && action.args.index === 99 ? '"Buy now" could change something on that site.' : null },
    async search({ query }) { calls.push(['search', query]); return { ok: true, result: '3 results', observation: { tab: 1, url: 'https://html.duckduckgo.com/html/', title: 'Search', headings: [], text: '(0) RAG paper', part: 1, parts: 1, links: [{ i: 0, text: 'RAG paper', href: 'https://arxiv.org/abs/2005.11401' }], controls: [], kind: 'search_results' } } },
    async open({ url }) {
      calls.push(['open', url])
      if (failOpen) return { ok: false, result: 'The page did not finish loading in time.' }
      page = { url, title: 'RAG paper' }
      return { ok: true, result: 'Read part 1 of 1', observation: { tab: 1, url, title: 'RAG paper', headings: ['Abstract'], text: PAGE_TEXT, part: 1, parts: 1, links: [], controls: [], kind: 'page' } }
    },
    async read() { calls.push(['read']); return { ok: true, result: 'Part 1', observation: null } },
    async scroll() { return { ok: true, result: 'scrolled' } },
    async click(args) { calls.push(['click', args.index]); return { ok: true, result: 'clicked' } },
    async type() { return { ok: true, result: 'typed' } },
    async switchTab() { return { ok: true, result: 'switched' } },
    verifyQuote(quote) { return page && quoteOnPage(quote, PAGE_TEXT) ? { ok: true, source: page } : { ok: false, result: 'That quote is not on the current page word for word.' } },
  }
  return tools
}

function scriptedClient(actions) {
  const sent = []
  return {
    sent,
    async researchStep(input) {
      sent.push(input)
      const next = actions.shift()
      if (!next) return { ok: true, data: { success: true, thought: 'done', action: { tool: 'finish', args: { summary: 'Fallback.', concepts: [], gaps: [] } } } }
      if (next === 'down') return { ok: false, kind: 'failed', message: "Kivo's model didn't answer." }
      return { ok: true, data: { success: true, thought: 'because', action: next } }
    },
  }
}
const A = {
  search: q => ({ tool: 'search', args: { query: q } }),
  open: u => ({ tool: 'open', args: { url: u } }),
  extract: q => ({ tool: 'extract', args: { quote: q, note: 'RAG mixes retrieval and generation.', concept: 'RAG memory' } }),
  finish: () => ({ tool: 'finish', args: { summary: 'RAG combines memories [1].', concepts: ['RAG'], gaps: ['Retriever training'] } }),
}
const run = async (actions, opts = {}) => {
  const state = newState({ objective: 'Understand RAG', workspace: { summary: 'Subjects: Artificial Intelligence' }, limits: opts.limits ?? DEFAULT_LIMITS })
  const tools = opts.tools ?? fakeTools()
  const client = scriptedClient(actions)
  const saved = []
  const agent = createAgent({ state, tools, client, save: async s => { saved.push(s.status) } })
  await agent.start()
  return { state, tools, client, agent, saved }
}

test('a task runs to the end: search, open, a verified finding, a summary citing its source', async () => {
  const { state, client, saved } = await run([A.search('RAG architectures'), A.open('https://arxiv.org/abs/2005.11401'), A.extract('combine parametric and non-parametric memory for language generation'), A.finish()])
  assert.equal(state.status, 'done')
  assert.deepEqual(state.sources, [{ n: 1, url: 'https://arxiv.org/abs/2005.11401', title: 'RAG paper' }])
  assert.equal(state.findings.length, 1)
  assert.equal(state.findings[0].source, 1)
  assert.equal(state.result.summary, 'RAG combines memories [1].')
  assert.equal(client.sent[0].workspace, 'Subjects: Artificial Intelligence', 'the workspace is checked before the research')
  assert.ok(saved.length >= 4, 'the state is saved after every step')
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

test('pause stops after the current step; resume carries on', async () => {
  const state = newState({ objective: 'Understand RAG', workspace: null })
  let agent
  const client = { async researchStep() { agent.pause(); return { ok: true, data: { success: true, thought: '', action: A.search(`q${state.steps.length}`) } } } }
  agent = createAgent({ state, tools: fakeTools(), client })
  await agent.start()
  assert.equal(state.status, 'paused')
  assert.equal(state.steps.length, 1)
  const resumed = { async researchStep() { return { ok: true, data: { success: true, thought: '', action: A.finish() } } } }
  const again = createAgent({ state, tools: fakeTools(), client: resumed })
  await again.start()
  assert.equal(state.status, 'done')
})

test('stop ends the task at once', async () => {
  const state = newState({ objective: 'x', workspace: null })
  let agent
  const client = { async researchStep() { await agent.stop(); return { ok: true, data: { success: true, thought: '', action: A.search('q') } } } }
  agent = createAgent({ state, tools: fakeTools(), client })
  await agent.start()
  assert.equal(state.status, 'stopped')
  assert.equal(state.steps.length, 0, 'nothing more was done')
})

test('ask_user waits for the learner, and their answer goes into the next decision', async () => {
  const { state, agent, client } = await run([{ tool: 'ask_user', args: { question: 'Beginner or advanced sources?' } }, A.finish()])
  assert.equal(state.status, 'asking')
  await agent.answer('Advanced, please')
  assert.equal(state.status, 'done')
  assert.match(client.sent[1].steps[0].result, /The learner answered: Advanced, please/)
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

test('each step sends the objective, the workspace, recent steps and the current page only', async () => {
  const state = newState({ objective: 'Understand RAG', workspace: { summary: 'S' } })
  for (let i = 0; i < 20; i++) state.steps.push({ action: A.search(`q${i}`), ok: true, result: 'r', thought: '' })
  const input = stepInput(state, fakeTools(), { tab: 1, url: 'u', title: 't', headings: [], text: 'x', part: 1, parts: 1, links: [], controls: [] })
  assert.equal(input.steps.length, 14, 'only the latest steps')
  assert.equal(input.stepsLeft, DEFAULT_LIMITS.steps - 20)
  assert.deepEqual(Object.keys(input).sort(), ['findings', 'objective', 'observation', 'sources', 'steps', 'stepsLeft', 'tabs', 'workspace'])
})

// Phase 1 (V1) browser agent: the task state machine, progress-aware
// repetition, scope, current-tab-first, refused sites, recovery, clean-up,
// metrics, request routing and the panel following the user's page.
// Run with the rest: npm test --workspace nova-extension.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULT_LIMITS, FINISHED, STATUS, TRANSITIONS, canMove, createAgent, isNoProgressRepeat, newState, pageKey, recoveredState, scopeProblem, statusOf, tabsToClose, targetOf } from '../src/lib/agent.js'
import { samePage } from '../src/lib/agent-tools.js'
import { taskMetrics, recordTaskMetrics, METRICS_KEY } from '../src/lib/metrics.js'
import { routeOf } from '../src/lib/intent.js'
import { createPageContext, describeTab } from '../src/lib/page-context.js'
import { citedIn } from '../src/lib/agent-view.js'

const START = { ticket: 'tk', summary: 'Subjects: AI', notes: [], places: [] }
const finish = (answer = 'Done.', status = 'done') => ({ tool: 'finish', args: { status, answer, completed: [], remaining: [], concepts: [], gaps: [] } })

function client(actions, usage = { inputTokens: 1000, outputTokens: 100 }) {
  const sent = []
  return {
    sent,
    async agentStep(input) {
      sent.push(input)
      const next = actions.shift() ?? finish('Fallback.')
      return { ok: true, data: { success: true, thought: next.thought ?? 'because', plan: null, expect: '', action: next, usage } }
    },
    async agentWorkspace() { return { ok: false, message: 'none' } },
    async capture() { return { ok: true, data: { success: true, draft: { id: 'd' }, itemId: 'i' } } },
  }
}

// ── The state machine ─────────────────────────────────────────────────────────

test('a task moves only as the state machine allows; finished is final', () => {
  for (const done of FINISHED) assert.deepEqual(TRANSITIONS[done], [], `${done} is final`)
  assert.equal(canMove('running', 'awaiting_permission'), true)
  assert.equal(canMove('completed', 'running'), false, 'a completed task can never act again')
  assert.equal(canMove('cancelled', 'awaiting_user'), false)
  assert.equal(canMove('paused', 'completed'), false, 'a paused task must run (or be cancelled) to end')
  // Saved by an older version: read in today's words.
  assert.equal(statusOf('asking'), 'awaiting_user')
  assert.equal(statusOf('access'), 'awaiting_permission')
  assert.equal(statusOf('stopped'), 'cancelled')
  assert.equal(statusOf('done'), 'completed')
})

test('cancel while waiting for an OK: the declined or late approval is never carried out', async () => {
  const state = newState({ objective: 'Buy it', start: START })
  const calls = []
  const tools = fakeTools(calls, { confirmIndex: 9 })
  const agent = createAgent({ state, tools, client: client([{ tool: 'click', args: { index: 9 } }]) })
  await agent.start()
  assert.equal(state.status, STATUS.AWAITING_USER)
  const id = state.pending.id
  await agent.stop()
  assert.equal(state.status, STATUS.CANCELLED)
  await agent.confirm(true, id)
  await agent.start()
  assert.equal(calls.filter(c => c[0] === 'click').length, 0, 'nothing ran after cancel')
  assert.equal(state.status, STATUS.CANCELLED)
})

test('an answer meant for an older question does nothing', async () => {
  const state = newState({ objective: 'Buy it', start: START })
  const calls = []
  const agent = createAgent({ state, tools: fakeTools(calls, { confirmIndex: 9 }), client: client([{ tool: 'click', args: { index: 9 } }, finish()]) })
  await agent.start()
  await agent.confirm(true, 'an-old-question')
  assert.equal(state.status, STATUS.AWAITING_USER, 'still waiting for this question')
  assert.equal(calls.filter(c => c[0] === 'click').length, 0)
  await agent.confirm(true, state.pending.id)
  assert.deepEqual(calls.filter(c => c[0] === 'click'), [['click', 9]])
  assert.equal(state.status, STATUS.COMPLETED)
})

// ── Repetition, judged by progress ────────────────────────────────────────────

const ROWS = n => Array.from({ length: n }, (_, i) => ({ i: 100 + i, role: 'row', name: `Sender ${i + 1} · Subject ${i + 1} · snippet` }))
const inbox = (n = 6) => ({ tab: 1, url: 'https://mail.example/#inbox', title: 'Inbox', print: 'inbox', part: 1, parts: 1, text: 'Inbox', elements: ROWS(n), links: [], kind: 'page' })

test('opening five different emails is five different actions, not a repeat', () => {
  const attempts = []
  const obs = inbox()
  for (let i = 0; i < 5; i++) {
    const click = { tool: 'click', args: { index: 100 + i } }
    assert.equal(isNoProgressRepeat(attempts, click, obs), false, `email ${i + 1}`)
    attempts.push({ key: targetOf(click, obs), page: pageKey(obs), ok: true, changed: true })
    attempts.push({ key: targetOf({ tool: 'back', args: {} }, obs), page: 'mail|email', ok: true, changed: true })
  }
})

test('the same click on the same unchanged page after it did nothing is refused; on a changed page it is allowed', () => {
  const obs = inbox()
  const click = { tool: 'click', args: { index: 100 } }
  const attempts = [{ key: targetOf(click, obs), page: pageKey(obs), ok: true, changed: false }]
  assert.equal(isNoProgressRepeat(attempts, click, obs), true)
  assert.equal(isNoProgressRepeat(attempts, click, { ...obs, print: 'inbox-after-refresh' }), false, 'the page changed since')
  // The element is named by role and name, not its number: a re-drawn row with a new number is the same row.
  const redrawn = { ...obs, elements: obs.elements.map(e => (e.i === 100 ? { ...e, i: 300 } : e)) }
  assert.equal(isNoProgressRepeat(attempts, { tool: 'click', args: { index: 300 } }, redrawn), true)
})

test('Next on each page of a quiz is allowed: the page differs each time', () => {
  const page = n => ({ tab: 1, url: `https://quiz.example/p${n}`, print: `p${n}`, part: 1, elements: [{ i: 7, role: 'button', name: 'Next' }] })
  const attempts = []
  for (let n = 1; n <= 3; n++) {
    const next = { tool: 'click', args: { index: 7 } }
    assert.equal(isNoProgressRepeat(attempts, next, page(n)), false)
    attempts.push({ key: targetOf(next, page(n)), page: pageKey(page(n)), ok: true, changed: true })
  }
})

test('a Gmail-like inbox: open five emails one after another and finish with five short points, without a refusal', async () => {
  const state = newState({ objective: 'Summarise my top 5 emails in short points', start: START, startTab: { id: 1, url: 'https://mail.example/#inbox', title: 'Inbox' }, scope: { limit: 5, short: true, format: 'points' } })
  let at = 'inbox'
  const opened = []
  const tools = {
    current: () => 1, page: () => ({ url: 'https://mail.example/', kind: 'page' }), snapshot: () => ({ tabs: [], current: 1 }), tabList: () => [], ownTabs: () => [],
    coverage: () => ({ parts: 1, read: [1] }), check: async () => null,
    async observe() { return { ok: true, result: 'read', observation: inbox() } },
    async click({ index }) { opened.push(index); at = `email${index}`; return { ok: true, changed: true, result: 'Clicked; the page is now the email.', observation: { ...inbox(), url: `https://mail.example/#inbox/${index}`, print: at, elements: [{ i: 50, role: 'button', name: 'Back to Inbox' }] } } },
    async back() { at = 'inbox'; return { ok: true, changed: true, result: 'Went back to "Inbox".', observation: inbox() } },
  }
  const script = []
  for (let i = 0; i < 5; i++) script.push({ tool: 'click', args: { index: 100 + i } }, { tool: 'back', args: {} })
  script.push(finish('- One\n- Two\n- Three\n- Four\n- Five'))
  const agent = createAgent({ state, tools, client: client(script) })
  await agent.start()
  assert.deepEqual(opened, [100, 101, 102, 103, 104])
  assert.equal(state.metrics.refusals, 0)
  assert.equal(state.status, STATUS.COMPLETED)
  assert.equal(state.result.answer.split('\n').length, 5)
})

// ── Scope, literally ──────────────────────────────────────────────────────────

test('an answer that ignores the scope is written again once, then accepted', async () => {
  assert.match(scopeProblem({ short: true }, 'word '.repeat(200)), /short answer/)
  assert.equal(scopeProblem({ short: true }, 'A short answer.'), null)
  assert.match(scopeProblem({ format: 'points' }, 'One paragraph with no list at all.'), /bulleted list/)
  assert.match(scopeProblem({ limit: 3, format: 'points' }, '- a\n- b\n- c\n- d\n- e'), /exactly 3/)
  const state = newState({ objective: 'Short summary', start: START, scope: { short: true } })
  const c = client([finish('word '.repeat(220)), finish('Short now.')])
  await createAgent({ state, tools: fakeTools([]), client: c }).start()
  assert.equal(state.result.answer, 'Short now.')
  assert.equal(c.sent.length, 2, 'asked once more, no more')
  assert.match(c.sent[1].steps.at(-1).result, /short answer/)
  assert.deepEqual(c.sent[0].scope, { limit: null, short: true, format: null }, 'the scope goes with every step')
})

// ── The user's tab first ─────────────────────────────────────────────────────

test('a task on the user\'s page does not search the web before the page has been read through or searched', async () => {
  const state = newState({ objective: 'Which plan here is cheapest?', start: START, startTab: { id: 1, url: 'https://shop.example/', title: 'Plans' } })
  const calls = []
  const tools = fakeTools(calls, { start: 'https://shop.example/', parts: 3 })
  const c = client([{ tool: 'search', args: { query: 'cheapest plan' } }, { tool: 'find', args: { query: 'price' } }, { tool: 'search', args: { query: 'cheapest plan' } }, finish()])
  await createAgent({ state, tools, client: c }).start()
  assert.equal(calls.filter(x => x[0] === 'search').length, 1, 'only after find had looked through the page')
  assert.match(state.steps[0].result, /Read the rest of it \(parts 2, 3\) or use find/)
  assert.equal(state.mode, 'page')
})

test('research may search at once', async () => {
  const state = newState({ objective: 'Research HNSW', start: START, startTab: { id: 1, url: 'https://shop.example/', title: 'Plans' }, mode: 'research' })
  const calls = []
  await createAgent({ state, tools: fakeTools(calls, { start: 'https://shop.example/', parts: 3 }), client: client([{ tool: 'search', args: { query: 'HNSW' } }, finish()]) }).start()
  assert.equal(calls.filter(x => x[0] === 'search').length, 1)
})

test('a site the user refused is not asked for again in the same task', async () => {
  const state = newState({ objective: 'Compare', start: START, mode: 'research' })
  const calls = []
  const tools = fakeTools(calls, { access: 'github.com', alwaysAccess: true })
  const agent = createAgent({ state, tools, client: client([{ tool: 'open', args: { url: 'https://github.com/a' } }, { tool: 'open', args: { url: 'https://github.com/b' } }, finish()]) })
  await agent.start()
  assert.equal(state.status, STATUS.AWAITING_PERMISSION)
  await agent.access(false, { id: state.pending.id })
  assert.equal(state.status, STATUS.COMPLETED, 'denied, the task went on and finished: a new request is never blocked by it')
  assert.equal(calls.filter(x => x[0] === 'open').length, 1, 'the second github page was refused by code, without asking')
  assert.match(state.steps.at(-1).result, /did not allow github\.com/)
})

// ── Recovery and clean-up ─────────────────────────────────────────────────────

test('an action is marked in flight before it runs; after a restart it is recorded as interrupted, never replayed', async () => {
  const state = newState({ objective: 'Submit', start: START })
  let seen = null
  const tools = fakeTools([])
  tools.click = async () => { seen = structuredClone(state.inflight); return { ok: true, result: 'Clicked.' } }
  await createAgent({ state, tools, client: client([{ tool: 'click', args: { index: 3 } }, finish()]) }).start()
  assert.equal(seen.action.tool, 'click', 'saved before the click ran')
  assert.equal(state.inflight, null, 'cleared once recorded')
  const cut = { ...newState({ objective: 'x', start: START }), status: 'running', inflight: { action: { tool: 'click', args: { index: 3 } }, confirmed: true } }
  const back = recoveredState(cut, 5)
  assert.equal(back.status, STATUS.PAUSED)
  assert.equal(back.inflight, null)
  assert.match(back.steps.at(-1).result, /may or may not have happened.*approved once; a repeat needs the user again/)
  assert.equal(recoveredState({ ...cut, status: 'awaiting_user', inflight: null }).status, STATUS.AWAITING_USER, 'a task waiting for the user keeps waiting')
})

test('when a task ends, Nova\'s tabs stay open by default; they close only when the user chose it; the user\'s are never in the list', () => {
  assert.deepEqual(tabsToClose({}, [11, 12, 13]), [], 'default: nothing is closed')
  assert.deepEqual(tabsToClose({ closeTabs: false }, [11, 12, 13]), [])
  assert.deepEqual(tabsToClose({ keepTabs: false }, [11, 12, 13]), [], 'the old setting no longer closes anything')
  assert.deepEqual(tabsToClose({ closeTabs: true }, [11, 12, 13]), [11, 12, 13])
  assert.deepEqual(tabsToClose({}, []), [], 'only Nova\'s own tabs are ever passed (tools.ownTabs)')
  const runtime = readFileSync(new URL('../src/lib/agent-runtime.js', import.meta.url), 'utf8')
  assert.match(runtime, /const own = tools\.ownTabs\(\)/); assert.match(runtime, /tabsToClose\(state, own\)/)
  assert.match(runtime, /chrome\.tabs\.update\(state\.startTab\.id, \{ active: true \}\)/, 'back to the tab the task started on')
})

// ── Measurement ───────────────────────────────────────────────────────────────

test('each task\'s model calls, tokens, actions and tabs are measured, and kept on the device without the objective', async () => {
  const state = newState({ objective: 'secret objective words', start: START })
  await createAgent({ state, tools: fakeTools([]), client: client([{ tool: 'click', args: { index: 3 } }, finish()], { inputTokens: 2000, outputTokens: 150 }) }).start()
  const m = taskMetrics(state)
  assert.equal(m.modelCalls, 2)
  assert.equal(m.inputTokens, 4000)
  assert.equal(m.outputTokens, 300)
  assert.equal(m.actions, 1)
  const store = { data: {}, async get(k) { return { [k]: this.data[k] } }, async set(v) { Object.assign(this.data, v) } }
  await recordTaskMetrics(store, state)
  assert.equal(store.data[METRICS_KEY].length, 1)
  assert.ok(!JSON.stringify(store.data).includes('secret objective'), 'no objective text is kept')
})

// ── Routing a request ─────────────────────────────────────────────────────────

test('a request goes the way Kivo read it; a picture is always a question; without Kivo, the surface decides', () => {
  assert.equal(routeOf({ route: 'chat', kind: 'summarise_page', scope: { short: true } }).route, 'chat')
  assert.equal(routeOf({ route: 'research', kind: 'compare' }).route, 'research')
  assert.equal(routeOf({ route: 'task', kind: 'quiz', scope: { limit: 3 } }).scope.limit, 3)
  assert.equal(routeOf({ route: 'task' }, { hasScreenshot: true }).route, 'chat')
  assert.deepEqual(routeOf(null, { surface: 'panel' }).route, 'task')
  assert.deepEqual(routeOf(null, { surface: 'popup' }).route, 'chat')
})

test('sources are the pages the answer cites, counted', () => {
  assert.deepEqual([...citedIn('A [1], B [3], both [1, 3]; not [x] or [999].')].sort(), [1, 3])
  assert.equal(samePage('https://a.example/x/#top', 'https://www.a.example/x'), true)
  assert.equal(samePage('https://a.example/x?p=1', 'https://a.example/x?p=2'), false)
})

// ── The page follows the user ─────────────────────────────────────────────────

test('a tab is described as Nova may see it: ready, no access, unknown or unsupported', () => {
  assert.equal(describeTab({ id: 1, url: 'https://a.example/', title: 'A' }, true).status, 'ready')
  assert.equal(describeTab({ id: 1, url: 'https://a.example/', title: 'A' }, false).status, 'no_access')
  assert.equal(describeTab({ id: 1 }, false).status, 'unknown', 'no address: Nova was not opened there and does not follow tabs')
  assert.equal(describeTab({ id: 1, url: 'chrome://settings' }, false).status, 'unsupported')
})

test('the panel follows a switch of tab and a page change in the same tab, skips the agent\'s own tabs, and knows when a reading is stale', async () => {
  const tabs = new Map([[1, { id: 1, url: 'https://a.example/', title: 'A' }], [2, { id: 2, url: 'https://b.example/', title: 'B' }], [9, { id: 9, url: 'https://nova-tab.example/', title: 'Nova’s' }]])
  let front = 1
  let fire = null
  const seen = []
  const browser = {
    activeTabIn: async () => tabs.get(front), tab: async id => tabs.get(id), canRead: async id => id !== 2,
    onTabsChanged: (_w, cb) => { fire = cb; return () => {} },
  }
  const ctx = createPageContext({ browser, windowId: 7, isAgentTab: id => id === 9, onChange: p => seen.push(`${p.tabId}:${p.status}:${p.title}`) })
  await ctx.refresh()
  const v1 = ctx.current().version
  front = 2; fire({ kind: 'switched', tabId: 2 }); await ctx.refresh()
  assert.equal(ctx.current().status, 'no_access', 'B is known but Nova may not read it yet')
  assert.equal(ctx.isStale(v1), true, 'a reading of A is stale now')
  tabs.set(2, { id: 2, url: 'https://b.example/next', title: 'B next' }); fire({ kind: 'changed', tabId: 2 }); await ctx.refresh()
  front = 9; fire({ kind: 'switched', tabId: 9 }); await ctx.refresh()
  assert.equal(ctx.current().tabId, 2, 'the agent\'s own tab is not a move by the user')
  tabs.set(1, { id: 1, url: 'https://a.example/other', title: 'A other' }); front = 2; fire({ kind: 'changed', tabId: 1 }); await ctx.refresh()
  assert.equal(ctx.current().title, 'B next', 'a change in a background tab is not a move')
  assert.deepEqual(seen, ['1:ready:A', '2:no_access:B', '2:no_access:B next'])
})

// ── A stand-in browser for the loop ──────────────────────────────────────────

function fakeTools(calls, { confirmIndex = null, start = null, parts = 1, access = null, alwaysAccess = false } = {}) {
  let page = start ? { url: start, title: 'Start', kind: 'page' } : null
  const read = new Set([1])
  const searched = []
  const obs = () => ({ tab: 1, url: page?.url ?? 'about:blank', title: page?.title ?? '', print: `p${calls.length}`, part: 1, parts, text: 'text', elements: [{ i: 3, role: 'button', name: 'Go' }, { i: 9, role: 'button', name: 'Buy now' }], links: [], kind: 'page' })
  return {
    current: () => (page ? 1 : 1), page: () => page, snapshot: () => ({ tabs: [], current: 1 }), tabList: () => [], ownTabs: () => [],
    coverage: () => (page ? { parts, read: [...read], searched } : null),
    async check(action) { return action.tool === 'click' && action.args.index === confirmIndex ? '"Buy now" could change something on that site.' : null },
    async observe() { calls.push(['observe']); return page ? { ok: true, result: 'read', observation: obs() } : { ok: false, result: 'No page is open.' } },
    async click({ index }) { calls.push(['click', index]); return { ok: true, changed: true, result: 'Clicked; the page changed.', observation: obs() } },
    async search({ query }) { calls.push(['search', query]); return { ok: true, result: 'results', observation: { ...obs(), kind: 'search_results', url: 'https://html.duckduckgo.com/html/' }, results: [{ title: 'R', url: 'https://r.example/' }] } },
    async find({ query }) { calls.push(['find', query]); searched.push(query); return { ok: true, result: 'Found', observation: obs() } },
    async open({ url }) {
      calls.push(['open', url])
      if (access && url.includes(access) && (alwaysAccess || calls.filter(c => c[0] === 'open').length === 1)) return { ok: false, needsAccess: { site: 'github.com', pattern: 'https://github.com/*', url }, result: 'needs access' }
      page = { url, title: 'Opened', kind: 'page' }
      return { ok: true, result: 'opened', observation: obs() }
    },
    async read({ part }) { read.add(part); return { ok: true, result: 'part', observation: obs() } },
  }
}

test('limits are unchanged by default', () => {
  assert.deepEqual(DEFAULT_LIMITS, { steps: 30, minutes: 12, modelCalls: 36 })
})

// ── Capture's picker: the same tree as the web's ──────────────────────────────
import { placeChildren, placeParents } from '../src/lib/places.js'

test('Capture browses subject → topic → nested topic, and two "Introduction" topics stay apart', () => {
  const places = [
    { subjectId: 'ai', subjectName: 'AI', topicId: null, topicName: null, path: ['AI'] },
    { subjectId: 'ai', subjectName: 'AI', topicId: 'ml', topicName: 'Machine Learning', path: ['AI', 'Machine Learning'] },
    { subjectId: 'ai', subjectName: 'AI', topicId: 'dl', topicName: 'Deep Learning', path: ['AI', 'Machine Learning', 'Deep Learning'] },
    { subjectId: 'ai', subjectName: 'AI', topicId: 'ai-i', topicName: 'Introduction', path: ['AI', 'Introduction'] },
    { subjectId: 'sci', subjectName: 'Science', topicId: null, topicName: null, path: ['Science'] },
    { subjectId: 'ch', subjectName: 'Chemistry', topicId: null, topicName: null, path: ['Science', 'Chemistry'] },
    { subjectId: 'ch', subjectName: 'Chemistry', topicId: 'ch-i', topicName: 'Introduction', path: ['Science', 'Chemistry', 'Introduction'] },
  ]
  const parents = placeParents(places)
  assert.deepEqual(placeChildren(places, parents, null).map(p => p.path.at(-1)), ['AI', 'Science'])
  assert.deepEqual(placeChildren(places, parents, 's:ai').map(p => p.topicId), ['ai-i', 'ml'])
  assert.deepEqual(placeChildren(places, parents, 't:ml').map(p => p.topicId), ['dl'])
  assert.deepEqual(placeChildren(places, parents, 's:sci').map(p => p.subjectId), ['ch'], 'a subject inside a subject')
  assert.equal(parents.get('t:ch-i'), 's:ch', 'Chemistry’s Introduction is Chemistry’s, not AI’s')
})

import { needsConfirmation } from '../src/lib/agent-tools.js'
test('a list row or long label is content: a risky word inside it does not ask; a button that starts with one still does', () => {
  const row = label => ({ exists: true, tag: 'tr', role: 'row', label, isSubmit: false, form: null })
  assert.equal(needsConfirmation(row('Library Your book is due tomorrow - Operating System Concepts'), 'click'), null)
  assert.equal(needsConfirmation(row('Newsletter Post of the week: ten links about databases'), 'click'), null)
  assert.equal(needsConfirmation({ exists: true, tag: 'div', role: '', label: 'Read why we decided to delete the old wiki pages last year', isSubmit: false, form: null }, 'click'), null)
  assert.match(needsConfirmation({ exists: true, tag: 'button', role: '', label: 'Book now', isSubmit: false, form: null }, 'click'), /could change/)
  assert.match(needsConfirmation({ exists: true, tag: 'button', role: '', label: 'Delete this conversation and all of its messages', isSubmit: false, form: null }, 'click'), /could change/, 'a long label that starts with the action still asks')
  assert.match(needsConfirmation({ exists: true, tag: 'button', role: '', label: 'Send', isSubmit: false, form: null }, 'click'), /could change/)
})

// ── Kivo's Knowledge Map: by id, through the map's own bridge ─────────────────
test('the map tool talks to the map by node id through its bridge, points at the real node, and asks before connecting', async () => {
  const page = readFileSync(new URL('../src/lib/agent-page.js', import.meta.url), 'utf8')
  const fn = page.match(/export async function mapRequest\([\s\S]*?\n\}/)[0]
  assert.match(fn, /querySelector\('\[data-kivo-map-bridge\]'\)/)
  assert.match(fn, /new CustomEvent\('kivo-map:request', \{ detail: JSON\.stringify/, 'text in')
  assert.match(fn, /JSON\.parse\(bridge\.dataset\.response/, 'text out')
  assert.ok(!/clientX|elementFromPoint|getBoundingClientRect/.test(fn), 'no screen coordinates drive the action')
  assert.match(page, /querySelector\(`\[data-node-id="\$\{CSS\.escape\(String\(id\)\)\}"\]`\)/, 'the pointer finds the node by its id where it is drawn now')
  const { createBrowserTools } = await import('../src/lib/agent-tools.js')
  const tools = createBrowserTools({ chrome: {}, startTab: { id: 1, url: 'https://www.thekivo.in/map', title: 'Map' } })
  assert.match(await tools.check({ tool: 'map', args: { op: 'connect', id: 'topic:a', to: 'note:b' } }), /would change your Knowledge Map: connect topic:a and note:b/)
  assert.equal(await tools.check({ tool: 'map', args: { op: 'open', id: 'topic:a' } }), null, 'looking around the map needs no OK')
})

// ── Where each part of Nova works (17 Nov) ──────────────────────────────────
test('capture and chat need a website; Do it for me starts from any tab', () => {
  const popup = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8')
  const unsupported = popup.slice(popup.indexOf('if (!page.supported) {'), popup.indexOf("page = { ...page, canonicalUrl: probe.canonicalUrl"))
  assert.match(unsupported, /doItOpen/, 'Do it for me is offered on a new tab or browser page')
  assert.match(unsupported, /researchOpen/)
  assert.doesNotMatch(unsupported, /capture: ''|client\.capture|chatOpen|askOpen|client\.save|client\.study|readPage/, 'no Capture, chat, Save or Study there')
  const panel = readFileSync(new URL('../src/sidepanel.js', import.meta.url), 'utf8')
  assert.match(panel, /const blankPage = p => \(\{ blank: true/)
  assert.match(panel, /\(forceTask \|\| blank\) && read\.route === 'chat'/, 'on a tab that is not a website, every request is a task')
  assert.match(panel, /blank \? null : selButton, blank \? null : shotButton, blank \? null : regionButton/, 'no page tools there')
  assert.match(panel, /!chatOnly \? blankPage\(p\) : null/, 'the popup chat never opens on a non-website')
  const tools = readFileSync(new URL('../src/lib/agent-tools.js', import.meta.url), 'utf8')
  assert.match(tools, /This tab is a new tab or a browser page, with nothing on it to read\. Open the site the task needs/)
})

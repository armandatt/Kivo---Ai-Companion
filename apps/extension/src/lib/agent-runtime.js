// Where Nova's browser agent runs: the extension's background worker, so a
// task goes on while the user switches tabs or closes the side panel. The
// panel (sidepanel.js) starts a task and shows it; everything it does to the
// task goes through these messages, from Kivo's own pages only:
//
//   agent:begin   { objective, history, tab: {id, url, title}, windowId, watch, mode, scope, keepTabs }
//   agent:pause | agent:resume | agent:stop            { task }
//   agent:answer  { task, id, text }   an answer, or "done" after hand_over
//   agent:confirm { task, id, allowed } yes or no to an action with consequences
//   agent:access  { task, id, granted, pattern, anySite, remember }   after the panel asked the browser
//   agent:show    { tab }              bring a task's tab to the front
//   agent:close-tabs | agent:dismiss
//
// `task` (and `id`, the question being answered) must name the task and the
// question that are current: an answer from a panel showing an older task,
// or to a question already answered, does nothing.
//
// One task at a time. A new request is never blocked by a task that is only
// waiting (for an answer, an OK, a site) or paused: that task is cancelled
// and the new one starts. A task that is actively working is stopped only
// when the user says so ("Stop that task and do this").
//
// Its state is in chrome.storage.session (STATE_KEY): the panel reads it from
// there and redraws when it changes. A worker that restarts finds a task that
// was running and pauses it; an action that was in flight is marked as
// interrupted, and Resume looks at the page before anything else is done, so
// nothing is submitted twice.
//
// When the task ends: access allowed for this task only ("Any site, this
// task") is given back; sites the user allowed with "Allow this site" stay
// allowed until they remove them (Sites Nova can use, in the popup); the
// tabs Nova opened are closed unless the user keeps them (never one of the
// user's own tabs); the waiting mark on the icon is cleared.
// While it runs, a trivial extension call every 20 s keeps the worker awake.

import { NOVA_URL } from '../config.js'
import { createClient } from './api.js'
import { createStore } from './store.js'
import { FINISHED, STATE_KEY, STATUS, WAITING, createAgent, newState, recoveredState, statusOf, tabsToClose } from './agent.js'
import { ANY_SITE, createBrowserTools, siteOf } from './agent-tools.js'
import { recordTaskMetrics } from './metrics.js'

const KEEPALIVE_MS = 20_000
const store = createStore(chrome.storage.local)
const client = createClient({ baseUrl: NOVA_URL, fetch: (...args) => fetch(...args), getToken: () => store.token() })
const session = chrome.storage.session

let agent = null
let tools = null
let keepalive = null
let ending = null

const load = async () => (await session.get(STATE_KEY).catch(() => ({})))?.[STATE_KEY] ?? null
const persist = state => session.set({ [STATE_KEY]: state }).catch(() => undefined)

function awake(on) {
  if (on && !keepalive) keepalive = setInterval(() => { void chrome.runtime.getPlatformInfo() }, KEEPALIVE_MS)
  if (!on && keepalive) { clearInterval(keepalive); keepalive = null }
}

// The icon on the task's tab says when Nova is waiting for the user.
function mark(state) {
  const tabId = state.startTab?.id
  if (typeof tabId !== 'number' || !chrome.action?.setBadgeText) return
  const status = statusOf(state.status)
  const waiting = WAITING.includes(status)
  void chrome.action.setBadgeBackgroundColor({ tabId, color: waiting ? '#f5a524' : '#3fb6a8' }).catch(() => undefined)
  void chrome.action.setBadgeText({ tabId, text: waiting ? '!' : status === STATUS.RUNNING ? '…' : '' }).catch(() => undefined)
}

// The tab in front of the user, when it is not one of the task's.
async function watching(state) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId })
    if (!tab || !/^https?:/.test(tab.url || '') || tools?.tabList().some(t => t.tab === tab.id)) return null
    return { tab: tab.id, title: (tab.title || '').slice(0, 120), site: siteOf(tab.url || '') }
  } catch { return null }
}

async function finishUp(state, tools) {
  awake(false)
  mark(state)
  // Access allowed for this task only is given back; remembered sites stay.
  const origins = [...new Set([...(state.granted ?? []), ...(state.anySite ? ANY_SITE : [])])]
  if (origins.length) await chrome.permissions.remove({ origins }).catch(() => false)
  await tools?.clearOverlays().catch(() => undefined)
  if (tools) {
    let active = null
    try { [{ id: active } = {}] = await chrome.tabs.query({ active: true, windowId: state.windowId }) } catch { /* none */ }
    const close = tabsToClose(state, tools.ownTabs())
    // Nova's tab is in front: the user goes back to the tab the task started on.
    if (close.includes(active) && typeof state.startTab?.id === 'number') await chrome.tabs.update(state.startTab.id, { active: true }).catch(() => undefined)
    if (close.length) {
      await chrome.tabs.remove(close).catch(() => undefined)
      state.closedTabs = close.length
    }
    state.browser = tools.snapshot()
    state.browser.tabs = state.browser.tabs.filter(([id]) => !close.includes(id))
  }
  // Saved only while it is still the task on record (a new one may have replaced it).
  if ((await load())?.id === state.id) await persist(state)
  await recordTaskMetrics(chrome.storage.local, state).catch(() => undefined)
}

function build(state) {
  const own = createBrowserTools({ chrome, windowId: state.windowId, startTab: state.startTab, restore: state.browser, privateTexts: () => state.privateTexts ?? [], watch: () => state.watch !== false })
  tools = own
  // Saves only while this is the task on record: a replaced task never writes over its successor.
  const save = async s => { const stored = await load(); if (!stored || stored.id === s.id) await persist(s) }
  agent = createAgent({
    state, tools: own, client, save, watching: () => watching(state),
    onUpdate: s => {
      mark(s)
      awake(s.status === STATUS.RUNNING)
      if (FINISHED.includes(s.status) && ending !== s.id) { ending = s.id; void finishUp(s, own) }
    },
  })
  return agent
}

async function current() {
  if (agent) return agent
  const state = await load()
  return state ? build(state) : null
}

// Whether a message is about the task that is current (an old panel's is not).
const forTask = (a, task) => Boolean(a) && (!task || a.state.id === task)

async function begin({ objective, history, tab, windowId, watch, mode, scope, keepTabs }) {
  if (!objective || typeof objective !== 'string') return { ok: false, message: 'Say what Nova should do.' }
  const running = await current()
  let superseded = null
  if (running && !FINISHED.includes(statusOf(running.state.status))) {
    const status = statusOf(running.state.status)
    // Actively working: the user decides. Waiting or paused: replaced.
    if (status === STATUS.RUNNING && running.running()) return { ok: false, busy: true, tab: running.state.startTab?.id ?? null, message: 'Nova is still working on another task. Stop it to do this instead.' }
    superseded = running.state.objective
    await running.stop()
  }
  const started = await client.agentStart(objective.slice(0, 1000), String(tab?.title ?? '').slice(0, 200))
  if (!started.ok || !started.data?.success) return { ok: false, kind: started.kind ?? started.data?.error, message: started.ok ? started.data?.message ?? 'Nova could not start.' : started.message }
  const state = newState({
    objective: objective.slice(0, 1000), history: Array.isArray(history) ? history.slice(-6) : [], start: started.data,
    startTab: tab && typeof tab.id === 'number' ? { id: tab.id, url: String(tab.url ?? ''), title: String(tab.title ?? '') } : null,
    windowId: typeof windowId === 'number' ? windowId : undefined,
    mode: mode === 'research' ? 'research' : 'page', scope: scope && typeof scope === 'object' ? scope : undefined,
  })
  state.watch = watch !== false
  state.keepTabs = keepTabs === true
  ending = null
  await persist(state)
  build(state)
  void agent.start()
  return { ok: true, id: state.id, superseded }
}

const HANDLERS = {
  'agent:begin': begin,
  'agent:pause': async ({ task }) => { const a = await current(); if (!forTask(a, task)) return { ok: false, stale: true }; a.pause(); return { ok: true } },
  'agent:resume': async ({ task }) => { const a = await current(); if (!forTask(a, task) || FINISHED.includes(a.state.status)) return { ok: false, stale: true }; ending = null; void a.start(); return { ok: true } },
  'agent:stop': async ({ task }) => { const a = await current(); if (a && forTask(a, task)) await a.stop(); return { ok: true } },
  'agent:answer': async ({ task, id, text }) => { const a = await current(); if (!forTask(a, task)) return { ok: false, stale: true }; void a.answer(String(text ?? ''), id ?? null); return { ok: true } },
  'agent:confirm': async ({ task, id, allowed }) => { const a = await current(); if (!forTask(a, task)) return { ok: false, stale: true }; void a.confirm(allowed === true, id ?? null); return { ok: true } },
  'agent:access': async ({ task, id, granted, pattern, anySite, remember }) => {
    const a = await current()
    if (!forTask(a, task)) return { ok: false, stale: true }
    // A remembered site is the user's to remove; only a task-only grant is given back at the end.
    void a.access(granted === true, { pattern: typeof pattern === 'string' && remember !== true ? pattern : null, anySite: anySite === true, id: id ?? null })
    return { ok: true }
  },
  'agent:show': async ({ tab }) => { await current(); return { ok: Boolean(await tools?.showTab(Number(tab))) } },
  'agent:close-tabs': async () => { await current(); await tools?.closeOwnTabs(); if (agent) await persist({ ...agent.state, browser: tools.snapshot() }); return { ok: true } },
  'agent:dismiss': async () => {
    const state = await load()
    if (state && !FINISHED.includes(statusOf(state.status))) return { ok: false }
    agent = null; tools = null
    await session.remove(STATE_KEY).catch(() => undefined)
    return { ok: true }
  },
}

/** Handles a message from one of Kivo's own pages; false when it is not the agent's. */
export function handleAgentMessage(message, sender, reply) {
  const handler = HANDLERS[message?.type]
  if (!handler) return false
  // Only Kivo's own pages (the side panel), never a web page or the overlay a page holds.
  if (sender.id !== chrome.runtime.id || !String(sender.url ?? '').startsWith(chrome.runtime.getURL(''))) return false
  void handler(message).then(reply, err => { console.error('[kivo agent]', err); reply({ ok: false, message: 'Nova had a problem. Try again.' }) })
  return true
}

export async function recoverAgent() {
  const state = await load()
  if (!state || agent) return
  const next = recoveredState(state)
  await persist(next)
  mark(next)
}

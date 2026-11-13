// Where Nova's browser agent runs: the extension's background worker, so a
// task goes on while the learner switches tabs or closes the side panel (a
// side panel belongs to one tab and is closed when another is shown). The
// panel (sidepanel.js) starts a task and shows it; everything it does to the
// task goes through these messages, from Kivo's own pages only:
//
//   agent:begin   { objective, history, tab: {id, url, title}, windowId, watch }
//   agent:pause | agent:resume | agent:stop
//   agent:answer  { text }          an answer, or "done" after hand_over
//   agent:confirm { allowed }       yes or no to an action with consequences
//   agent:access  { granted, pattern, anySite }   after the panel asked the browser
//   agent:show    { tab }           bring a task's tab to the front
//   agent:close-tabs | agent:dismiss
//
// One task at a time. Its state is in chrome.storage.session (STATE_KEY):
// the panel reads it from there and redraws when it changes. A worker that
// restarts finds a task that was running and marks it paused (Resume carries
// on from the saved state, its tabs included).
//
// When the task ends: website access allowed for it is given back, the
// waiting mark on the icon is cleared, and on Stop the tabs Nova opened are
// closed. In watch mode (the learner's choice) the side panel is set for
// the whole window while the task runs, so it stays beside the tabs Nova
// brings to the front, and the overlay is taken off the pages at the end.
// While it runs, a trivial extension call every 20 s keeps the worker
// awake (Chrome ends an idle worker after 30 s; a model call can take longer).

import { NOVA_URL } from '../config.js'
import { createClient } from './api.js'
import { createStore } from './store.js'
import { FINISHED, STATE_KEY, createAgent, newState } from './agent.js'
import { ANY_SITE, createBrowserTools, siteOf } from './agent-tools.js'

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

// The icon on the task's tab says when Nova is waiting for the learner.
function mark(state) {
  const tabId = state.startTab?.id
  if (typeof tabId !== 'number' || !chrome.action?.setBadgeText) return
  const waiting = ['asking', 'confirming', 'access'].includes(state.status)
  void chrome.action.setBadgeBackgroundColor({ tabId, color: waiting ? '#f5a524' : '#3fb6a8' }).catch(() => undefined)
  void chrome.action.setBadgeText({ tabId, text: waiting ? '!' : state.status === 'running' ? '…' : '' }).catch(() => undefined)
}

// The tab in front of the learner, when it is not one of the task's.
async function watching(state) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId })
    if (!tab || !/^https?:/.test(tab.url || '') || tools?.tabList().some(t => t.tab === tab.id)) return null
    return { tab: tab.id, title: (tab.title || '').slice(0, 120), site: siteOf(tab.url || '') }
  } catch { return null }
}

async function finishUp(state) {
  awake(false)
  mark(state)
  // Access allowed for this task only is given back.
  const origins = [...new Set([...(state.granted ?? []), ...(state.anySite ? ANY_SITE : [])])]
  if (origins.length) await chrome.permissions.remove({ origins }).catch(() => false)
  await tools?.clearOverlays().catch(() => undefined)
  if (state.status === 'stopped') await tools?.closeOwnTabs().catch(() => undefined)
}

function build(state) {
  tools = createBrowserTools({ chrome, windowId: state.windowId, startTab: state.startTab, restore: state.browser, privateTexts: () => state.privateTexts ?? [], watch: () => state.watch !== false })
  agent = createAgent({
    state, tools, client, save: persist, watching: () => watching(state),
    onUpdate: s => {
      mark(s)
      awake(s.status === 'running')
      if (FINISHED.includes(s.status) && ending !== s.id) { ending = s.id; void finishUp(s) }
    },
  })
  return agent
}

async function current() {
  if (agent) return agent
  const state = await load()
  return state ? build(state) : null
}

async function begin({ objective, history, tab, windowId, watch }) {
  const running = await load()
  if (running && !FINISHED.includes(running.status)) return { ok: false, busy: true, tab: running.startTab?.id ?? null, message: 'Nova is already working on a task. Stop it first, or wait for it to finish.' }
  if (!objective || typeof objective !== 'string') return { ok: false, message: 'Say what Nova should do.' }
  const started = await client.agentStart(objective.slice(0, 1000), String(tab?.title ?? '').slice(0, 200))
  if (!started.ok || !started.data?.success) return { ok: false, kind: started.kind ?? started.data?.error, message: started.ok ? started.data?.message ?? 'Nova could not start.' : started.message }
  const state = newState({
    objective: objective.slice(0, 1000), history: Array.isArray(history) ? history.slice(-6) : [], start: started.data,
    startTab: tab && typeof tab.id === 'number' ? { id: tab.id, url: String(tab.url ?? ''), title: String(tab.title ?? '') } : null,
    windowId: typeof windowId === 'number' ? windowId : undefined,
  })
  state.watch = watch !== false
  // Watching: the panel goes with the learner to the tabs Nova brings forward
  // (a tab of Nova's has no panel of its own, so it shows this one).
  if (state.watch && state.startTab && chrome.sidePanel?.setOptions) await chrome.sidePanel.setOptions({ path: `sidepanel.html?tab=${state.startTab.id}`, enabled: true }).catch(() => undefined)
  ending = null
  await persist(state)
  build(state)
  void agent.start()
  return { ok: true, id: state.id }
}

const HANDLERS = {
  'agent:begin': begin,
  'agent:pause': async () => { (await current())?.pause(); return { ok: true } },
  'agent:resume': async () => { const a = await current(); if (!a) return { ok: false }; ending = null; void a.start(); return { ok: true } },
  'agent:stop': async () => { const a = await current(); if (a) await a.stop(); return { ok: true } },
  'agent:answer': async ({ text }) => { const a = await current(); void a?.answer(String(text ?? '')); return { ok: Boolean(a) } },
  'agent:confirm': async ({ allowed }) => { const a = await current(); void a?.confirm(allowed === true); return { ok: Boolean(a) } },
  'agent:access': async ({ granted, pattern, anySite }) => { const a = await current(); void a?.access(granted === true, { pattern: typeof pattern === 'string' ? pattern : null, anySite: anySite === true }); return { ok: Boolean(a) } },
  'agent:show': async ({ tab }) => { await current(); return { ok: Boolean(await tools?.showTab(Number(tab))) } },
  'agent:close-tabs': async () => { await current(); await tools?.closeOwnTabs(); if (agent) await persist({ ...agent.state, browser: tools.snapshot() }); return { ok: true } },
  'agent:dismiss': async () => {
    const state = await load()
    if (state && !FINISHED.includes(state.status)) return { ok: false }
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

/** A worker that starts with a task still marked running: it was cut off, so it waits to be resumed. */
export async function recoverAgent() {
  const state = await load()
  if (!state || agent) return
  if (state.status === 'running') {
    state.status = 'paused'
    state.current = 'Paused: Nova’s background work restarted. Press Resume to carry on.'
    await persist(state)
  }
  mark(state)
}

// Research mode in Kivo's side panel: the learner gives an objective, Kivo
// works through several sources for it, and organises what it found into
// their workspace once they have looked at it.
//
//   1. Objective, and optionally the page they are on. Start asks the browser
//      for website access (optional_host_permissions), for this task only:
//      it is given back when the task ends.
//   2. What their Kivo workspace already holds for it (server: context).
//   3. The loop (lib/agent.js), one decision at a time, in background tabs
//      of its own (lib/agent-tools.js). Pause, resume and stop at any time;
//      it asks before anything that could change something on a site.
//   4. The result: a comparison citing its sources, the findings grouped by
//      source (quotes checked against the page, Kivo's reading kept apart),
//      concepts, gaps, and what was already in Kivo. Save to Drafts captures
//      each finding the way a selected passage is captured, and Kivo files
//      each one under the learner's own subject and topic (lib/places.js).
//
// The task's state lives in this browser's memory (chrome.storage.session)
// so a closed panel can resume. Kivo's server keeps none of it.

import { NOVA_URL } from './config.js'
import { createClient } from './lib/api.js'
import { browser } from './lib/browser.js'
import { describePage } from './lib/page.js'
import { parse, render } from './lib/markdown.js'
import { createStore } from './lib/store.js'
import { DEFAULT_LIMITS, STATE_KEY, actionWords, createAgent, newState } from './lib/agent.js'
import { createBrowserTools } from './lib/agent-tools.js'
import { placementLine } from './lib/places.js'
import { alertBox, busy, el, idle, siteInitial, sr } from './lib/ui.js'

const store  = createStore(browser.storage())
const client = createClient({ baseUrl: NOVA_URL, fetch: (...args) => fetch(...args), getToken: () => store.token() })
const params = new URLSearchParams(location.search)
const tabId  = Number(params.get('tab'))
if (params.get('inline') === '1') document.documentElement.dataset.inline = ''
const view   = document.getElementById('view')
const status = document.getElementById('status')
const setStatus = (kind, text) => { status.dataset.status = kind; status.textContent = text }
const openNova = path => { void browser.openTab(`${NOVA_URL}${path}`) }
const katex = () => globalThis.katex ?? null
const ORIGINS = ['https://*/*', 'http://*/*']
const KEY = `${STATE_KEY}:${Number.isInteger(tabId) ? tabId : 'x'}`
const session = chrome.storage.session

const EXAMPLES = [
  'Explain the main Retrieval-Augmented Generation architectures and how they differ',
  'Find the best introductions to Raft consensus and compare how they explain leader election',
  'What does current research say about spaced repetition intervals?',
]

const saved = async () => (await session.get(KEY).catch(() => ({})))?.[KEY] ?? null
const persist = state => session.set({ [KEY]: state }).catch(() => undefined)
const forget = () => session.remove(KEY).catch(() => undefined)
const giveBackAccess = () => chrome.permissions?.remove?.({ origins: ORIGINS }).catch(() => false)

let page = null
let windowId
let agent = null

function header(extra = null) {
  return el('section', { class: 'pagebar', ariaLabel: 'Research' },
    el('span', { class: 'site', ariaHidden: 'true' }, 'R'),
    el('div', { class: 'pagebar-text' }, el('p', { class: 'pagebar-title' }, 'Research with Kivo'), el('p', { class: 'small' }, 'Kivo searches, reads and organises sources for you')),
    el('div', { class: 'pagebar-tools' }, extra,
      page ? el('button', { class: 'link', type: 'button', dataset: { askMode: '' }, title: 'Ask about the page you are on', onclick: () => { location.href = `sidepanel.html?tab=${tabId}${document.documentElement.dataset.inline !== undefined ? '&inline=1' : ''}` } }, 'Ask about this page') : null))
}
const frame = (...children) => view.replaceChildren(header(), el('div', { class: 'research' }, el('div', { class: 'research-body' }, ...children)),
  el('footer', { class: 'research-foot small' }, el('button', { class: 'link ext', type: 'button', onclick: () => openNova('/notes/drafts') }, 'Drafts in Kivo'), el('span', {}, 'Kivo reads only the pages it opens for this task.')))

// ── 1. The objective ──────────────────────────────────────────────────────────

function renderSetup(note = null) {
  setStatus('connected', 'Ready')
  const objective = el('textarea', { id: 'objective', class: 'objective', placeholder: 'What do you want to understand? Kivo will search, read and compare sources, then organise the findings in your workspace.', maxLength: 1000 })
  const include = page?.supported ? el('input', { type: 'checkbox', id: 'include', checked: false }) : null
  const start = el('button', { class: 'primary wide', type: 'button', disabled: true, dataset: { researchStart: '' } }, 'Start research')
  const errors = el('div', { class: 'errors' })
  objective.addEventListener('input', () => { start.disabled = !objective.value.trim() })
  objective.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !start.disabled) start.click() })

  start.addEventListener('click', () => {
    const goal = objective.value.trim()
    if (!goal) return
    // Asked straight from the click, as the browser requires.
    const asking = chrome.permissions?.request ? chrome.permissions.request({ origins: ORIGINS }) : Promise.resolve(false)
    busy(start, 'Starting…'); start.disabled = true; errors.replaceChildren()
    void asking.then(async granted => {
      if (!granted) { idle(start); start.disabled = false; errors.replaceChildren(alertBox('Kivo needs your OK to open and read web pages for this task. It is asked for each task and given back when the task ends.')); return }
      const ctx = await client.researchContext(goal)
      if (!ctx.ok) { idle(start); start.disabled = false; void giveBackAccess(); errors.replaceChildren(alertBox(ctx.message)); return }
      const state = newState({ objective: goal, workspace: ctx.data, includePage: include?.checked ? { id: tabId, url: page.url, title: page.title } : null })
      await persist(state)
      run(state)
    })
  })

  frame(
    note ? el('p', { class: 'toast', role: 'status' }, note) : null,
    el('div', {}, el('h1', {}, 'What should Kivo research?'), el('p', { class: 'small' }, `It checks your Kivo workspace first, then uses up to ${DEFAULT_LIMITS.steps} steps (about ${DEFAULT_LIMITS.minutes} minutes). You can pause or stop it at any time.`)),
    el('div', { class: 'field' }, sr('Research objective', { htmlFor: 'objective' }), objective),
    el('div', { class: 'ideas' }, EXAMPLES.map(text => el('button', { class: 'idea', type: 'button', onclick: () => { objective.value = text; start.disabled = false; objective.focus() } }, text))),
    include ? el('label', { class: 'check', htmlFor: 'include' }, include, el('span', {}, `Include the page you are on (${page.domain})`)) : null,
    errors, start,
    el('p', { class: 'small' }, 'Kivo opens pages in background tabs of its own and reads them. It never signs in, buys, posts or fills in forms, and asks you before anything that could change something on a site. Web pages are treated as material to read, never as instructions.'))
  objective.focus()
}

// ── 2–3. Running ─────────────────────────────────────────────────────────────

function run(state, { resume = false } = {}) {
  const tools = createBrowserTools({ chrome, windowId, startTab: state.includePage })
  agent = createAgent({ state, tools, client, save: persist, onUpdate: () => draw() })
  const now = el('div', { class: 'now', role: 'status', ariaLive: 'polite' })
  const controls = el('div', { class: 'run-controls' })
  const meter = el('div', { class: 'meter small' })
  const pending = el('div')
  const steps = el('ol', { class: 'steps', ariaLabel: 'What Kivo has done' })
  const sources = el('ol', { class: 'sources', ariaLabel: 'Sources' })

  function draw() {
    const s = agent.state
    if (['done', 'stopped', 'failed'].includes(s.status)) { void giveBackAccess(); return renderResult(s, tools) }
    setStatus(s.status === 'running' ? 'loading' : 'connected', s.status === 'running' ? 'Researching' : s.status === 'paused' ? 'Paused' : 'Waiting for you')
    now.dataset.status = s.status
    now.textContent = s.error && s.status === 'paused' ? s.error : s.current
    const pause = el('button', { type: 'button', dataset: { researchPause: '' }, onclick: () => { agent.pause(); pause.disabled = true; pause.textContent = 'Pausing…' } }, 'Pause')
    const resumeButton = el('button', { class: 'primary', type: 'button', dataset: { researchResume: '' }, onclick: () => { void agent.start() } }, 'Resume')
    const stop = el('button', { type: 'button', dataset: { researchStop: '' }, onclick: () => void agent.stop() }, 'Stop')
    controls.replaceChildren(s.status === 'running' ? pause : s.status === 'paused' ? resumeButton : null, stop)
    meter.replaceChildren(el('span', {}, `Step ${s.steps.length} of ${s.limits.steps}`), el('span', {}, `${s.sources.length} source${s.sources.length === 1 ? '' : 's'}`), el('span', {}, `${s.findings.length} finding${s.findings.length === 1 ? '' : 's'}`))
    steps.replaceChildren(...s.steps.slice(-12).map(x => el('li', { dataset: { ok: String(x.ok) } }, el('span', {}, `${actionWords(x.action)}${x.ok ? '' : `: ${x.result}`}`))))
    sources.replaceChildren(...s.sources.map(src => el('li', {}, el('span', { class: 'n' }, `[${src.n}]`), el('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.title))))
    pending.replaceChildren()
    if (s.status === 'asking' && s.pending?.kind === 'needs_you') {
      pending.append(el('div', { class: 'card', dataset: { pending: 'needs_you' } },
        el('strong', {}, 'Kivo needs you for a moment'), el('p', {}, s.pending.message),
        el('div', { class: 'run-controls' },
          el('button', { type: 'button', dataset: { showTab: '' }, onclick: () => void tools.showTab(s.pending.tab) }, 'Show the search tab'),
          el('button', { class: 'primary', type: 'button', dataset: { needsYouDone: '' }, onclick: () => void agent.answer('done') }, "I've done it, resume"))))
    } else if (s.status === 'asking' && s.pending) {
      const answer = el('input', { class: 'combo-input', placeholder: 'Your answer' })
      const send = el('button', { class: 'primary', type: 'button', onclick: () => { if (answer.value.trim()) void agent.answer(answer.value.trim()) } }, 'Send')
      answer.addEventListener('keydown', e => { if (e.key === 'Enter') send.click() })
      pending.append(el('div', { class: 'card', dataset: { pending: 'question' } }, el('strong', {}, 'Kivo asks'), el('p', {}, s.pending.question), answer, el('div', { class: 'run-controls' }, send)))
      setTimeout(() => answer.focus(), 0)
    }
    if (s.status === 'confirming' && s.pending) {
      pending.append(el('div', { class: 'card', dataset: { pending: 'confirm' } },
        el('strong', {}, 'Allow this?'), el('p', {}, `${actionWords(s.pending.action)}. ${s.pending.reason}`),
        el('p', { class: 'small' }, `Why Kivo wants to: ${s.pending.thought || 'to continue the research.'}`),
        el('div', { class: 'run-controls' },
          el('button', { type: 'button', dataset: { confirmNo: '' }, onclick: () => void agent.confirm(false) }, "Don't allow"),
          el('button', { class: 'primary', type: 'button', dataset: { confirmYes: '' }, onclick: () => void agent.confirm(true) }, 'Allow once'))))
    }
  }

  frame(
    el('div', {}, el('p', { class: 'small' }, 'Researching'), el('h1', {}, state.objective)),
    now, controls, meter, pending,
    el('details', { open: true }, el('summary', { class: 'small' }, 'Steps'), steps),
    el('div', {}, el('p', { class: 'label' }, 'Sources kept'), sources))
  draw()
  if (!resume || state.status === 'running') void agent.start()
}

// ── 4. The result ─────────────────────────────────────────────────────────────

function renderResult(state, tools) {
  setStatus('connected', state.status === 'done' ? 'Done' : 'Stopped')
  const r = state.result
  const errors = el('div', { class: 'errors' })
  const saveSlot = el('div')
  const bySource = state.sources.map(src => ({ src, items: state.findings.filter(f => f.source === src.n) })).filter(g => g.items.length)
  const save = el('button', { class: 'primary wide', type: 'button', disabled: !state.findings.length && !r?.summary, dataset: { researchSave: '' } }, 'Save to Drafts')
  save.addEventListener('click', () => void saveToDrafts(state, save, saveSlot, errors))

  const ctx = state.context
  frame(
    el('div', {}, el('p', { class: 'small' }, state.status === 'done' ? 'Research done' : state.status === 'stopped' ? 'Stopped by you' : 'Stopped'), el('h1', {}, state.objective)),
    state.error ? alertBox(state.error) : null,
    r?.summary ? el('section', { ariaLabel: 'Summary' }, (() => { const box = el('div', { class: 'md' }); box.append(render(parse(r.summary), { doc: document, katex: katex() })); return box })()) : null,
    r?.concepts?.length ? el('section', { ariaLabel: 'Concepts' }, el('p', { class: 'label' }, 'Key concepts'), el('div', { class: 'chips' }, r.concepts.map(c => el('span', {}, c)))) : null,
    r?.gaps?.length ? el('section', { ariaLabel: 'Gaps' }, el('p', { class: 'label' }, 'Missing from your Kivo'), el('ul', { class: 'kivo-has' }, r.gaps.map(g => el('li', {}, g)))) : null,
    ctx && (ctx.notes?.length || ctx.places?.length) ? el('section', { ariaLabel: 'Already in Kivo' }, el('p', { class: 'label' }, 'Already in your Kivo'),
      el('ul', { class: 'kivo-has' },
        ...(ctx.notes ?? []).slice(0, 6).map(n => el('li', {}, el('button', { class: 'link ext', type: 'button', onclick: () => openNova(`/notes/${encodeURIComponent(n.id)}`) }, n.title), n.filed ? ` · ${n.filed}` : '')),
        ...(ctx.places ?? []).slice(0, 4).map(p => el('li', {}, p.path.join(' › '))))) : null,
    el('section', { ariaLabel: 'Findings' },
      el('p', { class: 'label' }, `Findings (${state.findings.length}), by source`),
      bySource.length ? bySource.map(g => el('div', { class: 'group' },
        el('div', { class: 'group-head' }, el('span', { class: 'n' }, `[${g.src.n}]`), el('a', { href: g.src.url, target: '_blank', rel: 'noopener', title: g.src.url }, g.src.title)),
        g.items.map(f => el('div', { class: 'finding', dataset: { finding: String(f.n) } },
          el('span', { class: 'small' }, f.concept),
          el('blockquote', { class: 'quote' }, f.quote),
          f.note ? el('p', { class: 'reading' }, el('b', {}, 'Kivo’s reading: '), f.note) : null))))
        : el('p', { class: 'small' }, 'No findings were kept.')),
    errors, save, saveSlot,
    el('div', { class: 'run-controls' },
      tools?.ownTabs?.().length ? el('button', { type: 'button', onclick: async e => { await tools.closeOwnTabs(); e.target.remove() } }, 'Close research tabs') : null,
      el('button', { class: 'link', type: 'button', dataset: { researchNew: '' }, onclick: async () => { await forget(); renderSetup() } }, 'New research')))
}

// Each finding is captured the way a selected passage is (one draft for the
// task, the summary first), then filed by Kivo: the same path and service.
async function saveToDrafts(state, button, slot, errors) {
  if (button.getAttribute('aria-busy')) return
  busy(button, 'Saving…'); button.disabled = true; errors.replaceChildren()
  const lines = []
  let draftId = null
  const items = []
  if (state.result?.summary) items.push({ key: `${state.id}-summary`, url: null, title: `Research: ${state.objective}`.slice(0, 300), text: '', note: `${state.result.summary}${state.sources.length ? `\n\nSources:\n${state.sources.map(s => `[${s.n}] ${s.title}: ${s.url}`).join('\n')}` : ''}`.slice(0, 4000), label: 'Summary' })
  for (const f of state.findings) {
    const src = state.sources.find(s => s.n === f.source)
    items.push({ key: f.key, url: src?.url ?? null, title: src?.title ?? '', text: f.quote, context: f.concept, note: f.note ? `Kivo’s reading: ${f.note}` : '', label: f.concept })
  }
  for (const [i, item] of items.entries()) {
    const { label, ...capture } = item
    const res = await client.capture({ ...capture, ...(i === 0 ? { newDraft: true } : {}) })
    if (!res.ok || !res.data.success) { errors.replaceChildren(alertBox(res.ok ? res.data.message : res.message)); break }
    draftId = res.data.draft.id
    lines.push(el('div', { class: 'finding' }, el('span', { class: 'small' }, label), placementLine({ client, draftId, itemId: res.data.itemId })))
  }
  idle(button)
  if (!draftId) { button.disabled = false; return }
  button.textContent = 'Saved to Drafts'
  slot.replaceChildren(
    el('p', { class: 'toast', role: 'status' }, `Saved ${lines.length} item${lines.length === 1 ? '' : 's'} to one draft. Kivo is filing each under your subjects; change any below.`),
    ...lines,
    el('button', { class: 'primary ext', type: 'button', onclick: () => openNova(`/notes/drafts?d=${encodeURIComponent(draftId)}`) }, 'Review the draft in Kivo'))
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  if (!(await store.token())) {
    setStatus('disconnected', 'Not connected')
    return view.replaceChildren(el('div', { class: 'empty' }, el('h1', {}, 'Connect Kivo first'), el('p', {}, 'Open Kivo from the toolbar and connect it with a code from Kivo. Then start research from there.')))
  }
  const handoff = Number.isInteger(tabId) ? await browser.panelHandoff(tabId) : null
  page = handoff ? { ...describePage({ url: handoff.url, title: handoff.title }) } : null
  windowId = handoff?.windowId
  const state = await saved()
  if (!state) return renderSetup()
  if (['done', 'stopped', 'failed'].includes(state.status)) return renderResult(state, null)
  // The panel was closed mid-task: it waits to be resumed (website access may need asking again).
  if (state.status === 'running') state.status = 'paused'
  state.current = 'Paused when the panel closed. Resume to continue.'
  const granted = await chrome.permissions?.contains?.({ origins: ORIGINS }).catch(() => false)
  if (!granted) {
    view.replaceChildren(header(), el('div', { class: 'research' }, el('div', { class: 'research-body' },
      el('h1', {}, state.objective),
      el('p', { class: 'small' }, `Paused after ${state.steps.length} steps with ${state.findings.length} findings. Resuming asks for website access again.`),
      el('div', { class: 'run-controls' },
        el('button', { class: 'primary', type: 'button', onclick: () => { void chrome.permissions.request({ origins: ORIGINS }).then(ok => { if (ok) run(state, { resume: true }) }) } }, 'Resume'),
        el('button', { type: 'button', onclick: () => { state.status = 'stopped'; void persist(state).then(() => renderResult(state, null)) } }, 'See what it found'),
        el('button', { class: 'link', type: 'button', onclick: async () => { await forget(); renderSetup() } }, 'Start over')))))
    return
  }
  run(state, { resume: true })
}

void start()

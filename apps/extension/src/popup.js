// The popup: everything the extension does happens here, when the learner
// opens it. There is no background script and no content script, so the
// extension does nothing at all while the popup is closed.
//
// It asks the browser for the current tab's address and title (granted by
// the click that opened it, for this tab only), offers to save or study
// that page, and sends one small event when the learner presses a button.
// It decides nothing about the learner: no mastery, no plan, no pattern.

import { NOVA_URL } from './config.js'
import { buildEvent, createClient, newActionId } from './lib/api.js'
import { describePage } from './lib/page.js'
import { createStore } from './lib/store.js'

const store  = createStore(chrome.storage.local)
const client = createClient({ baseUrl: NOVA_URL, fetch: (...args) => fetch(...args), getToken: () => store.token() })
const view   = document.getElementById('view')
const status = document.getElementById('status')

// ── Small DOM helpers. Text is always set as text, never as markup. ───────────

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (value !== false && value !== null && value !== undefined) node[key] = value
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child)
  return node
}
function show(state, ...children) {
  view.dataset.state = state
  view.setAttribute('aria-busy', 'false')
  view.replaceChildren(...children.flat().filter(Boolean))
}
function setStatus(kind, text) { status.dataset.status = kind; status.textContent = text }
const alertBox = message => el('p', { class: 'alert', role: 'alert', dataset: { error: '' } }, message)
const openNova = path => { void chrome.tabs.create({ url: `${NOVA_URL}${path}` }); window.close() }

const privacy = () => el('details', { dataset: { privacy: '' } },
  el('summary', {}, 'What Nova can see'),
  el('ul', {},
    el('li', {}, 'The address and title of the page you are on, and only when you open this popup on it.'),
    el('li', {}, 'Nothing inside the page: no text, no forms, no passwords.'),
    el('li', {}, 'Not your other tabs, and not your history. Nova does nothing while this popup is closed.'),
    el('li', {}, 'It sends a page to Nova only when you press Save or Study.'),
  ),
  el('p', { class: 'small' }, 'Permissions: "activeTab" lets Nova read this tab\'s address and title when you click its icon. "storage" keeps this browser connected. It has no access to any website.'),
)

// ── Not connected ─────────────────────────────────────────────────────────────

function renderConnect(note) {
  setStatus('disconnected', 'Not connected')
  const code   = el('input', { class: 'code', id: 'code', placeholder: 'XXXXX-XXXXX', maxLength: 14, autocomplete: 'off', spellcheck: false, ariaLabel: 'Code from Nova' })
  const button = el('button', { class: 'primary wide', type: 'submit' }, 'Connect')
  const errors = el('div')
  const form   = el('form', {
    onsubmit: async event => {
      event.preventDefault()
      if (!code.value.trim()) return
      button.disabled = true; button.textContent = 'Connecting…'; errors.replaceChildren()
      const res = await client.connect(code.value, browserLabel())
      if (res.ok && typeof res.data.token === 'string') {
        await store.save(res.data.token)
        return start()
      }
      button.disabled = false; button.textContent = 'Connect'
      errors.replaceChildren(alertBox(res.ok ? "That didn't work. Try again in a moment." : res.message))
    },
  }, el('label', { htmlFor: 'code' }, 'Code from Nova'), code, el('div', { class: 'row' }, button), errors)

  show('connect',
    el('h1', {}, 'Connect Nova'),
    el('p', {}, 'Nova can then save what you are reading, or start a study session on it, when you ask.'),
    note ? el('p', { class: 'small', dataset: { note: '' } }, note) : null,
    el('button', { class: 'wide', type: 'button', dataset: { getCode: '' }, onclick: () => openNova('/saved?connect=1') }, 'Get a code from Nova'),
    form,
    privacy(),
  )
}

function browserLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  const brand = (navigator.userAgentData?.brands ?? []).map(b => b.brand).find(b => !/not.?a.?brand|chromium/i.test(b)) || 'Chrome'
  return platform ? `${brand} on ${platform}` : brand
}

// ── Connected ─────────────────────────────────────────────────────────────────

const NOT_READY = {
  not_nova:              ['This account uses a different companion', 'The browser extension is part of Nova, so there is nothing to save to here.'],
  not_connected:         ['Finish connecting Nova', 'Open Nova and finish connecting it. Then come back here.'],
  onboarding_incomplete: ['Nova needs to know what you are studying', 'Finish the short setup on Nova, and you can save pages under your subjects.'],
}

function footer() {
  return el('div', { class: 'foot' },
    el('button', { class: 'link', type: 'button', dataset: { openNova: '' }, onclick: () => openNova('/saved') }, 'Open Nova'),
    el('button', { class: 'link', type: 'button', dataset: { disconnect: '' }, onclick: disconnect }, 'Disconnect'),
  )
}

async function disconnect() {
  // Told to Nova so the credential stops working there; forgotten here either way.
  await client.disconnect()
  await store.clear()
  renderConnect('Disconnected. This browser can no longer save to Nova.')
}

function renderReady(page, context) {
  setStatus('connected', context.learner.name ? `Connected · ${context.learner.name.split(' ')[0]}` : 'Connected')

  if (!page.supported) {
    return show('unsupported',
      el('h1', {}, 'Nova is ready.'),
      el('p', { dataset: { unsupported: page.reason } }, page.reason === 'no_page'
        ? 'Open this on a page you want to save or study.'
        : "This isn't a web page Nova can save. Open it on an article, a video, a problem: anything with an ordinary address."),
      footer(), privacy())
  }

  // One id per kind of action. A retry after a lost answer repeats the id,
  // so Nova stores the action once. A new id is made after it succeeds.
  const ids = { resource_saved: newActionId(), study_requested: newActionId() }

  const title   = el('input', { id: 'title', value: page.title, maxLength: context.limits.title })
  const subject = el('select', { id: 'subject' },
    el('option', { value: '' }, context.subjects.length ? 'No subject' : 'No subjects in Nova yet'),
    context.subjects.map(s => el('option', { value: s.id }, s.name)))
  const topics  = el('datalist', { id: 'topics' })
  const topic   = el('input', { id: 'topic', placeholder: 'Optional', maxLength: context.limits.topic, disabled: true })
  topic.setAttribute('list', 'topics')
  subject.addEventListener('change', () => {
    const chosen = context.subjects.find(s => s.id === subject.value)
    topic.disabled = !chosen
    if (!chosen) topic.value = ''
    topics.replaceChildren(...(chosen?.topics ?? []).map(name => el('option', { value: name })))
  })

  const errors = el('div')
  const save   = el('button', { class: 'primary', type: 'button', dataset: { save: '' } }, 'Save to Nova')
  const running = context.activeSession
  const study  = running
    ? el('button', { type: 'button', dataset: { resume: '' }, onclick: () => openNova('/focus') }, 'Resume session')
    : el('button', { type: 'button', dataset: { study: '' } }, 'Study this')

  async function send(eventType, button, busy) {
    const label = button.textContent
    save.disabled = study.disabled = true; button.textContent = busy; errors.replaceChildren()
    const res = await client.sendEvent(buildEvent({ eventType, clientEventId: ids[eventType], page, title: title.value, subjectId: subject.value, topicName: topic.value }))
    save.disabled = study.disabled = false; button.textContent = label
    if (res.ok && res.data.success) { ids[eventType] = newActionId(); return res.data }
    if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); renderConnect(res.message); return null }
    errors.replaceChildren(alertBox(res.ok ? "That didn't work. Try again in a moment." : res.message))
    return null
  }

  save.addEventListener('click', async () => {
    const result = await send('resource_saved', save, 'Saving…')
    if (result) renderSaved(result, page, context)
  })
  if (!running) study.addEventListener('click', async () => {
    const result = await send('study_requested', study, 'Opening…')
    // Nova's Focus screen takes it from here: the session starts there, on the learner's say-so.
    if (result?.focusPath) openNova(result.focusPath)
  })

  show('ready',
    el('h1', {}, 'Nova is ready.'),
    el('div', { class: 'page', dataset: { page: page.url } },
      el('div', { class: 'domain', dataset: { domain: '' } }, page.domain),
      el('label', { htmlFor: 'title' }, 'Title'), title),
    el('label', { htmlFor: 'subject' }, 'Subject'), subject,
    el('label', { htmlFor: 'topic' }, 'Topic'), topic, topics,
    running ? el('p', { class: 'small', dataset: { running: '' } }, `You have a session running${running.topicName ? ` on ${running.topicName}` : ''}. One at a time.`) : null,
    el('div', { class: 'row' }, save, study),
    errors, footer(), privacy(),
  )
}

function renderSaved(result, page, context) {
  const filed = [result.resource.subjectName, result.resource.topicName].filter(Boolean).join(' · ')
  show('saved',
    el('p', { class: 'done', dataset: { done: result.action } }, result.action === 'already_saved' ? 'Already on your list.' : 'Saved.'),
    el('p', {}, result.action === 'already_saved'
      ? "Saving it twice doesn't count as studying it. Nova re-filed it for you."
      : 'Future-you can deal with it. It is on your Saved list in Nova.'),
    el('div', { class: 'page' }, el('div', {}, result.resource.title), el('div', { class: 'filed', dataset: { filed: '' } }, filed || 'Not filed under a subject')),
    el('div', { class: 'row' },
      el('button', { class: 'primary', type: 'button', dataset: { openSaved: '' }, onclick: () => openNova('/saved') }, 'Open Saved'),
      el('button', { type: 'button', dataset: { back: '' }, onclick: () => renderReady(page, context) }, 'Back')),
    footer(),
  )
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function currentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab ?? null
  } catch {
    return null
  }
}

async function start() {
  view.setAttribute('aria-busy', 'true')
  if (!(await store.token())) return renderConnect()

  setStatus('loading', '')
  show('loading', el('div', { class: 'skeleton', ariaLabel: 'Loading' }))
  view.setAttribute('aria-busy', 'true')
  const [tab, context] = await Promise.all([currentTab(), client.context()])

  if (!context.ok) {
    if (context.kind === 'unauthenticated') { await store.clear(); return renderConnect(context.message) }
    setStatus('error', '')
    return show('error', el('h1', {}, 'Nova is out of reach'), alertBox(context.message),
      el('div', { class: 'row' }, el('button', { class: 'primary', type: 'button', dataset: { retry: '' }, onclick: start }, 'Try again')), footer())
  }
  if (context.data.status !== 'ready') {
    setStatus('connected', 'Connected')
    const [heading, body] = NOT_READY[context.data.status] ?? NOT_READY.not_connected
    return show('blocked', el('h1', { dataset: { blocked: context.data.status } }, heading), el('p', {}, body), footer())
  }
  renderReady(describePage(tab), context.data)
}

void start()

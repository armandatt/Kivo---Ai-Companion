// The popup: everything the extension does happens here, when the learner
// opens it. There is no background script and no content script, so the
// extension does nothing at all while the popup is closed.
//
// It asks the browser for the current tab's address and title, and for the
// text selected on it (granted by the click that opened it, for this tab
// only). It offers to save the page, save the selected passage, or study the
// page, and sends one small event when the learner presses a button. The
// selection stays in this popup unless they press Save selection.
// It decides nothing about the learner: no mastery, no plan, no pattern.
//
// Every browser call goes through lib/browser.js.

import { NOVA_URL } from './config.js'
import { buildEvent, buildQuestion, createClient, disconnectOutcome, newActionId } from './lib/api.js'
import { NO_PROBE, browser } from './lib/browser.js'
import { describePage } from './lib/page.js'
import { createStore } from './lib/store.js'

const store  = createStore(browser.storage())
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
const openNova = path => { void browser.openTab(`${NOVA_URL}${path}`); window.close() }
// A button doing its work: says what it is doing, shows a small spinner (CSS)
// and is announced as busy. `idle` puts its own words back.
function busy(button, text) { button.dataset.label = button.textContent; button.textContent = text; button.setAttribute('aria-busy', 'true') }
function idle(button) { if (button.dataset.label) button.textContent = button.dataset.label; delete button.dataset.label; button.removeAttribute('aria-busy') }
const sr = (text, props = {}) => el('label', { class: 'sr', ...props }, text)

// What Nova can see: a quiet disclosure in the footer row; its text opens
// under the row. Returned as the button and the panel it shows.
function privacy() {
  const panel = el('div', { class: 'privacy', id: 'privacy', hidden: true, dataset: { privacy: '' } }, privacyText())
  const toggle = el('button', { class: 'link disclose', type: 'button', dataset: { privacyToggle: '' }, onclick: () => {
    const opening = panel.hidden
    panel.hidden = !opening
    toggle.setAttribute('aria-expanded', String(opening))
    if (opening) panel.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  } }, 'What Nova can see')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', 'privacy')
  return { toggle, panel }
}
const privacyText = () => [
  el('ul', {},
    el('li', {}, 'The address and title of the page you are on, and only when you open this popup on it.'),
    el('li', {}, 'The text you have selected on that page, shown here so you can save it. It is sent only if you press Save selection.'),
    el('li', {}, 'Nothing else inside the page: no other text, no forms, no passwords.'),
    el('li', {}, 'Not your other tabs, and not your history. Nova does nothing while this popup is closed.'),
    el('li', {}, 'It sends a page to Nova only when you press Save, Study or Ask. A question you ask is answered and not kept.'),
  ),
  el('p', { class: 'small' }, 'Permissions: "activeTab" lets Nova read this tab\'s address and title when you click its icon. "scripting" lets it read your selected text and the page\'s own address on that tab, at that moment. "storage" keeps this browser connected. It has no standing access to any website.'),
]

// ── Not connected ─────────────────────────────────────────────────────────────

function renderConnect(note, followUp) {
  setStatus('disconnected', 'Not connected')
  const code   = el('input', { class: 'code', id: 'code', placeholder: 'XXXXX-XXXXX', maxLength: 14, autocomplete: 'off', spellcheck: false })
  const button = el('button', { class: 'primary wide', type: 'submit', disabled: true, dataset: { connect: '' } }, 'Connect')
  const errors = el('div', { id: 'code-error' })
  code.setAttribute('aria-describedby', 'code-error')
  code.addEventListener('input', () => {
    button.disabled = !code.value.trim()
    if (errors.childElementCount) { errors.replaceChildren(); code.removeAttribute('aria-invalid') }
  })
  const form   = el('form', {
    class: 'stack',
    onsubmit: async event => {
      event.preventDefault()
      if (!code.value.trim() || button.getAttribute('aria-busy')) return
      button.disabled = true; busy(button, 'Connecting…'); errors.replaceChildren(); code.readOnly = true
      const res = await client.connect(code.value, browserLabel())
      if (res.ok && typeof res.data.token === 'string') {
        await store.save(res.data.token)
        return start('Connected. This browser can now save to Nova.')
      }
      idle(button); button.disabled = false; code.readOnly = false
      // The code stays as typed, so a mistyped character can be fixed.
      code.setAttribute('aria-invalid', 'true'); code.focus()
      errors.replaceChildren(alertBox(res.ok ? "That didn't work. Try again in a moment." : res.message))
    },
  },
  el('div', { class: 'field' }, el('label', { htmlFor: 'code' }, 'Code from Nova'), code, errors),
  button)

  show('connect',
    el('div', { class: 'stack' },
      el('div', {},
        el('h1', {}, 'Connect Nova'),
        el('p', { class: 'lede' }, 'Save what you are reading, or start a study session on it, when you ask.')),
      note ? el('p', { class: 'note', role: 'status', dataset: { note: '' } }, note) : null,
      followUp ? el('button', { class: 'link ext', type: 'button', dataset: { followUp: '' }, onclick: () => openNova(followUp.path) }, followUp.label) : null,
      el('div', { class: 'field' },
        el('span', { class: 'label' }, 'Step 1'),
        el('button', { class: 'wide ext', type: 'button', dataset: { getCode: '' }, onclick: () => openNova('/saved?connect=1') }, 'Get a code from Nova'),
        el('p', { class: 'small' }, 'Opens Nova in a new tab. The code works once, for ten minutes.')),
      el('div', { class: 'section' }, form),
      (() => { const { toggle, panel } = privacy(); return [el('div', { class: 'foot' }, toggle), panel] })(),
    ),
  )
  code.focus()
}

// What this browser is called in Nova's list of connected browsers. Chrome
// and its relatives describe themselves (userAgentData); Safari does not, so
// it is recognised by its user agent, which names Safari and no Chrome.
function browserLabel() {
  const hints  = navigator.userAgentData
  const agent  = navigator.userAgent || ''
  const safari = !hints && agent.includes('Safari/') && !agent.includes('Chrome/') && !agent.includes('Chromium/')
  const platform = hints?.platform || (safari && (navigator.platform || '').startsWith('Mac') ? 'macOS' : navigator.platform) || ''
  const brand = (hints?.brands ?? []).map(b => b.brand).find(b => !/not.?a.?brand|chromium/i.test(b)) || (safari ? 'Safari' : 'Chrome')
  return platform ? `${brand} on ${platform}` : brand
}

// ── Connected ─────────────────────────────────────────────────────────────────

const NOT_READY = {
  not_nova:              ['This account uses a different companion', 'The browser extension is part of Nova, so there is nothing to save to here.'],
  not_connected:         ['Finish connecting Nova', 'Open Nova and finish connecting it. Then come back here.'],
  onboarding_incomplete: ['Nova needs to know what you are studying', 'Finish the short setup on Nova, and you can save pages under your subjects.'],
}

// The quiet row at the bottom: Open Nova, what Nova can see, Disconnect.
function footer() {
  const { toggle, panel } = privacy()
  return [
    el('div', { class: 'foot' },
      el('button', { class: 'link ext', type: 'button', dataset: { openNova: '' }, onclick: () => openNova('/saved') }, 'Open Nova'),
      toggle,
      el('button', { class: 'link push', type: 'button', dataset: { disconnect: '' }, onclick: disconnect }, 'Disconnect')),
    panel,
  ]
}

async function disconnect() {
  // Told to Nova so the credential stops working there; forgotten here either
  // way. If Nova could not be told, the learner is: the connection is still
  // open there until they close it on Saved.
  const outcome = disconnectOutcome(await client.disconnect())
  await store.clear()
  renderConnect(outcome.message, outcome.confirmed ? null : { label: "Open Nova's Browser Extension page", path: '/saved' })
}

// The site's own name, not a subdomain's: en.wikipedia.org is W, docs.python.org
// is P, and bbc.co.uk is B (a short second level before a country code is skipped).
function siteInitial(domain) {
  const parts = domain.split('.')
  let at = Math.max(0, parts.length - 2)
  if (at > 0 && parts[parts.length - 1].length === 2 && parts[at].length <= 3) at--
  return parts[at].charAt(0)
}

const toastOf = flash => (flash ? el('p', { class: 'toast', role: 'status', dataset: { connected: '' } }, flash) : null)

function renderReady(page, context, probe = NO_PROBE, flash = null) {
  setStatus('connected', context.learner.name ? `Connected · ${context.learner.name.split(' ')[0]}` : 'Connected')

  if (!page.supported) {
    return show('unsupported',
      el('div', { class: 'stack' },
        toastOf(flash),
        el('div', {},
          el('h1', {}, 'Nova is ready.'),
          el('p', { class: 'lede', dataset: { unsupported: page.reason } }, page.reason === 'no_page'
            ? 'Open this on a page you want to save or study.'
            : "This isn't a web page Nova can save. Open it on an article, a video, a problem: anything with an ordinary address.")),
        footer()))
  }
  page = { ...page, canonicalUrl: probe.canonicalUrl }

  // One id per kind of action. A retry after a lost answer repeats the id,
  // so Nova stores the action once. A new id is made after it succeeds.
  const ids = { resource_saved: newActionId(), selection_saved: newActionId(), study_requested: newActionId() }

  const title   = el('input', { id: 'title', class: 'title-input', value: page.title, maxLength: context.limits.title, placeholder: 'Page title', title: 'Edit the title Nova saves' })
  const subject = el('select', { id: 'subject' },
    el('option', { value: '' }, context.subjects.length ? 'No subject' : 'No subjects in Nova yet'),
    context.subjects.map(s => el('option', { value: s.id }, s.name)))
  const topics  = el('datalist', { id: 'topics' })
  const topic   = el('input', { id: 'topic', placeholder: 'After a subject', maxLength: context.limits.topic, disabled: true, autocomplete: 'off' })
  topic.setAttribute('list', 'topics')
  subject.addEventListener('change', () => {
    const chosen = context.subjects.find(s => s.id === subject.value)
    topic.disabled = !chosen
    topic.placeholder = chosen ? 'Optional' : 'After a subject'
    if (!chosen) topic.value = ''
    topics.replaceChildren(...(chosen?.topics ?? []).map(name => el('option', { value: name })))
  })

  const errors = el('div', { class: 'errors' })
  const save   = el('button', { class: 'primary', type: 'button', dataset: { save: '' } }, 'Save to Nova')
  const running = context.activeSession
  const study  = running
    ? el('button', { type: 'button', dataset: { resume: '' }, onclick: () => openNova('/focus') }, 'Resume session')
    : el('button', { type: 'button', dataset: { study: '' } }, 'Study this')

  // The passage selected on the page when the popup opened, if there is one.
  const saveSelection = probe.selection
    ? el('button', { type: 'button', dataset: { saveSelection: '' } }, 'Save selection')
    : null
  const selectionHint = probe.selection ? null
    : el('p', { class: 'small hint', dataset: { selectionHint: probe.tooLong ? 'too_long' : probe.available ? 'none' : 'unavailable' } },
        probe.tooLong ? `That selection is longer than Nova keeps (${context.limits.excerpt.toLocaleString()} characters). Select less, then open Nova again.`
          : probe.available ? 'To save a passage, select it first, then open Nova.'
          : "Nova can't read a selection on this page. You can still save the page.")
  // Add to notes: opens Nova's capture page with the page and the selection
  // in the address's fragment (never sent to a server). The learner reviews
  // and saves it there, signed in as usual; this sends nothing itself.
  const toNotes = el('button', { class: probe.selection ? 'ext' : 'quiet ext', type: 'button', dataset: { toNotes: '' }, onclick: () => {
    const p = new URLSearchParams()
    p.set('url', page.url)
    p.set('title', title.value)
    if (probe.selection) p.set('text', probe.selection)
    p.set('via', 'extension')
    openNova(`/notes/capture#${p.toString()}`)
  } }, 'Add to notes')
  const buttons = () => [save, study, saveSelection].filter(Boolean)

  // While one action is on its way every action waits, so nothing is sent twice.
  async function send(eventType, button, words) {
    if (buttons().some(b => b.getAttribute('aria-busy'))) return null
    for (const b of buttons()) b.disabled = true
    busy(button, words); errors.replaceChildren()
    const res = await client.sendEvent(buildEvent({ eventType, clientEventId: ids[eventType], page, title: title.value, subjectId: subject.value, topicName: topic.value, excerpt: probe.selection }))
    for (const b of buttons()) b.disabled = false
    idle(button)
    if (res.ok && res.data.success) { ids[eventType] = newActionId(); return res.data }
    if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); renderConnect(res.message); return null }
    errors.replaceChildren(alertBox(res.ok ? "That didn't work. Try again in a moment." : res.message))
    return null
  }

  save.addEventListener('click', async () => {
    const result = await send('resource_saved', save, 'Saving…')
    if (result) renderSaved(result, page, context, probe)
  })
  if (saveSelection) saveSelection.addEventListener('click', async () => {
    const result = await send('selection_saved', saveSelection, 'Saving…')
    if (result) renderSaved(result, page, context, probe)
  })
  if (!running) study.addEventListener('click', async () => {
    const result = await send('study_requested', study, 'Opening…')
    // Nova's Focus screen takes it from here: the session starts there, on the learner's say-so.
    if (result?.focusPath) openNova(result.focusPath)
  })

  // Ask Nova about this page. Nova gets the title, the address and the
  // selection, never the page; the answer is shown here and kept nowhere.
  // Enter asks, Shift+Enter starts a new line. A failed question stays in
  // the box; it is cleared only once Nova has answered it.
  const question  = el('textarea', { id: 'question', rows: 2, placeholder: 'What do you want to know?', maxLength: 500, autocomplete: 'off' })
  const askButton = el('button', { class: 'primary', type: 'submit', disabled: true, dataset: { askSubmit: '' } }, 'Ask')
  const thread    = el('div', { class: 'thread', dataset: { answer: '' } })
  thread.setAttribute('aria-live', 'polite')
  const fit = () => { question.style.height = 'auto'; question.style.height = `${Math.min(question.scrollHeight + 2, 140)}px` }
  question.addEventListener('input', () => { askButton.disabled = !question.value.trim() || askButton.getAttribute('aria-busy') === 'true'; fit() })
  question.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    if (!askButton.disabled) question.form.requestSubmit()
  })
  const sent = probe.selection ? ['Title', 'Address', 'Your selection'] : ['Title', 'Address']
  const ask = el('section', { class: 'section', dataset: { ask: '' }, ariaLabel: 'Ask Nova about this page' },
    el('h2', {}, 'Ask Nova'),
    el('p', { class: 'small lede' }, probe.selection
      ? 'Nova gets the page title, its address and your selection. Not the rest of the page.'
      : 'Nova gets the page title and its address. Select text first if your question is about a particular part.'),
    el('form', {
      onsubmit: async event => {
        event.preventDefault()
        if (!question.value.trim()) return
        if (askButton.getAttribute('aria-busy')) return
        const asked = question.value.trim()
        askButton.disabled = true; busy(askButton, 'Asking'); question.readOnly = true
        thread.replaceChildren(el('p', { class: 'asked' }, 'You asked ', el('strong', {}, asked)), el('p', { class: 'thinking', role: 'status' }, 'Nova is thinking…'))
        const res = await client.ask(buildQuestion({ question: question.value, page, title: title.value, excerpt: probe.selection }))
        idle(askButton); question.readOnly = false; askButton.disabled = false
        if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); return renderConnect(res.message) }
        if (!res.ok || typeof res.data.answer !== 'string') { question.focus(); return thread.replaceChildren(alertBox(res.ok ? "That didn't work. Try again in a moment." : res.message)) }
        question.value = ''; fit(); askButton.disabled = true
        thread.replaceChildren(
          el('p', { class: 'asked' }, 'You asked ', el('strong', {}, asked)),
          el('p', { class: 'answer', dataset: { basis: res.data.basis } }, res.data.answer),
          el('p', { class: 'small' }, res.data.basis === 'selection'
            ? 'Answered from your selection and what Nova knows of the subject. Nova has not read the rest of the page.'
            : 'Nova has not read this page: it saw only the title. Select the part you mean and ask again for an answer about it.'))
      },
    },
    el('div', { class: 'ask-box' },
      sr('Your question about this page', { htmlFor: 'question' }),
      question,
      el('div', { class: 'ask-bar' },
        el('span', { class: 'context', ariaLabel: `Sent with your question: ${sent.join(', ')}` },
          sent.map(s => el('span', { class: s === 'Your selection' ? 'chip on' : 'chip', ariaHidden: 'true' }, s))),
        askButton))),
    thread)

  show('ready',
    el('div', { class: 'stack' },
      toastOf(flash),
      el('section', { class: 'page', dataset: { page: page.url }, ariaLabel: 'This page' },
        el('span', { class: 'site', ariaHidden: 'true' }, siteInitial(page.domain)),
        el('div', { class: 'field tight' },
          el('div', { class: 'domain', dataset: { domain: '' }, title: page.domain }, page.domain),
          sr('Title', { htmlFor: 'title' }), title)),
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { htmlFor: 'subject' }, 'Subject'), subject),
        el('div', { class: 'field' }, el('label', { htmlFor: 'topic' }, 'Topic'), topic, topics)),
      el('div', {},
        running ? el('p', { class: 'small', dataset: { running: '' }, style: 'margin-bottom: 8px' }, `You have a session running${running.topicName ? ` on ${running.topicName}` : ''}. One at a time.`) : null,
        el('div', { class: 'actions' }, save, study),
        probe.selection ? null : el('div', { class: 'hint-row' }, selectionHint, toNotes),
        errors),
      probe.selection
        ? el('section', { class: 'section', dataset: { selection: '' }, ariaLabel: 'Your selection' },
            el('div', { class: 'head-row' }, el('h2', {}, 'Your selection'), el('span', { class: 'small' }, `${probe.selection.length.toLocaleString()} characters`)),
            el('blockquote', { class: 'quote', tabIndex: 0, ariaLabel: 'Selected text' }, probe.selection),
            el('div', { class: 'actions' }, saveSelection, toNotes))
        : null,
      ask,
      footer()),
  )
}

function renderSaved(result, page, context, probe) {
  const filed   = [result.resource.subjectName, result.resource.topicName].filter(Boolean).join(' · ')
  const passage = result.resource.eventType === 'selection_saved'
  const already = result.action === 'already_saved'
  show('saved',
    el('div', { class: 'stack' },
      el('div', { class: 'page' },
        el('span', { class: 'done-mark', ariaHidden: 'true' }),
        el('div', {},
          el('h1', { class: 'done', role: 'status', dataset: { done: result.action, kind: passage ? 'passage' : 'page' } },
            already ? (passage ? 'That passage is already saved.' : 'Already on your list.') : (passage ? 'Passage saved.' : 'Saved.')),
          el('p', { class: 'lede' }, already
            ? "Saving it twice doesn't count as studying it. Nova re-filed it for you."
            : passage ? 'It is on your Saved list in Nova, with the page it came from.' : 'Future-you can deal with it. It is on your Saved list in Nova.'))),
      el('div', { class: 'note' },
        el('div', { style: 'color: var(--text); font-weight: 500' }, result.resource.title),
        el('div', { class: 'small', dataset: { filed: '' } }, filed || 'Not filed under a subject')),
      !already && !filed ? el('p', { class: 'small', dataset: { looking: '' } }, 'Nova will look at which of your topics it belongs under. You will see that on Saved.') : null,
      el('div', { class: 'actions' },
        el('button', { class: 'primary ext', type: 'button', dataset: { openSaved: '' }, onclick: () => openNova('/saved') }, 'Open saved pages'),
        el('button', { type: 'button', dataset: { back: '' }, onclick: () => renderReady(page, context, probe) }, 'Back')),
      footer()),
  )
}

const skeleton = () => el('div', { class: 'skeleton', role: 'status', ariaLabel: 'Loading' },
  el('div', { class: 'row' }, el('i', { class: 'sq' }), el('div', {}, el('i', { style: 'width: 40%' }), el('i', { style: 'width: 85%; margin-top: 8px' }))),
  el('div', { class: 'fields' }, el('i', { class: 'box' }), el('i', { class: 'box' })),
  el('div', { class: 'actions' }, el('i', { class: 'box' }), el('i', { class: 'box' })),
  el('i', { class: 'box', style: 'height: 96px' }))

// ── Start ─────────────────────────────────────────────────────────────────────

async function start(flash = null) {
  view.setAttribute('aria-busy', 'true')
  if (!(await store.token())) return renderConnect()

  setStatus('loading', 'Checking…')
  show('loading', skeleton())
  view.setAttribute('aria-busy', 'true')
  const [tab, context] = await Promise.all([browser.activeTab(), client.context()])

  if (!context.ok) {
    if (context.kind === 'unauthenticated') { await store.clear(); return renderConnect(context.message) }
    setStatus('error', 'Offline')
    return show('error', el('div', { class: 'stack' },
      el('h1', {}, 'Nova is out of reach'), alertBox(context.message),
      el('button', { class: 'primary wide', type: 'button', dataset: { retry: '' }, onclick: () => start() }, 'Try again'), footer()))
  }
  if (context.data.status !== 'ready') {
    setStatus('connected', 'Connected')
    const [heading, body] = NOT_READY[context.data.status] ?? NOT_READY.not_connected
    return show('blocked', el('div', { class: 'stack' },
      toastOf(flash),
      el('div', {}, el('h1', { dataset: { blocked: context.data.status } }, heading), el('p', { class: 'lede' }, body)),
      footer()))
  }
  // The selection is read only now that there is a connected learner to
  // offer it to, and only on a page Nova can save.
  const page  = describePage(tab)
  const limit = typeof context.data.limits?.excerpt === 'number' ? context.data.limits.excerpt : 2000
  const probe = page.supported ? await browser.readPage(tab?.id, limit) : NO_PROBE
  renderReady(page, { ...context.data, limits: { ...context.data.limits, excerpt: limit } }, probe, flash)
}

void start()

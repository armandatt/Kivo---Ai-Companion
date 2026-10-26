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

const privacy = () => el('details', { dataset: { privacy: '' } },
  el('summary', {}, 'What Nova can see'),
  el('ul', {},
    el('li', {}, 'The address and title of the page you are on, and only when you open this popup on it.'),
    el('li', {}, 'The text you have selected on that page, shown here so you can save it. It is sent only if you press Save selection.'),
    el('li', {}, 'Nothing else inside the page: no other text, no forms, no passwords.'),
    el('li', {}, 'Not your other tabs, and not your history. Nova does nothing while this popup is closed.'),
    el('li', {}, 'It sends a page to Nova only when you press Save, Study or Ask. A question you ask is answered and not kept.'),
  ),
  el('p', { class: 'small' }, 'Permissions: "activeTab" lets Nova read this tab\'s address and title when you click its icon. "scripting" lets it read your selected text and the page\'s own address on that tab, at that moment. "storage" keeps this browser connected. It has no standing access to any website.'),
)

// ── Not connected ─────────────────────────────────────────────────────────────

function renderConnect(note, followUp) {
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
    note ? el('p', { class: 'small', role: 'status', dataset: { note: '' } }, note) : null,
    followUp ? el('button', { class: 'link', type: 'button', dataset: { followUp: '' }, onclick: () => openNova(followUp.path) }, followUp.label) : null,
    el('button', { class: 'wide', type: 'button', dataset: { getCode: '' }, onclick: () => openNova('/saved?connect=1') }, 'Get a code from Nova'),
    form,
    privacy(),
  )
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

function footer() {
  return el('div', { class: 'foot' },
    el('button', { class: 'link', type: 'button', dataset: { openNova: '' }, onclick: () => openNova('/saved') }, 'Open Nova'),
    el('button', { class: 'link', type: 'button', dataset: { disconnect: '' }, onclick: disconnect }, 'Disconnect'),
  )
}

async function disconnect() {
  // Told to Nova so the credential stops working there; forgotten here either
  // way. If Nova could not be told, the learner is: the connection is still
  // open there until they close it on Saved.
  const outcome = disconnectOutcome(await client.disconnect())
  await store.clear()
  renderConnect(outcome.message, outcome.confirmed ? null : { label: "Open Nova's Saved page", path: '/saved' })
}

function renderReady(page, context, probe = NO_PROBE) {
  setStatus('connected', context.learner.name ? `Connected · ${context.learner.name.split(' ')[0]}` : 'Connected')

  if (!page.supported) {
    return show('unsupported',
      el('h1', {}, 'Nova is ready.'),
      el('p', { dataset: { unsupported: page.reason } }, page.reason === 'no_page'
        ? 'Open this on a page you want to save or study.'
        : "This isn't a web page Nova can save. Open it on an article, a video, a problem: anything with an ordinary address."),
      footer(), privacy())
  }
  page = { ...page, canonicalUrl: probe.canonicalUrl }

  // One id per kind of action. A retry after a lost answer repeats the id,
  // so Nova stores the action once. A new id is made after it succeeds.
  const ids = { resource_saved: newActionId(), selection_saved: newActionId(), study_requested: newActionId() }

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

  // The passage selected on the page when the popup opened, if there is one.
  const saveSelection = probe.selection
    ? el('button', { class: 'wide', type: 'button', dataset: { saveSelection: '' } }, 'Save selection')
    : null
  const selection = probe.selection
    ? el('div', { class: 'selection', dataset: { selection: '' } },
        el('div', { class: 'label' }, `Your selection · ${probe.selection.length.toLocaleString()} characters`),
        el('blockquote', { tabIndex: 0, ariaLabel: 'Selected text' }, probe.selection),
        saveSelection)
    : el('p', { class: 'small', dataset: { selectionHint: probe.tooLong ? 'too_long' : probe.available ? 'none' : 'unavailable' } },
        probe.tooLong ? `That selection is longer than Nova keeps (${context.limits.excerpt.toLocaleString()} characters). Select less, then open Nova again.`
          : probe.available ? 'To save a passage, select it on the page, then open Nova.'
          : "Nova can't read a selection on this page. You can still save the page.")
  // Add to notes: opens Nova's capture page with the page and the selection
  // in the address's fragment (never sent to a server). The learner reviews
  // and saves it there, signed in as usual; this sends nothing itself.
  const toNotes = el('button', { class: 'wide', type: 'button', dataset: { toNotes: '' }, onclick: () => {
    const p = new URLSearchParams()
    p.set('url', page.url)
    p.set('title', title.value)
    if (probe.selection) p.set('text', probe.selection)
    p.set('via', 'extension')
    openNova(`/notes/capture#${p.toString()}`)
  } }, probe.selection ? 'Add selection to notes' : 'Add to notes')
  const buttons = () => [save, study, saveSelection].filter(Boolean)

  async function send(eventType, button, busy) {
    const label = button.textContent
    for (const b of buttons()) b.disabled = true
    button.textContent = busy; errors.replaceChildren()
    const res = await client.sendEvent(buildEvent({ eventType, clientEventId: ids[eventType], page, title: title.value, subjectId: subject.value, topicName: topic.value, excerpt: probe.selection }))
    for (const b of buttons()) b.disabled = false
    button.textContent = label
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
  const question = el('input', { id: 'question', placeholder: 'What do you want to know?', maxLength: 500, autocomplete: 'off', ariaLabel: 'Your question about this page' })
  const askButton = el('button', { type: 'submit' }, 'Ask')
  const answer   = el('div', { dataset: { answer: '' } })
  answer.setAttribute('aria-live', 'polite')
  const ask = el('details', { class: 'ask', dataset: { ask: '' } },
    el('summary', {}, 'Ask Nova about this page'),
    el('form', {
      onsubmit: async event => {
        event.preventDefault()
        if (!question.value.trim()) return
        askButton.disabled = true; askButton.textContent = 'Asking…'
        answer.replaceChildren()
        const res = await client.ask(buildQuestion({ question: question.value, page, title: title.value, excerpt: probe.selection }))
        askButton.disabled = false; askButton.textContent = 'Ask'
        if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); return renderConnect(res.message) }
        if (!res.ok || typeof res.data.answer !== 'string') return answer.replaceChildren(alertBox(res.ok ? "That didn't work. Try again in a moment." : res.message))
        answer.replaceChildren(
          el('p', { class: 'answer', dataset: { basis: res.data.basis } }, res.data.answer),
          el('p', { class: 'small' }, res.data.basis === 'selection'
            ? 'Answered from your selection and what Nova knows of the subject. Nova has not read the rest of the page.'
            : 'Nova has not read this page: it saw only the title. Select the part you mean and ask again for an answer about it.'))
      },
    }, el('div', { class: 'askrow' }, question, askButton)),
    el('p', { class: 'small' }, probe.selection
      ? 'Nova gets the page title, its address and your selection. Not the rest of the page.'
      : 'Nova gets the page title and its address. Select text first if your question is about a particular part.'),
    answer)

  show('ready',
    el('h1', {}, 'Nova is ready.'),
    el('div', { class: 'page', dataset: { page: page.url } },
      el('div', { class: 'domain', dataset: { domain: '' } }, page.domain),
      el('label', { htmlFor: 'title' }, 'Title'), title),
    el('label', { htmlFor: 'subject' }, 'Subject'), subject,
    el('label', { htmlFor: 'topic' }, 'Topic'), topic, topics,
    running ? el('p', { class: 'small', dataset: { running: '' } }, `You have a session running${running.topicName ? ` on ${running.topicName}` : ''}. One at a time.`) : null,
    el('div', { class: 'row' }, save, study),
    selection,
    toNotes,
    errors, ask, footer(), privacy(),
  )
}

function renderSaved(result, page, context, probe) {
  const filed   = [result.resource.subjectName, result.resource.topicName].filter(Boolean).join(' · ')
  const passage = result.resource.eventType === 'selection_saved'
  const already = result.action === 'already_saved'
  show('saved',
    el('p', { class: 'done', dataset: { done: result.action, kind: passage ? 'passage' : 'page' } },
      already ? (passage ? 'That passage is already saved.' : 'Already on your list.') : (passage ? 'Passage saved.' : 'Saved.')),
    el('p', {}, already
      ? "Saving it twice doesn't count as studying it. Nova re-filed it for you."
      : passage ? 'It is on your Saved list in Nova, with the page it came from.' : 'Future-you can deal with it. It is on your Saved list in Nova.'),
    !already && !filed ? el('p', { class: 'small', dataset: { looking: '' } }, 'Nova will look at which of your topics it belongs under. You will see that on Saved.') : null,
    el('div', { class: 'page' }, el('div', {}, result.resource.title), el('div', { class: 'filed', dataset: { filed: '' } }, filed || 'Not filed under a subject')),
    el('div', { class: 'row' },
      el('button', { class: 'primary', type: 'button', dataset: { openSaved: '' }, onclick: () => openNova('/saved') }, 'Open Saved'),
      el('button', { type: 'button', dataset: { back: '' }, onclick: () => renderReady(page, context, probe) }, 'Back')),
    footer(),
  )
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  view.setAttribute('aria-busy', 'true')
  if (!(await store.token())) return renderConnect()

  setStatus('loading', '')
  show('loading', el('div', { class: 'skeleton', ariaLabel: 'Loading' }))
  view.setAttribute('aria-busy', 'true')
  const [tab, context] = await Promise.all([browser.activeTab(), client.context()])

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
  // The selection is read only now that there is a connected learner to
  // offer it to, and only on a page Nova can save.
  const page  = describePage(tab)
  const limit = typeof context.data.limits?.excerpt === 'number' ? context.data.limits.excerpt : 2000
  const probe = page.supported ? await browser.readPage(tab?.id, limit) : NO_PROBE
  renderReady(page, { ...context.data, limits: { ...context.data.limits, excerpt: limit } }, probe)
}

void start()

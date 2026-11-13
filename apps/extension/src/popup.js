// The popup: what the extension does when the learner clicks it. There is no
// content script. Two things, each one press:
//   Capture   the selected passage goes into the learner's current draft in
//             Kivo (one per reading session, each passage with its page), with
//             nothing to choose: organising happens later, in Kivo's Drafts.
//   Ask Nova  opens Nova's side panel beside the page (sidepanel.js), where the
//             conversation has room; Safari, with no side panel, opens it here.
// Save page (Saved pages) and Study this (a focus session) stay as they were.
//
// It asks the browser for the current tab's address and title, and for the
// text selected on it (granted by the click that opened it, for this tab
// only). The selection stays here unless they press Capture or Ask Nova.
// It decides nothing about the learner: no mastery, no plan, no pattern.
//
// Every browser call goes through lib/browser.js.

import { NOVA_URL } from './config.js'
import { buildCapture, buildEvent, createClient, disconnectOutcome, newActionId } from './lib/api.js'
import { NO_PROBE, browser } from './lib/browser.js'
import { describePage } from './lib/page.js'
import { createStore } from './lib/store.js'
import { alertBox, busy, el, idle, siteInitial } from './lib/ui.js'

const store  = createStore(browser.storage())
const client = createClient({ baseUrl: NOVA_URL, fetch: (...args) => fetch(...args), getToken: () => store.token() })
const view   = document.getElementById('view')
const status = document.getElementById('status')
// The window of the tab the popup was opened on.
let tabWindowId

function show(state, ...children) {
  view.dataset.state = state
  view.setAttribute('aria-busy', 'false')
  view.replaceChildren(...children.flat().filter(Boolean))
}
function setStatus(kind, text) { status.dataset.status = kind; status.textContent = text }
const openNova = path => { void browser.openTab(`${NOVA_URL}${path}`); window.close() }

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
    el('li', {}, 'The text you have selected on that page, shown here so you can capture it. It is sent only if you press Capture, or with a question you ask.'),
    el('li', {}, 'A passage you capture goes to your Drafts in Kivo with the page it came from, until you put it in a note or discard it.'),
    el('li', {}, 'A screenshot of what that tab is showing, only when you press Screenshot or capture an area you selected. You see it here first. It goes to Nova only with a question you ask, and is not kept.'),
    el('li', {}, 'Your conversation with Nova about a page stays in this browser\'s memory until you start a new one or close the browser. Nova\'s server does not keep it.'),
    el('li', {}, 'Nothing else inside the page: no other text, no forms, no passwords.'),
    el('li', {}, 'Not your other tabs, and not your history. Nova does nothing while this popup and its panel are closed, except take the picture of an area you selected.'),
    el('li', {}, 'It sends a page to Nova only when you press Capture, Save, Study or Ask.'),
  ),
  el('p', { class: 'small' }, 'Permissions: "activeTab" lets Nova read this tab\'s address and title when you click its icon, and take a screenshot of it when you press Screenshot. "scripting" lets it read your selected text and the page\'s own address on that tab, at that moment. "sidePanel" lets Ask Nova open beside the page. "storage" keeps this browser connected, and your open conversation in memory. It has no standing access to any website.'),
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
        el('p', { class: 'lede' }, 'Save what you read to Kivo, and study it there.')),
      note ? el('p', { class: 'note', role: 'status', dataset: { note: '' } }, note) : null,
      followUp ? el('button', { class: 'link ext', type: 'button', dataset: { followUp: '' }, onclick: () => openNova(followUp.path) }, followUp.label) : null,
      el('div', { class: 'field' },
        el('span', { class: 'label' }, 'Step 1'),
        el('button', { class: 'wide ext', type: 'button', dataset: { getCode: '' }, onclick: () => openNova('/saved?connect=1') }, 'Get a code from Nova'),
        el('p', { class: 'small' }, 'Opens Kivo. The code works once, for ten minutes.')),
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

const toastOf = flash => (flash ? el('p', { class: 'toast', role: 'status', dataset: { connected: '' } }, flash) : null)

// How the current draft stands, in words: "3 passages from 2 pages".
const draftWords = d => `${d.passages} passage${d.passages === 1 ? '' : 's'}${d.sources ? ` from ${d.sources} page${d.sources === 1 ? '' : 's'}` : ''}`

function renderReady(page, context, probe = NO_PROBE, flash = null, draft = null) {
  setStatus('connected', context.learner.name ? `Connected · ${context.learner.name.split(' ')[0]}` : 'Connected')

  if (!page.supported) {
    return show('unsupported',
      el('div', { class: 'stack' },
        toastOf(flash),
        el('div', {},
          el('h1', {}, 'Nova is ready.'),
          el('p', { class: 'lede', dataset: { unsupported: page.reason } }, page.reason === 'no_page'
            ? 'Open this on a page you want to capture from or ask about.'
            : "This isn't a web page Nova can read. Open it on an article, a video, a problem: anything with an ordinary address.")),
        footer()))
  }
  page = { ...page, canonicalUrl: probe.canonicalUrl, meta: probe.meta }

  // One id per kind of action. A retry after a lost answer repeats the id,
  // so Nova stores the action once. A new id is made after it succeeds.
  const ids = { capture: newActionId(), resource_saved: newActionId(), study_requested: newActionId() }
  let fresh = false

  const title   = el('input', { id: 'title', class: 'title-input', value: page.title, maxLength: context.limits.title, placeholder: 'Page title', title: 'Edit the title Nova keeps' })
  const errors  = el('div', { class: 'errors' })
  const running = context.activeSession

  // Capture: the selection into the current draft, at once.
  const capture = el('button', { class: 'primary wide', type: 'button', disabled: !probe.selection, dataset: { capture: '' } }, probe.selection ? 'Capture selection' : 'Capture')
  const save  = el('button', { type: 'button', dataset: { save: '' }, title: 'Keep the page in Saved pages, to read later' }, 'Save page')
  const study = running
    ? el('button', { type: 'button', dataset: { resume: '' }, onclick: () => openNova('/focus') }, 'Resume session')
    : el('button', { type: 'button', dataset: { study: '' }, title: 'Start a focus session on this page in Kivo' }, 'Study this')
  const buttons = () => [capture, save, study]

  const draftLine = el('div', { class: 'draft-line', dataset: { draft: draft?.current ? 'current' : 'none' } })
  function showDraft(current) {
    draftLine.dataset.draft = current ? 'current' : 'none'
    draftLine.replaceChildren(
      el('p', { class: 'small', role: 'status', dataset: { draftCounts: '' } }, current
        ? `Draft: ${draftWords(current)}`
        : fresh ? 'Your next capture starts a new draft.' : 'Captures from this sitting collect in one draft.'),
      el('div', { class: 'draft-tools' },
        current && !fresh ? el('button', { class: 'link', type: 'button', dataset: { newDraft: '' }, title: 'Your next capture starts a new draft', onclick: () => { fresh = true; showDraft(null) } }, 'New draft') : null,
        el('button', { class: 'link ext', type: 'button', dataset: { openDrafts: '' }, onclick: () => openNova(current ? `/notes/drafts?d=${encodeURIComponent(current.id)}` : '/notes/drafts') }, 'Review in Kivo')))
  }
  showDraft(draft?.current ?? null)

  // While one action is on its way every action waits, so nothing is sent twice.
  async function send(button, words, request) {
    if (buttons().some(b => b.getAttribute('aria-busy'))) return null
    for (const b of buttons()) b.disabled = true
    busy(button, words); errors.replaceChildren()
    const res = await request()
    for (const b of buttons()) b.disabled = false
    if (!probe.selection) capture.disabled = true
    idle(button)
    if (res.ok && res.data.success) return res.data
    if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); renderConnect(res.message); return null }
    errors.replaceChildren(alertBox(res.ok ? (res.data?.message ?? "That didn't work. Try again in a moment.") : res.message))
    return null
  }

  capture.addEventListener('click', async () => {
    const result = await send(capture, 'Capturing…', () => client.capture(buildCapture({ key: ids.capture, page, title: title.value, text: probe.selection, fresh })))
    if (!result) return
    ids.capture = newActionId(); fresh = false
    showDraft(result.draft)
    capture.textContent = result.action === 'already_in_draft' ? 'Already in this draft' : 'Captured'
    capture.disabled = true
    capture.dataset.captured = result.action
  })
  save.addEventListener('click', async () => {
    const result = await send(save, 'Saving…', () => client.sendEvent(buildEvent({ eventType: 'resource_saved', clientEventId: ids.resource_saved, page, title: title.value })))
    if (result) renderSaved(result, page, context, probe)
  })
  if (!running) study.addEventListener('click', async () => {
    const result = await send(study, 'Opening…', () => client.sendEvent(buildEvent({ eventType: 'study_requested', clientEventId: ids.study_requested, page, title: title.value })))
    // Nova's Focus screen takes it from here: the session starts there, on the learner's say-so.
    if (result?.focusPath) openNova(result.focusPath)
  })

  // Ask Nova: the conversation opens beside the page, with this page and the
  // selection handed to it. Opened straight from this click, as the browser asks.
  const ask = el('button', { class: 'ask-open wide', type: 'button', dataset: { askOpen: '' } }, 'Ask Nova about this page')
  ask.addEventListener('click', async () => {
    const handoff = { url: page.url, title: title.value.trim() || page.title, selection: probe.selection || '', windowId: tabWindowId, name: context.learner.name ? context.learner.name.split(' ')[0] : null }
    const opened = browser.openPanel(page.tabId, handoff)
    if (opened && await opened) return window.close()
    // No side panel here (Safari): the same conversation, in this popup.
    const inline = await browser.handOffInline(page.tabId, handoff)
    if (inline) location.href = inline
    else errors.replaceChildren(alertBox("Nova couldn't open here. Try again."))
  })

  show('ready',
    el('div', { class: 'stack' },
      toastOf(flash),
      el('section', { class: 'page', dataset: { page: page.url }, ariaLabel: 'This page' },
        el('span', { class: 'site', ariaHidden: 'true' }, siteInitial(page.domain)),
        el('div', { class: 'field tight' },
          el('div', { class: 'domain', dataset: { domain: '' }, title: page.domain }, page.domain),
          el('label', { class: 'sr', htmlFor: 'title' }, 'Title'), title)),
      el('section', { class: 'capture', ariaLabel: 'Capture' },
        probe.selection
          ? el('blockquote', { class: 'quote', tabIndex: 0, ariaLabel: 'Selected text', dataset: { selection: '' } }, probe.selection)
          : el('p', { class: 'small hint', dataset: { selectionHint: probe.tooLong ? 'too_long' : probe.available ? 'none' : 'unavailable' } },
              probe.tooLong ? `That selection is longer than Nova keeps (${context.limits.excerpt.toLocaleString()} characters). Select less, then open Nova again.`
                : probe.available ? 'Select text on the page to capture it.'
                : "Nova can't read a selection on this page. You can still save it or ask about it."),
        capture,
        draftLine),
      el('div', {},
        running ? el('p', { class: 'small', dataset: { running: '' }, style: 'margin-bottom: 8px' }, `You have a session running${running.topicName ? ` on ${running.topicName}` : ''}. One at a time.`) : null,
        el('div', { class: 'actions even' }, save, study),
        errors),
      el('section', { class: 'section', dataset: { ask: '' }, ariaLabel: 'Ask Nova' }, ask),
      footer()),
  )
  if (probe.selection) capture.focus()
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
            : 'It is in Saved pages in Kivo.'))),
      el('div', { class: 'note' },
        el('div', { style: 'color: var(--text); font-weight: 500' }, result.resource.title),
        el('div', { class: 'small', dataset: { filed: '' } }, filed || 'Not filed under a subject')),
      !already && !filed ? el('p', { class: 'small', dataset: { looking: '' } }, 'Nova will suggest the topic it belongs under.') : null,
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
  tabWindowId = tab?.windowId

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
  // offer it to, and only on a page Nova can read.
  const page  = describePage(tab)
  const limit = typeof context.data.limits?.excerpt === 'number' ? context.data.limits.excerpt : 4000
  const [probe, drafts] = page.supported
    ? await Promise.all([browser.readPage(tab?.id, limit), client.drafts()])
    : [NO_PROBE, null]
  renderReady({ ...page, tabId: tab?.id }, { ...context.data, limits: { ...context.data.limits, excerpt: limit } }, probe, flash, drafts?.ok ? drafts.data : null)
}

void start()

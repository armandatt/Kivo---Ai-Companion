// Nova's side panel: a conversation about the page the learner is reading.
// Opened from the popup's Ask Nova, for that tab only (lib/browser.js
// openPanel); in a browser with no side panel (Safari) the same page opens
// inside the popup instead.
//
// What Nova gets with each question: the page's title and address, the
// selected passage if the learner keeps it attached, a screenshot only if they
// took one, and the conversation so far (the latest turns, lib/thread.js),
// so a follow-up ("explain the second point") has what came before. Nova's
// server stores none of it; the conversation is kept in the browser's memory
// (chrome.storage.session) until New conversation or the browser quits.
// Answers are short by default; More detail asks again for a fuller one.
// Answers are drawn from Markdown and LaTeX (lib/markdown.js, KaTeX).

import { NOVA_URL } from './config.js'
import { buildCapture, buildQuestion, createClient, newActionId } from './lib/api.js'
import { browser } from './lib/browser.js'
import { describePage } from './lib/page.js'
import { parse, render } from './lib/markdown.js'
import { createStore } from './lib/store.js'
import { LOCK_DAYS, createThreads, historyOf } from './lib/thread.js'
import { alertBox, busy, clamp, el, encodeShot, idle, loadPicture, markBetween, placeMark, siteInitial, sr } from './lib/ui.js'

const store   = createStore(browser.storage())
// In memory by default; on this device only when the learner locks a conversation (Keep).
const threads = createThreads(browser.session(), browser.storage())
const client  = createClient({ baseUrl: NOVA_URL, fetch: (...args) => fetch(...args), getToken: () => store.token() })
const params  = new URLSearchParams(location.search)
const tabId   = Number(params.get('tab'))
const inline  = params.get('inline') === '1'
if (inline) document.documentElement.dataset.inline = ''

const view   = document.getElementById('view')
const status = document.getElementById('status')
const katex  = () => globalThis.katex ?? null
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const setStatus = (kind, text) => { status.dataset.status = kind; status.textContent = text }
const openNova = path => { void browser.openTab(`${NOVA_URL}${path}`) }

const SUGGESTIONS = {
  selection: ['Explain this passage simply', 'Give me an example of this', 'What should I remember from this?'],
  page:      ['What is this page about?', 'Explain the key ideas', 'Quiz me on this topic'],
}

function answerNode(text) {
  const box = el('div', { class: 'md' })
  box.append(render(parse(text), { doc: document, katex: katex() }))
  return box
}

async function start() {
  if (!(await store.token())) {
    setStatus('disconnected', 'Not connected')
    return view.replaceChildren(el('div', { class: 'empty' },
      el('h1', {}, 'Connect Nova first'),
      el('p', {}, 'Open Nova from the toolbar and connect it with a code from Kivo. Then ask from there.')))
  }
  const handoff = Number.isInteger(tabId) ? await browser.panelHandoff(tabId) : null
  const page = handoff ? describePage({ url: handoff.url, title: handoff.title }) : null
  if (!page || !page.supported) {
    setStatus('connected', 'Connected')
    return view.replaceChildren(el('div', { class: 'empty' },
      el('h1', {}, 'Open Nova on a page'),
      el('p', {}, 'Click Nova in the toolbar on the page you are reading, then Ask Nova.')))
  }
  setStatus('connected', handoff.name ? `Connected · ${handoff.name}` : 'Connected')
  const canonical = typeof handoff.canonicalUrl === 'string' ? handoff.canonicalUrl : null
  renderConversation({ ...page, tabId, windowId: handoff.windowId, canonical }, handoff, await threads.load(page.url, canonical), await threads.loadTyping(page.url, canonical))
}

function renderConversation(page, handoff, saved, typing) {
  let turns = Array.isArray(saved.turns) ? saved.turns.filter(t => t.answer || t.error) : []
  let selection = typeof handoff.selection === 'string' ? handoff.selection : ''
  let useSelection = Boolean(selection) && typing.useSelection !== false
  // Locked (Keep): this article's conversation is kept on this device until
  // unlocked, so closing the panel or the browser loses nothing while reading it.
  let locked = saved.locked === true
  let shot = null          // { src, img, mark }
  let asking = false
  let stopRegion = null

  const log = el('div', { class: 'log', role: 'log', ariaLive: 'polite', ariaLabel: 'Conversation with Nova', dataset: { log: '' } })
  const scroller = el('div', { class: 'scroll', dataset: { scroll: '' } }, log)
  const question = el('textarea', { id: 'question', rows: 1, placeholder: 'Ask about this page…', maxLength: 500, autocomplete: 'off', dataset: { question: '' } })
  const askButton = el('button', { class: 'primary send', type: 'submit', disabled: true, ariaLabel: 'Ask', title: 'Ask (Enter)', dataset: { askSubmit: '' } }, 'Ask')
  const shotButton = el('button', { class: 'quiet tool', type: 'button', dataset: { screenshot: '' }, title: 'Send a picture of what this tab shows with your question' }, 'Screenshot')
  const regionButton = el('button', { class: 'quiet tool', type: 'button', dataset: { screenshotRegion: '' }, title: 'Drag over one part of the page' }, 'Select area')
  const selButton = el('button', { class: 'quiet tool', type: 'button', dataset: { refreshSelection: '' }, title: 'Read the text selected on the page now' }, 'Use selection')
  const attached = el('div', { class: 'attached', dataset: { attached: '' } })
  const errors = el('div', { class: 'errors' })

  const persist = () => threads.save(page.url, page.canonical, page, turns, { locked })
  // What is being typed, and whether the selection goes with it, kept for this article.
  const keepTyping = () => threads.saveTyping(page.url, page.canonical, { text: question.value, useSelection })
  const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  const toBottom = (force = false) => { if (force || atBottom()) scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }) }
  const fit = () => { question.style.height = 'auto'; question.style.height = `${Math.min(question.scrollHeight + 2, 160)}px` }
  const ready = () => { askButton.disabled = asking || !question.value.trim() }

  // ── What goes with the next question ───────────────────────────────────────
  function showAttached() {
    const chips = []
    if (selection) {
      chips.push(el('span', { class: `chip ${useSelection ? 'on' : ''}`, dataset: { chipSelection: useSelection ? 'on' : 'off' } },
        el('span', { class: 'chip-text', title: selection }, `Selection: “${selection.slice(0, 60)}${selection.length > 60 ? '…' : ''}”`),
        el('button', { class: 'chip-x', type: 'button', ariaLabel: useSelection ? 'Don’t send the selection' : 'Send the selection', title: useSelection ? 'Don’t send the selection' : 'Send the selection', onclick: () => { useSelection = !useSelection; showAttached(); void keepTyping() } }, useSelection ? '×' : '+')))
    }
    if (shot) {
      const mark  = el('div', { class: 'shot-mark', ariaHidden: 'true' })
      const frame = el('div', { class: 'shot-frame', dataset: { shot: '' } }, el('img', { src: shot.src, alt: shot.mark ? 'Your screenshot, with the part you marked' : 'Your screenshot of this page', draggable: false }), mark)
      placeMark(mark, shot.mark)
      let from = null
      const at = e => { const r = frame.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) } }
      frame.addEventListener('pointerdown', e => { if (asking) return; from = at(e); frame.setPointerCapture(e.pointerId); e.preventDefault() })
      frame.addEventListener('pointermove', e => { if (from) placeMark(mark, markBetween(from, at(e))) })
      frame.addEventListener('pointercancel', () => { from = null; placeMark(mark, shot.mark) })
      frame.addEventListener('pointerup', e => { if (!from) return; const m = markBetween(from, at(e)); from = null; shot.mark = m.w > 0.03 && m.h > 0.03 ? m : null; showAttached() })
      chips.push(el('div', { class: 'shot' }, frame,
        el('div', { class: 'shot-bar' },
          el('p', { class: 'small', dataset: { shotNote: shot.mark ? 'marked' : 'whole' } }, shot.mark ? 'Nova gets only the part you marked.' : 'Drag across the part you mean to send only that.'),
          el('div', { class: 'shot-tools' },
            shot.mark ? el('button', { class: 'link', type: 'button', onclick: () => { shot.mark = null; showAttached() } }, 'Use all of it') : null,
            el('button', { class: 'link', type: 'button', dataset: { shotRemove: '' }, onclick: () => { shot = null; showAttached(); question.focus() } }, 'Remove')))))
    }
    attached.replaceChildren(...chips)
    shotButton.textContent = shot ? 'Retake' : 'Screenshot'
  }

  shotButton.addEventListener('click', async () => {
    if (asking || shotButton.getAttribute('aria-busy')) return
    busy(shotButton, 'Taking…'); errors.replaceChildren()
    const src = await browser.captureTab(page.windowId)
    const img = src ? await loadPicture(src).catch(() => null) : null
    idle(shotButton)
    if (!img) return errors.replaceChildren(alertBox("Nova couldn't take a screenshot of this page. Some pages don't allow it, or the tab changed. Click Nova in the toolbar on this page again."))
    shot = { src, img, mark: null }
    showAttached(); question.focus()
  })
  regionButton.addEventListener('click', async () => {
    if (asking || regionButton.getAttribute('aria-busy')) return
    busy(regionButton, 'Select on the page…'); errors.replaceChildren()
    stopRegion?.()
    stopRegion = browser.waitForRegion(page.tabId, async got => {
      idle(regionButton); stopRegion = null
      const img = await loadPicture(got.src).catch(() => null)
      if (!img) return errors.replaceChildren(alertBox("That area couldn't be read. Select it again."))
      shot = { src: got.src, img, mark: null, region: true }
      showAttached(); question.focus()
    })
    if (!(await browser.startRegion(page.tabId))) {
      stopRegion?.(); stopRegion = null; idle(regionButton)
      errors.replaceChildren(alertBox("Nova can't select an area on this page now. Click Nova in the toolbar on this page again, or use Screenshot."))
    }
  })
  selButton.addEventListener('click', async () => {
    busy(selButton, 'Reading…'); errors.replaceChildren()
    const probe = await browser.readPage(page.tabId, 4000)
    idle(selButton)
    if (probe.tooLong) return errors.replaceChildren(alertBox('That selection is longer than Nova reads at once (4,000 characters). Select less.'))
    if (!probe.available) return errors.replaceChildren(alertBox("Nova can't read this tab now. Click Nova in the toolbar on this page again."))
    if (!probe.selection) return errors.replaceChildren(alertBox('Select some text on the page first.'))
    selection = probe.selection; useSelection = true
    showAttached(); question.focus()
  })

  // ── The conversation ───────────────────────────────────────────────────────
  const BASIS = {
    screenshot: 'From your screenshot. Nova saw only what was in the picture.',
    selection:  'From your selection. Nova has not read the rest of the page.',
    title:      'Nova saw only the title. Select the part you mean for a closer answer.',
  }

  function turnNode(turn, index) {
    const node = el('article', { class: 'turn', dataset: { turn: String(index) } })
    node.append(el('div', { class: 'you', dataset: { asked: '' } },
      el('p', {}, turn.question),
      turn.sent?.length ? el('p', { class: 'sent' }, `with ${turn.sent.join(', ').toLowerCase()}`) : null))
    if (turn.pending) {
      node.append(el('p', { class: 'thinking', role: 'status' }, turn.sent?.includes('Screenshot') || turn.sent?.includes('Marked area') ? 'Nova is looking at your screenshot…' : turn.detail === 'detailed' ? 'Nova is writing a fuller answer…' : 'Nova is thinking…'))
      return node
    }
    if (turn.error) {
      node.append(el('div', { class: 'nova failed' }, alertBox(turn.error),
        el('button', { class: 'link', type: 'button', dataset: { retry: '' }, onclick: () => void ask(turn.question, { detail: turn.detail, replace: index }) }, 'Try again')))
      return node
    }
    const copied = el('span', { class: 'small', role: 'status' })
    const keepButton = el('button', { class: 'link', type: 'button', dataset: { keepAnswer: '' }, title: 'Keep this answer in your current draft in Kivo, with this page as its source' }, 'Keep in drafts')
    keepButton.addEventListener('click', async () => {
      if (keepButton.getAttribute('aria-busy')) return
      busy(keepButton, 'Keeping…')
      const res = await client.capture({ ...buildCapture({ key: turn.keepKey ??= newActionId(), page, text: '' }), note: `Nova, on “${turn.question}”:\n\n${turn.answer}` })
      idle(keepButton)
      copied.textContent = res.ok && res.data.success ? 'In your drafts.' : (res.ok ? "That didn't save." : res.message)
      if (res.ok && res.data.success) { keepButton.disabled = true; void persist() }
    })
    node.append(el('div', { class: 'nova', dataset: { answer: '', basis: turn.basis, detail: turn.detail } },
      answerNode(turn.answer),
      el('div', { class: 'answer-bar' },
        turn.detail !== 'detailed' ? el('button', { class: 'link', type: 'button', dataset: { moreDetail: '' }, onclick: () => void ask(turn.question, { detail: 'detailed', label: 'More detail' }) }, 'More detail') : null,
        el('button', { class: 'link', type: 'button', dataset: { copy: '' }, onclick: async () => { try { await navigator.clipboard.writeText(turn.answer); copied.textContent = 'Copied.' } catch { copied.textContent = "Couldn't copy." } } }, 'Copy'),
        keepButton, copied),
      el('p', { class: 'basis small' }, BASIS[turn.basis] ?? '')))
    return node
  }

  function draw() {
    if (!turns.length) {
      const ideas = SUGGESTIONS[selection ? 'selection' : 'page']
      log.replaceChildren(el('div', { class: 'welcome', dataset: { welcome: '' } },
        el('h1', {}, 'Ask about this page'),
        el('p', {}, selection ? 'Your selection goes with your question. Follow-ups keep the conversation.' : 'Nova sees its title. Select a passage, or add a screenshot, for a closer answer.'),
        el('div', { class: 'ideas' }, ideas.map(text => el('button', { class: 'idea', type: 'button', dataset: { idea: '' }, onclick: () => void ask(text) }, text)))))
      return
    }
    log.replaceChildren(...turns.map(turnNode))
  }

  async function ask(text, { detail = 'brief', label = null, replace = null } = {}) {
    const asked = (text ?? '').trim()
    if (!asked || asking) return
    const screenshot = shot ? encodeShot(shot.img, shot.mark) : null
    if (shot && !screenshot) return errors.replaceChildren(alertBox('That screenshot is too large to send. Drag across the part you mean, then ask again.'))
    errors.replaceChildren()
    const previous = replace === null ? turns : turns.slice(0, replace)
    const sent = [useSelection && selection ? 'Selection' : null, screenshot ? (shot.mark ? 'Marked area' : 'Screenshot') : null].filter(Boolean)
    const turn = { question: label ? `${label}: ${asked}` : asked, asked, detail, sent, pending: true, at: Date.now() }
    turns = replace === null ? [...turns, turn] : [...previous, turn]
    asking = true; ready(); busy(askButton, 'Asking'); question.readOnly = true
    draw(); toBottom(true)
    const res = await client.ask(buildQuestion({ question: asked, page, excerpt: useSelection ? selection : '', screenshot, history: historyOf(previous), detail }))
    asking = false; idle(askButton); question.readOnly = false
    delete turn.pending
    if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); turn.error = res.message }
    else if (!res.ok || typeof res.data.answer !== 'string') turn.error = res.ok ? "That didn't work. Try again in a moment." : res.message
    else { turn.answer = res.data.answer; turn.basis = res.data.basis; turn.detail = res.data.detail ?? detail; if (text === question.value.trim()) { question.value = ''; fit(); void keepTyping() } }
    ready(); draw(); toBottom()
    if (turn.answer) await persist()
    question.focus()
  }

  question.addEventListener('input', () => { ready(); fit(); void keepTyping() })
  question.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    e.preventDefault()
    if (!askButton.disabled) form.requestSubmit()
  })
  const form = el('form', { class: 'composer', dataset: { composer: '' }, onsubmit: e => { e.preventDefault(); void ask(question.value) } },
    attached, errors,
    el('div', { class: 'ask-box' }, sr('Your question about this page', { htmlFor: 'question' }), question, askButton),
    el('div', { class: 'tools' }, selButton, shotButton, regionButton))

  const fresh = el('button', { class: 'link', type: 'button', dataset: { newConversation: '' }, title: 'Start again: Nova forgets this conversation' }, 'New conversation')
  fresh.addEventListener('click', async () => { if (asking) return; turns = []; locked = false; showLock(); await threads.clear(page.url, page.canonical); draw(); question.focus() })

  // Keep (lock): on this device until unlocked; off, in memory until the browser quits.
  const lock = el('button', { class: 'link lock', type: 'button', dataset: { lock: '' } })
  const keepNote = el('span', { dataset: { keepNote: '' } })
  function showLock() {
    lock.setAttribute('aria-pressed', String(locked))
    lock.textContent = locked ? 'Kept' : 'Keep'
    lock.title = locked
      ? `Kept on this device for this article, even after the browser closes. Press to stop keeping it (unused for ${LOCK_DAYS} days, it goes by itself).`
      : 'Keep this conversation on this device, so it is still here after the browser closes while you read this article'
    keepNote.textContent = locked
      ? `Kept on this device for this article until you unlock it (or ${LOCK_DAYS} days unused).`
      : 'Kept until you close the browser. Press Keep to keep it longer.'
  }
  lock.addEventListener('click', async () => { locked = !locked; showLock(); await persist() })
  showLock()

  view.replaceChildren(
    el('section', { class: 'pagebar', ariaLabel: 'The page this conversation is about', dataset: { context: page.url } },
      el('span', { class: 'site', ariaHidden: 'true' }, siteInitial(page.domain)),
      el('div', { class: 'pagebar-text' }, el('p', { class: 'pagebar-title', title: page.title }, page.title), el('p', { class: 'small' }, page.domain)),
      el('div', { class: 'pagebar-tools' }, lock, fresh)),
    scroller,
    form,
    el('footer', { class: 'panel-foot small' },
      el('button', { class: 'link ext', type: 'button', onclick: () => openNova('/notes/drafts') }, 'Drafts in Kivo'),
      keepNote))

  if (typing.text) question.value = typing.text
  showAttached(); draw(); ready(); fit()
  requestAnimationFrame(() => toBottom(true))
  question.focus()
  addEventListener('pagehide', () => stopRegion?.())
}

void start()

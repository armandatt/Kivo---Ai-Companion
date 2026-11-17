// Nova's side panel: a conversation with Nova about the page the user is
// on, and the place where Nova does things for them ("Do it for me"). In a
// browser with no side panel (Safari), and in the popup's Chat with Nova,
// the same page runs inside the popup ([data-inline]).
//
// The page follows the user (lib/page-context.js): the panel belongs to the
// window, so it stays open across tabs; a link followed or a tab switched is
// noticed at once. An empty conversation moves to the new page by itself;
// one with something in it offers "You moved to … Switch to this page?".
// A message is always about the page in front at the moment it is sent.
//
// What a message does is decided per request (lib/intent.js): a question about
// the page is answered from the page's text in one call (…/ask); work on the
// page, or research across sites, goes to Nova's browser agent (lib/agent*.js,
// run by the background worker), which shows what it does and waits for the
// user before anything with consequences (lib/agent-view.js); a request that
// cannot be acted on as written gets one short question back.
//
// What goes with each message: the conversation so far (lib/thread.js), the
// selected passage if the user keeps it attached, a screenshot they took or
// pasted, and for a question, the page's text. Nova's server stores none of
// it; the conversation is kept in memory (chrome.storage.session) until New
// conversation or the browser quits, or on this device if the user presses
// Keep. Answers are drawn from Markdown and LaTeX (lib/markdown.js, KaTeX).

import { NOVA_URL } from './config.js'
import { buildCapture, buildQuestion, createClient, newActionId } from './lib/api.js'
import { browser } from './lib/browser.js'
import { describePage } from './lib/page.js'
import { parse, render } from './lib/markdown.js'
import { createStore } from './lib/store.js'
import { LOCK_DAYS, articleOf, createThreads, historyOf } from './lib/thread.js'
import { alertBox, busy, clamp, el, encodeShot, idle, loadPicture, markBetween, placeMark, siteInitial, sr } from './lib/ui.js'
import { FINISHED, statusOf } from './lib/agent.js'
import { answerOf, liveTask, send, taskExtras, taskSummary } from './lib/agent-view.js'
import { classify } from './lib/intent.js'
import { createPageContext, patternFrom } from './lib/page-context.js'

const store   = createStore(browser.storage())
// In memory by default; on this device only when the learner locks a conversation (Keep).
const threads = createThreads(browser.session(), browser.storage())
const client  = createClient({ baseUrl: NOVA_URL, fetch: (...args) => fetch(...args), getToken: () => store.token() })
const params  = new URLSearchParams(location.search)
const tabId   = Number(params.get('tab'))
const inline  = params.get('inline') === '1'
// Opened from the popup's Chat with Nova: answers only; work goes to the side panel.
const chatOnly = params.get('chat') === '1'
if (inline) document.documentElement.dataset.inline = ''

const view   = document.getElementById('view')
const status = document.getElementById('status')
const katex  = () => globalThis.katex ?? null
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const setStatus = (kind, text) => { status.dataset.status = kind; status.textContent = text }
const openNova = path => { void browser.openTab(`${NOVA_URL}${path}`) }

const SUGGESTIONS = {
  selection: ['Explain this passage simply', 'Give me an example of this', 'What should I remember from this?'],
  page:      ['Summarise this page in 5 points', 'What is the main idea here?', 'Explain the hardest part of this page'],
  task:      ['Fill in this form with my details', 'Answer the questions on this page', 'Go through the first 3 items here and summarise each'],
  anywhere:  ['Open Gmail and summarise my 3 latest emails', 'Find a beginner course on linear algebra and save the best one to my Drafts', 'Go to Wikipedia and tell me what Raft consensus is'],
  research:  [
    'Explain the main Retrieval-Augmented Generation architectures and how they differ',
    'Find the best introductions to Raft consensus and compare how they explain leader election',
    'What does current research say about spaced repetition intervals?',
  ],
}

function answerNode(text) {
  const box = el('div', { class: 'md' })
  box.append(render(parse(text), { doc: document, katex: katex() }))
  return box
}

let mounted = null        // the conversation on screen: { page, dispose, hasTurns, busy, pinned }
let context = null        // lib/page-context.js
let windowId = null

// A tab that is not a website (a new tab, a browser page): nothing to read or
// chat about, but Do it for me works from anywhere: Nova opens the sites the
// task needs. Only tasks are offered there (blank: true).
const blankPage = p => ({ blank: true, supported: true, url: String(p.url || 'about:blank'), title: 'Any site', domain: 'Nova opens the sites it needs', kind: 'none', tabId: p.tabId, windowId, canonical: null, status: 'blank' })
const pageOf = (p, handoff = {}) => {
  const page = describePage({ url: p.url, title: p.title })
  if (page.supported) return { ...page, tabId: p.tabId, windowId, canonical: typeof handoff.canonicalUrl === 'string' ? handoff.canonicalUrl : null, status: p.status ?? 'ready' }
  return Number.isInteger(p.tabId) && p.status !== 'unknown' && !chatOnly ? blankPage(p) : null
}
const sameArticle = (a, b) => Boolean(a && b) && articleOf(a.url, a.canonical) === articleOf(b.url, b.canonical)

async function start() {
  if (!(await store.token())) {
    setStatus('disconnected', 'Not connected')
    return view.replaceChildren(el('div', { class: 'empty' },
      el('h1', {}, 'Connect Nova first'),
      el('p', {}, 'Open Nova from the toolbar and connect it with a code from Kivo. Then ask from there.')))
  }
  windowId = await browser.ownWindow()
  const given = Number.isInteger(tabId) ? await browser.panelHandoff(tabId) : null
  // A hand-off counts only for this window, and only while it is new.
  const handoff = given && (windowId === null || given.windowId === undefined || given.windowId === windowId) && (inline || Date.now() - (given.at ?? 0) < 60_000 || given.task) ? given : null
  if (windowId === null) windowId = handoff?.windowId ?? null
  const opened = Date.now()
  if (!inline) browser.onHandoff((id, h) => {
    if ((h.at ?? 0) <= opened || (typeof h.windowId === 'number' && h.windowId !== windowId)) return
    const p = pageOf({ url: h.url, title: h.title, tabId: id }, h)
    if (p) void mount(p, h)
  })
  setStatus('connected', handoff?.name ? `Connected · ${handoff.name}` : 'Connected')
  const first = handoff ? pageOf({ url: handoff.url, title: handoff.title, tabId }, handoff) : null
  if (!inline) {
    context = createPageContext({
      browser, windowId,
      isAgentTab: id => (runningTask?.browser?.tabs ?? []).some(([t, info]) => t === id && info.own),
      onChange: p => void followed(p),
    })
  }
  if (first) await mount(first, handoff)
  else {
    const now = await context?.refresh()
    if (now && pageOf(now)) await mount(pageOf(now), {})
    else showNoPage(now)
  }
}

// What the panel says when the tab in front is not a page Nova can talk about (yet).
function showNoPage(p) {
  mounted?.dispose(); mounted = null
  const unknown = !p || p.status === 'unknown'
  view.replaceChildren(el('div', { class: 'empty', dataset: { noPage: p?.status ?? 'none' } },
    el('h1', {}, unknown ? 'Nova can’t see this tab yet' : 'Nothing for Nova to read here'),
    el('p', {}, unknown
      ? 'Click Nova in the toolbar on this page, or let Nova follow the tabs you switch to.'
      : 'This tab is a browser page or a file. Switch to an ordinary web page.'),
    unknown ? el('button', { class: 'primary', type: 'button', dataset: { followTabs: '' }, onclick: async () => { if (await browser.followTabs()) await context?.refresh() } }, 'Let Nova follow my tabs') : null))
}

// The page in front changed: move with it, or offer to.
let runningTask = null
async function followed(p) {
  if (!mounted) { if (p && pageOf(p)) await mount(pageOf(p), {}); else showNoPage(p); return }
  const next = p ? pageOf(p) : null
  if (next && sameArticle(next, mounted.page)) { mounted.retab?.(next); return }
  // Nothing said here yet, and nothing running: the panel simply moves.
  if (!mounted.hasTurns() && !mounted.busy() && !mounted.pinned) {
    if (next) await mount(next, {})
    else showNoPage(p)
    return
  }
  mounted.offerSwitch(p, next)
}

async function mount(page, handoff) {
  mounted?.dispose()
  const task = await taskState()
  mounted = renderConversation(page, handoff ?? {}, await threads.load(page.url, page.canonical), await threads.loadTyping(page.url, page.canonical), task)
}

const taskState = () => browser.agentState()

function renderConversation(page, handoff, saved, typing, task) {
  const research = handoff.mode === 'research'
  const blank = page.blank === true
  const cleanups = []
  let pinned = false
  let pendingSwitch = null
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
  const question = el('textarea', { id: 'question', rows: 1, placeholder: research ? 'What should Nova research?' : blank ? 'Tell Nova what to do, on any site…' : chatOnly ? 'Ask about this page… (paste a screenshot with ⌘V)' : 'Ask about this page, or tell Nova what to do…', maxLength: 1000, autocomplete: 'off', dataset: { question: '' } })
  const askButton = el('button', { class: 'primary send', type: 'submit', disabled: true, ariaLabel: 'Ask', title: 'Ask (Enter)', dataset: { askSubmit: '' } }, 'Ask')
  const shotButton = el('button', { class: 'quiet tool', type: 'button', dataset: { screenshot: '' }, title: 'Send a picture of what this tab shows with your question' }, 'Screenshot')
  const regionButton = el('button', { class: 'quiet tool', type: 'button', dataset: { screenshotRegion: '' }, title: 'Drag over one part of the page' }, 'Select area')
  const selButton = el('button', { class: 'quiet tool', type: 'button', dataset: { refreshSelection: '' }, title: 'Read the text selected on the page now' }, 'Use selection')
  const attached = el('div', { class: 'attached', dataset: { attached: '' } })
  // Watch Nova work: its tabs come to the front and each action is shown on the page.
  const watchBox = el('input', { type: 'checkbox', id: 'watch', checked: true, dataset: { watch: '' } })
  void browser.watchPreference().then(on => { watchBox.checked = on })
  watchBox.addEventListener('change', () => void browser.setWatchPreference(watchBox.checked))
  const watchToggle = el('label', { class: 'watch small', htmlFor: 'watch', title: 'Nova brings the pages it works on to the front and shows each click and keystroke as it happens' }, watchBox, el('span', {}, 'Watch Nova work'))
  // The tabs Nova opens stay open when a task ends (what was done in them is
  // kept); the user is taken back to the tab they started on. Closing them is
  // the user's choice.
  const closeBox = el('input', { type: 'checkbox', id: 'close-tabs', dataset: { closeTabs: '' } })
  void browser.closeTabsPreference().then(on => { closeBox.checked = on })
  closeBox.addEventListener('change', () => void browser.setCloseTabsPreference(closeBox.checked))
  const keepToggle = el('label', { class: 'watch small', htmlFor: 'close-tabs', title: 'Close the tabs Nova opened when a task ends. Off: they stay open and you go back to the tab you started on.' }, closeBox, el('span', {}, 'Close Nova’s tabs when done'))
  const errors = el('div', { class: 'errors' })
  const switchBar = el('div', { class: 'elsewhere switch-bar small', role: 'status', hidden: true, dataset: { moved: '' } })

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
      chips.push(el('div', { class: 'shot', dataset: { shotKind: shot.pasted ? 'pasted' : 'taken' } }, frame,
        el('div', { class: 'shot-bar' },
          el('p', { class: 'small', dataset: { shotNote: shot.mark ? 'marked' : 'whole' } }, shot.mark ? 'Nova gets only the part you marked.' : 'Drag across the part you mean to send only that.'),
          el('div', { class: 'shot-tools' },
            shot.mark ? el('button', { class: 'link', type: 'button', onclick: () => { shot.mark = null; showAttached() } }, 'Use all of it') : null,
            el('button', { class: 'link', type: 'button', dataset: { shotRemove: '' }, onclick: () => { if (shot?.pasted) URL.revokeObjectURL(shot.src); shot = null; showAttached(); question.focus() } }, 'Remove')))))
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

  // Ctrl/Cmd+V of a picture: it becomes the screenshot that goes with the question.
  question.addEventListener('paste', async e => {
    const item = [...(e.clipboardData?.items ?? [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    if (asking) return
    errors.replaceChildren()
    const file = item.getAsFile()
    if (!file) return errors.replaceChildren(alertBox('That picture couldn’t be read from the clipboard. Copy it again, or use Screenshot.'))
    if (file.size > 12 * 1024 * 1024) return errors.replaceChildren(alertBox('That picture is too large to send (over 12 MB). Crop it, or use Select area.'))
    const url = URL.createObjectURL(file)
    const img = await loadPicture(url).catch(() => null)
    if (!img) { URL.revokeObjectURL(url); return errors.replaceChildren(alertBox('That picture couldn’t be opened. Try a PNG or JPEG.')) }
    shot = { src: url, img, mark: null, pasted: true }
    showAttached(); question.focus()
  })

  // ── The conversation ───────────────────────────────────────────────────────
  const BASIS = {
    screenshot: 'From your screenshot. Nova saw only what was in the picture.',
    page:       'From this page.',
    page_part:  'From the first part of this page (it is long).',
    selection:  'From your selection. Nova has not read the rest of the page.',
    title:      'Nova couldn’t read this page, so it answered from the title.',
    agent:      '',
  }

  function turnNode(turn, index) {
    const node = el('article', { class: 'turn', dataset: { turn: String(index) } })
    node.append(el('div', { class: 'you', dataset: { asked: '' } },
      el('p', {}, turn.question),
      turn.sent?.length ? el('p', { class: 'sent' }, `with ${turn.sent.join(', ').toLowerCase()}`) : null))
    if (turn.pending && turn.kind === 'task') {
      if (turn.superseded) node.append(el('p', { class: 'small', role: 'status' }, `Stopped the earlier task (“${turn.superseded.slice(0, 50)}”) to do this.`))
      node.append(live && live.id === turn.taskId ? liveTask(live) : el('p', { class: 'thinking', role: 'status' }, 'Nova is starting…'))
      return node
    }
    if (turn.pending) {
      node.append(el('p', { class: 'thinking', role: 'status' }, turn.reading ? 'Nova is reading the page…' : turn.sent?.includes('Screenshot') || turn.sent?.includes('Marked area') || turn.sent?.includes('Pasted picture') ? 'Nova is looking at your picture…' : turn.detail === 'detailed' ? 'Nova is writing a fuller answer…' : 'Nova is thinking…'))
      return node
    }
    if (turn.clarify) {
      node.append(el('div', { class: 'nova card', dataset: { clarify: '' } },
        el('p', {}, turn.clarify.question),
        turn.clarify.choices?.length ? el('div', { class: 'choices' }, turn.clarify.choices.map(c => el('button', { class: 'choice', type: 'button', onclick: () => { turns = turns.filter(t => t !== turn); void ask(`${turn.asked} (${c})`) } }, c))) : null,
        el('p', { class: 'small' }, 'Or type your answer below.')))
      return node
    }
    if (turn.needsPanel) {
      node.append(el('div', { class: 'nova card', dataset: { needsPanel: '' } },
        el('p', {}, 'This needs Nova to work on the page for you. That happens in the side panel, where you can watch it and approve each step that matters.'),
        el('div', { class: 'card-actions' }, el('button', { class: 'primary', type: 'button', dataset: { doItForMe: '' }, onclick: () => void openDoIt(turn.asked) }, 'Do it for me'))))
      return node
    }
    if (turn.error) {
      node.append(el('div', { class: 'nova failed' }, alertBox(turn.error),
        turn.busyTab ? el('button', { class: 'link', type: 'button', dataset: { stopOther: '' }, onclick: async () => { await send('agent:stop'); await send('agent:dismiss'); void runTask(turn.asked ?? turn.question, { replace: index }) } }, 'Stop that task and do this') : null,
        el('button', { class: 'link', type: 'button', dataset: { retry: '' }, onclick: () => void ask(turn.asked ?? turn.question, { detail: turn.detail, replace: index }) }, 'Try again')))
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
      turn.task ? taskExtras(turn.task, { client, openNova, onSaved: () => void persist() }) : null,
      el('div', { class: 'answer-bar' },
        turn.kind !== 'task' && turn.detail !== 'detailed' ? el('button', { class: 'link', type: 'button', dataset: { moreDetail: '' }, onclick: () => void ask(turn.question, { detail: 'detailed', label: 'More detail' }) }, 'More detail') : null,
        // Answered as a question, but meant as work: the user says so in one press.
        turn.kind !== 'task' && turn.basis !== 'screenshot' ? el('button', { class: 'link', type: 'button', dataset: { doItForMe: '' }, title: 'Have Nova do this on the page instead of answering', onclick: () => void (chatOnly ? openDoIt(turn.asked ?? turn.question) : runTask(turn.asked ?? turn.question, { mode: 'page' })) }, 'Do it for me') : null,
        el('button', { class: 'link', type: 'button', dataset: { copy: '' }, onclick: async () => { try { await navigator.clipboard.writeText(turn.answer); copied.textContent = 'Copied.' } catch { copied.textContent = "Couldn't copy." } } }, 'Copy'),
        keepButton, copied),
      el('p', { class: 'basis small' }, turn.basis === 'page' && turn.pageComplete === false ? BASIS.page_part : BASIS[turn.basis] ?? '')))
    return node
  }

  function draw() {
    if (!turns.length) {
      const ideas = SUGGESTIONS[research ? 'research' : blank ? 'anywhere' : selection ? 'selection' : 'page']
      log.replaceChildren(el('div', { class: 'welcome', dataset: { welcome: '' } },
        el('h1', {}, research ? 'What should Nova research?' : blank ? 'What should Nova do?' : chatOnly ? 'Chat with Nova about this page' : 'Ask, or say “do it for me”'),
        el('p', {}, blank ? 'This tab isn’t a website, so there’s nothing here to read or chat about. Tell Nova a task and it opens the sites it needs in this tab or its own, and asks before anything with consequences. To chat about a page, open the page first.' : research
          ? 'Nova checks your Kivo first, then searches, reads and compares sources in tabs of its own. You can pause or stop it at any time, and save what it finds to your Drafts.'
          : chatOnly ? 'Nova reads this page and answers here. Paste a screenshot with ⌘V or Ctrl+V. For work on the page, use Do it for me.'
          : selection ? 'Your selection goes with your message. A question is answered from this page; a task (a form, questions, items to go through) Nova does here, on your tab.'
          : 'A question is answered from this page. A task (a form, questions, items to go through, research) Nova does on your tab, and asks before anything with consequences.'),
        el('div', { class: 'ideas' }, [...ideas, ...(research || chatOnly || blank ? [] : SUGGESTIONS.task.slice(0, 2))].map(text => el('button', { class: 'idea', type: 'button', dataset: { idea: '' }, onclick: () => void ask(text) }, text)))))
      return
    }
    log.replaceChildren(...turns.map(turnNode))
  }

  // The page in front when a message is sent: the conversation moves there
  // first if the user changed page and did not choose to stay.
  async function pageNow() {
    if (inline || !context) return null
    const p = await context.refresh()
    const next = p ? pageOf(p) : null
    if (next && !sameArticle(next, page) && !pinned) return next
    return null
  }

  async function ask(text, { detail = 'brief', label = null, replace = null, forceTask = false } = {}) {
    const asked = (text ?? '').trim()
    if (!asked || asking) return
    const moved = await pageNow()
    if (moved) { question.value = ''; void keepTyping(); await mount(moved, {}); return mounted?.send(asked, { detail, label, forceTask }) }
    // More detail on an answer, or a picture: answered from what was given.
    if (label || shot) return chat(asked, { detail, label, replace, scope: null })
    errors.replaceChildren()
    const previous = replace === null ? turns : turns.slice(0, replace)
    const turn = { question: asked, asked, sent: [], pending: true, at: Date.now() }
    turns = replace === null ? [...turns, turn] : [...previous, turn]
    asking = true; ready(); busy(askButton, 'Asking'); question.readOnly = true
    draw(); toBottom(true)
    const read = await classify(client, { request: asked, page, hasSelection: useSelection && Boolean(selection), hasScreenshot: false, lastAnswer: [...previous].reverse().find(t => t.answer)?.answer ?? '', surface: chatOnly ? 'popup' : 'panel' })
    // "Do it for me": work, whatever the words; research stays research.
    // On a tab that is not a website there is no page to chat about: tasks only.
    const routed = (forceTask || blank) && read.route === 'chat' ? { ...read, route: 'task' } : read
    asking = false; idle(askButton); question.readOnly = false
    turns = turns.filter(t => t !== turn)
    if (routed.route === 'clarify' && routed.question) {
      turns = [...turns, { question: asked, asked, clarify: { question: routed.question, choices: routed.choices ?? [] }, at: Date.now() }]
      question.value = ''; fit(); void keepTyping()
      ready(); draw(); toBottom(); question.focus()
      return
    }
    if (routed.route === 'chat') return chat(asked, { detail, replace, scope: routed.scope, workspace: routed.workspace })
    if (chatOnly) {
      turns = [...turns, { question: asked, asked, needsPanel: true, at: Date.now() }]
      question.value = ''; fit(); void keepTyping()
      ready(); draw(); toBottom()
      return
    }
    return runTask(asked, { replace, mode: routed.route === 'research' ? 'research' : 'page', scope: routed.scope, kind: routed.kind })
  }

  // A question answered from the page, in one call.
  async function chat(asked, { detail = 'brief', label = null, replace = null, scope = null, workspace = false } = {}) {
    const screenshot = shot ? encodeShot(shot.img, shot.mark) : null
    if (shot && !screenshot) return errors.replaceChildren(alertBox('That picture is too large to send. Drag across the part you mean, then ask again.'))
    errors.replaceChildren()
    const previous = replace === null ? turns : turns.slice(0, replace)
    const sent = [useSelection && selection ? 'Selection' : null, screenshot ? (shot.pasted ? 'Pasted picture' : shot.mark ? 'Marked area' : 'Screenshot') : null].filter(Boolean)
    const turn = { question: label ? `${label}: ${asked}` : asked, asked, detail, sent, pending: true, reading: !screenshot, at: Date.now() }
    turns = replace === null ? [...turns, turn] : [...previous, turn]
    asking = true; ready(); busy(askButton, 'Asking'); question.readOnly = true
    draw(); toBottom(true)
    // The page's text, read now, from the tab in front: never an older reading.
    const read = screenshot || inline && !page.tabId ? null : await browser.readPageText(page.tabId)
    const fresh = read && articleOf(read.url) === articleOf(page.url) ? read : null
    if (!fresh && !screenshot && page.status === 'no_access') {
      asking = false; idle(askButton); question.readOnly = false
      turns = turns.filter(t => t !== turn)
      ready(); draw()
      return askAccess(asked)
    }
    turn.reading = false; draw()
    const res = await client.ask(buildQuestion({ question: asked, page, excerpt: useSelection ? selection : '', screenshot, history: historyOf(previous), detail, pageText: fresh?.text ?? null, pageComplete: fresh?.complete ?? true, scope, workspace }))
    asking = false; idle(askButton); question.readOnly = false
    delete turn.pending
    if (!res.ok && res.kind === 'unauthenticated') { await store.clear(); turn.error = res.message }
    else if (!res.ok || typeof res.data.answer !== 'string') turn.error = res.ok ? "That didn't work. Try again in a moment." : res.message
    else {
      turn.answer = res.data.answer; turn.basis = res.data.basis; turn.detail = res.data.detail ?? detail; turn.pageComplete = fresh?.complete ?? true
      if (asked === question.value.trim() || !question.value.trim()) { question.value = ''; fit(); void keepTyping() }
      if (shot) { if (shot.pasted) URL.revokeObjectURL(shot.src); shot = null; showAttached() }
    }
    ready(); draw(); toBottom()
    if (turn.answer) await persist()
    question.focus()
  }

  // Nova may not read this site yet: the browser asks the user, from their click.
  function askAccess(asked) {
    const pattern = patternFrom(page.url)
    errors.replaceChildren(el('div', { class: 'card access-card', dataset: { pageAccess: '' } },
      el('strong', {}, `Allow Nova on ${page.domain}?`),
      el('p', {}, `To answer from this page, Nova needs to read ${page.domain}. Chrome will ask you to confirm.`),
      el('div', { class: 'card-actions' },
        el('button', { class: 'primary', type: 'button', dataset: { allowPage: 'always' }, onclick: () => void allow(true) }, `Always allow ${page.domain}`),
        el('button', { type: 'button', dataset: { allowPage: 'once' }, onclick: () => void allow(false) }, 'Just this question'),
        el('button', { class: 'quiet', type: 'button', onclick: () => errors.replaceChildren() }, 'Not now')),
      el('p', { class: 'small card-note' }, 'Always allow keeps it after Chrome restarts, until you remove it under Sites in the Nova popup.')))
    async function allow(always) {
      const granted = pattern ? await browser.allowSites([pattern]) : false
      if (!granted) return errors.replaceChildren(alertBox(`Nova can’t read ${page.domain} without your permission. You can also click Nova in the toolbar on this page.`))
      errors.replaceChildren(); page.status = 'ready'
      await ask(asked)
      // Just this question: given back once the page has been read for it.
      if (!always) { await browser.removeSites([pattern]); page.status = 'no_access' }
    }
  }

  // From the popup's chat: the work moves to the side panel, opened from this click.
  async function openDoIt(text) {
    const handoff = { url: page.url, canonicalUrl: page.canonical, title: page.title, selection: useSelection ? selection : '', windowId: page.windowId, task: text }
    const opened = browser.openPanel(page.tabId, handoff)
    if (opened && await opened) return window.close()
    errors.replaceChildren(alertBox('Nova couldn’t open the side panel here. Click Nova in the toolbar, then Do it for me.'))
  }

  // ── A task for Nova's browser agent ────────────────────────────────────────
  let live = task && !FINISHED.includes(statusOf(task.status)) && task.startTab?.id === page.tabId ? task : null
  runningTask = task && !FINISHED.includes(statusOf(task.status)) ? task : null

  async function runTask(asked, { replace = null, mode = 'page', scope = null, kind = null } = {}) {
    if (asking && !replace) return
    errors.replaceChildren()
    const previous = replace === null ? turns : turns.slice(0, replace)
    const sent = useSelection && selection ? ['Selection'] : []
    const turn = { question: asked, asked, kind: 'task', sent, pending: true, at: Date.now() }
    turns = replace === null ? [...turns, turn] : [...previous, turn]
    asking = true; ready(); busy(askButton, 'Starting'); question.readOnly = true
    draw(); toBottom(true)
    const objective = useSelection && selection ? `${asked}\n\n(The learner selected this on the page: "${selection.slice(0, 1500)}")` : asked
    const res = await send('agent:begin', { objective, history: historyOf(previous), tab: { id: page.tabId, url: page.url, title: page.title }, windowId: page.windowId, watch: watchBox.checked, closeTabs: closeBox.checked, mode, scope, kind })
    idle(askButton); question.readOnly = false
    if (!res?.ok) {
      asking = false
      delete turn.pending
      if (res?.kind === 'unauthenticated') await store.clear()
      turn.error = res?.message ?? "Nova couldn't start. Try again."
      if (res?.busy) turn.busyTab = res.tab ?? true
      ready(); draw(); toBottom()
      return
    }
    turn.taskId = res.id
    if (res.superseded) turn.superseded = res.superseded
    question.value = ''; fit(); void keepTyping()
    await persist()
    live = await taskState()
    draw(); toBottom()
  }

  // The task's state, as the background worker saves it: redraw its turn,
  // and when it ends, the answer joins the conversation.
  async function follow(state) {
    if (!state) return
    runningTask = FINISHED.includes(statusOf(state.status)) ? null : state
    const turn = turns.find(t => t.taskId === state.id)
    if (!turn) return
    if (FINISHED.includes(statusOf(state.status))) {
      live = null
      asking = false
      delete turn.pending
      turn.answer = answerOf(state)
      turn.basis = 'agent'
      turn.task = taskSummary(state)
      await persist()
      await send('agent:dismiss')
      ready(); draw(); toBottom()
      question.focus()
      return
    }
    live = state
    asking = true; ready()
    const node = log.querySelector(`[data-turn="${turns.indexOf(turn)}"]`)
    if (node) node.replaceWith(turnNode(turn, turns.indexOf(turn)))
    else draw()
    toBottom()
  }
  cleanups.push(browser.onAgentState(state => void follow(state)))
  // Opened again while a task of this tab's runs (or after it ended): pick it up.
  if (task && task.startTab?.id === page.tabId) {
    if (!turns.some(t => t.taskId === task.id)) turns.push({ question: task.objective, asked: task.objective, kind: 'task', sent: [], pending: true, taskId: task.id, at: task.startedAt })
    if (!FINISHED.includes(statusOf(task.status))) asking = true
    queueMicrotask(() => void follow(task))
  }
  // A task turn left waiting with no task behind it (the browser restarted): said so.
  for (const t of turns) if (t.pending && t.kind === 'task' && t.taskId !== task?.id) { delete t.pending; t.error = 'This task ended while the panel was closed, and its result was not kept. Ask again to run it again.' }
  const elsewhere = task && !FINISHED.includes(statusOf(task.status)) && task.startTab?.id !== page.tabId ? task : null

  question.addEventListener('input', () => { ready(); fit(); void keepTyping() })
  question.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    e.preventDefault()
    if (!askButton.disabled) form.requestSubmit()
  })
  const form = el('form', { class: 'composer', dataset: { composer: '' }, onsubmit: e => { e.preventDefault(); void ask(question.value) } },
    attached, errors,
    el('div', { class: 'ask-box' }, sr('Your question about this page', { htmlFor: 'question' }), question, askButton),
    el('div', { class: 'tools' }, blank ? null : selButton, blank ? null : shotButton, blank ? null : regionButton, chatOnly ? null : watchToggle, chatOnly ? null : keepToggle))

  const fresh = el('button', { class: 'link', type: 'button', dataset: { newConversation: '' }, title: 'Start again: Nova forgets this conversation' }, 'New conversation')
  fresh.addEventListener('click', async () => { if (asking || live) return; turns = []; locked = false; showLock(); await threads.clear(page.url, page.canonical); draw(); question.focus() })

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

  view.replaceChildren(...[
    el('section', { class: 'pagebar', ariaLabel: 'The page this conversation is about', dataset: { context: page.url } },
      el('span', { class: 'site', ariaHidden: 'true' }, siteInitial(page.domain)),
      el('div', { class: 'pagebar-text' }, el('p', { class: 'pagebar-title', title: page.title }, page.title), el('p', { class: 'small' }, page.domain)),
      el('div', { class: 'pagebar-tools' }, lock, fresh)),
    elsewhere ? el('div', { class: 'elsewhere small', role: 'status', dataset: { elsewhere: '' } },
      el('span', {}, `Nova is working on “${elsewhere.objective.slice(0, 60)}” in another tab.`),
      el('button', { class: 'link', type: 'button', onclick: () => void send('agent:show', { tab: elsewhere.startTab?.id }) }, 'Show'),
      el('button', { class: 'link', type: 'button', onclick: async e => { await send('agent:stop', { task: elsewhere.id }); await send('agent:dismiss'); e.target.closest('.elsewhere')?.remove() } }, 'Stop it')) : null,
    switchBar,
    scroller,
    form,
    el('footer', { class: 'panel-foot small' },
      el('button', { class: 'link ext', type: 'button', onclick: () => openNova('/notes/drafts') }, 'Drafts in Kivo'),
      keepNote)].filter(Boolean))

  if (typing.text) question.value = typing.text
  showAttached(); draw(); ready(); fit()
  requestAnimationFrame(() => toBottom(true))
  question.focus()
  const onHide = () => stopRegion?.()
  addEventListener('pagehide', onHide)
  // A task handed over from the popup's Do it for me starts at once.
  if (handoff.task && !handoff.taskStarted) { handoff.taskStarted = true; void browser.panelHandoffDone(page.tabId); queueMicrotask(() => void ask(String(handoff.task).slice(0, 1000), { forceTask: true })) }

  return {
    page,
    get pinned() { return pinned },
    hasTurns: () => turns.length > 0,
    busy: () => asking || Boolean(live),
    send: (text, opts) => ask(text, opts),
    retab(next) { if (next.tabId !== page.tabId) page.tabId = next.tabId; page.status = next.status },
    // "You moved to …": the user decides whether this conversation follows.
    offerSwitch(p, next) {
      pendingSwitch = next
      const title = next?.title || p?.title || 'another page'
      switchBar.hidden = false
      switchBar.replaceChildren(
        el('span', { class: 'switch-text' }, next ? `You moved to “${title.slice(0, 70)}”.` : p?.status === 'unknown' ? 'You switched to a tab Nova can’t see yet.' : 'You moved to a page Nova can’t read.'),
        next ? el('button', { class: 'link', type: 'button', dataset: { switchPage: '' }, onclick: () => void mount(next, {}) }, 'Switch to this page') : null,
        !next && p?.status === 'unknown' ? el('button', { class: 'link', type: 'button', dataset: { followTabs: '' }, onclick: async () => { if (await browser.followTabs()) await context?.refresh() } }, 'Let Nova follow my tabs') : null,
        el('button', { class: 'link', type: 'button', dataset: { stayPage: '' }, onclick: () => { pinned = true; switchBar.hidden = true } }, `Stay on “${page.title.slice(0, 30)}${page.title.length > 30 ? '…' : ''}”`))
    },
    dispose() { for (const c of cleanups) c(); removeEventListener('pagehide', onHide); stopRegion?.() },
  }
}

void start()

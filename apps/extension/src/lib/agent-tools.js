// Nova's hands in the browser: the operations the agent may use, each one
// checked before and verified after. The model proposes (server:
// browser-agent-rules.ts); this decides whether and how it happens.
//
//   where     only http(s) pages, never this machine or a private network,
//             never a browser or extension page. The learner's own tab the
//             task started on, tabs the agent opened itself (in the
//             background), and a tab the learner adds to the task.
//   access    a site is read or touched only with the browser's permission:
//             the tab Nova was opened on (activeTab), or a site the learner
//             allowed for this task from the panel (optional host access,
//             given back when the task ends). Anything else stops and asks
//             (needsAccess): the learner decides, site by site or any site.
//   what      read, search, open, back and forward, scroll, wait, click,
//             fill text fields, choose menu options, set checkboxes and radio
//             buttons, press a key. Never into a password, payment or
//             one-time-code field. What has consequences waits for the
//             learner's OK (needsConfirmation): submitting a form, signing
//             in, buying, paying, posting, sending, deleting, downloading,
//             changing security or privacy settings, and putting text from
//             their Kivo notes into a website.
//   verified  an action is not assumed to have worked: a page must finish
//             loading at an http(s) address; a field must show what was
//             typed; a box must be checked; a click must change something or
//             say it did not; a finding must quote the page word for word.
//   watched   in watch mode (the learner's choice, on by default) the pages
//             Nova opens come to the front, and before each action a pointer
//             and a ring show the element and what Nova is about to do
//             (agent-page.js showAction); a slim bar says what it is doing.
//   recovery  an element gone from the page is found again by its role and
//             name once; a page that stops answering (a browser dialog) is
//             handed to the learner.
//
// Every result is { ok, result } with words for the model, plus an
// observation when there is a page to look at, or needsAccess / needsUser
// when the learner must act. check() says when an action waits for their OK.

import { actOn, clearOverlay, inspectTarget, observePage, readSearchResults, scrollPage, settleDom, showAction } from './agent-page.js'

export const PART_CHARS = 6_000
export const LOAD_TIMEOUT_MS = 20_000
export const SCRIPT_TIMEOUT_MS = 10_000
const SETTLE_MS = 600
// DuckDuckGo first (it keeps no profile of the searcher); Bing when it asks
// for a human check or finds nothing.
const SEARCH_URLS = [q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`]
// Words on a button that mean the click has consequences.
const RISKY = ['buy', 'purchase', 'checkout', 'check out', 'pay', 'place order', 'order now', 'subscribe', 'sign up', 'signup', 'register', 'create account', 'log in', 'login', 'sign in', 'signin', 'delete', 'remove', 'send', 'post', 'publish', 'submit', 'comment', 'reply', 'share', 'donate', 'book', 'reserve', 'confirm', 'unsubscribe', 'download', 'install', 'add to cart', 'follow', 'invite', 'transfer', 'withdraw', 'deactivate', 'close account', 'sign out', 'log out', 'logout', 'finish', 'end quiz', 'end test', 'turn in', 'hand in']
// …and on a link (navigation is ordinary; these are not).
const RISKY_LINKS = ['delete', 'remove', 'unsubscribe', 'buy', 'checkout', 'pay', 'purchase', 'sign out', 'log out', 'logout', 'cancel subscription', 'add to cart', 'deactivate']
// Settings that are the learner's security or privacy.
const SENSITIVE_SETTINGS = ['password', 'two-factor', '2fa', 'two factor', 'security', 'privacy', 'public', 'visibility', 'everyone', 'share', 'recovery', 'delete', 'api key', 'token', 'permission', 'admin', 'owner']
// A submit button that only moves through a form (a quiz's pages).
const NAVIGATIONAL = ['next', 'continue', 'previous', 'prev', 'back', 'go back', 'next question', 'next page', 'save and continue', 'skip']

export const ANY_SITE = ['https://*/*', 'http://*/*']

/** Whether an address may be opened by the agent at all. */
export function allowedUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return { ok: false, reason: 'That is not a web address.' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'Only ordinary web pages (http or https).' }
  if (u.username || u.password) return { ok: false, reason: 'Addresses with a login in them are not opened.' }
  const h = u.hostname.toLowerCase()
  const privateHost = h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' || h === '[::1]' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  if (privateHost) return { ok: false, reason: 'Pages on this computer or a private network are not opened.' }
  return { ok: true, url: u.href }
}

/** The browser's permission pattern for one site. */
export function sitePattern(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.hostname}/*` } catch { return null }
}
export const siteOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

/** arXiv's PDF is not readable from the page; its abstract page is. */
export function readableUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('arxiv.org') && u.pathname.startsWith('/pdf/')) { u.pathname = u.pathname.replace('/pdf/', '/abs/').replace(/\.pdf$/, ''); return u.href }
  } catch { /* as given */ }
  return url
}

const lower = s => String(s ?? '').toLowerCase()
const hasWord = (label, words) => words.some(w => label === w || label.startsWith(`${w} `) || label.endsWith(` ${w}`) || label.includes(` ${w} `))

/**
 * Why an action on this element needs the learner's say-so, null when it
 * does not, or 'never' when Kivo never does it.
 * @param {object} target inspectTarget's answer
 * @param {'click'|'fill'|'select'|'check'|'press'} action
 * @param {{ key?: string, checked?: boolean }} args
 */
export function needsConfirmation(target, action, args = {}) {
  if (!target?.exists) return null
  const label = lower(target.label).replace(/\s+/g, ' ').trim()
  if (target.secret && action !== 'click') return 'never'
  if (target.download) return 'It would download a file.'
  const submits = (action === 'click' && target.isSubmit) || (action === 'press' && args.key === 'Enter' && target.isField && target.form && !target.form.isSearch)
  if (submits && target.form && !target.form.isSearch) {
    if (target.form.hasPassword) return 'It would sign in with what is in this form.'
    if (target.form.hasPayment) return 'It would submit a payment form.'
    if (action === 'press' || !hasWord(label, NAVIGATIONAL) || hasWord(label, RISKY)) return `It would submit the form${label && action === 'click' ? ` ("${target.label}")` : ''}.`
    return null
  }
  if (action === 'click' && target.tag !== 'a' && hasWord(label, RISKY)) return `"${target.label}" could change something on that site.`
  if (action === 'click' && target.tag === 'a' && hasWord(label, RISKY_LINKS)) return `"${target.label}" could change something on that site.`
  if ((action === 'check' || action === 'select' || (action === 'click' && ['switch', 'checkbox'].includes(target.role))) && SENSITIVE_SETTINGS.some(w => label.includes(w))) return `It would change "${target.label}", a security or privacy setting.`
  return null
}

const squash = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
/** Whether `quote` is on the page, word for word (spacing, case and curly quotes aside). */
export function quoteOnPage(quote, pageText) {
  const q = squash(quote).replace(/^["'…. ]+|["'…. ]+$/g, '')
  return q.length >= 20 && squash(pageText).includes(q)
}

/**
 * Whether text the agent would put into a site carries the learner's own
 * Kivo material (a note or search result read in this task): any 60
 * characters of it, word for word. Then it waits for the learner, whatever
 * the page said.
 */
export function carriesPrivate(text, privateTexts, span = 60) {
  const t = squash(text)
  if (t.length < span || !privateTexts?.length) return false
  const pool = privateTexts.map(squash)
  for (let at = 0; at + span <= t.length; at += 20) {
    const piece = t.slice(at, at + span)
    if (pool.some(p => p.includes(piece))) return true
  }
  return false
}

/** A page's text, in parts the model can read one at a time. */
export function partsOf(text, size = PART_CHARS) {
  if (text.length <= size) return [text]
  const parts = []
  let at = 0
  while (at < text.length) {
    let end = Math.min(text.length, at + size)
    if (end < text.length) { const cut = text.lastIndexOf('\n', end); if (cut > at + size / 2) end = cut }
    parts.push(text.slice(at, end).trim())
    at = end
  }
  return parts.filter(Boolean)
}

/** Whether a scripting error means "no permission for this site" (rather than a browser page or a broken one). */
export const accessDenied = message => /cannot access|permission|host/i.test(String(message ?? '')) && !/chrome:|chrome-extension:|edge:|about:/i.test(String(message ?? ''))

/**
 * @param {{
 *   chrome: typeof chrome, windowId?: number,
 *   startTab?: { id: number, url: string, title: string } | null,
 *   restore?: { tabs: Array<[number, object]>, current: number | null, searchTab?: number | null } | null,
 *   privateTexts?: () => string[],
 *   watch?: () => boolean,
 *   now?: () => number,
 * }} deps
 */
export function createBrowserTools({ chrome, windowId, startTab = null, restore = null, privateTexts = () => [], watch = () => false, now = () => Date.now() }) {
  // The tabs of this task: id → { url, title, own, learners }.
  const tabs = new Map(restore?.tabs ?? [])
  let current = restore?.current ?? null
  let searchTab = restore?.searchTab ?? null
  let page = null   // { tab, url, title, headings, parts, links, elements, dialog, alerts, signIn, challenge, more, kind, fullText, fingerprint }
  if (startTab && !tabs.has(startTab.id)) { tabs.set(startTab.id, { url: startTab.url, title: startTab.title, own: false, learners: true }); current ??= startTab.id }

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  async function settled(tabId, timeoutMs = LOAD_TIMEOUT_MS) {
    const until = now() + timeoutMs
    await sleep(250)
    while (now() < until) {
      let tab
      try { tab = await chrome.tabs.get(tabId) } catch { return { ok: false, reason: 'The tab was closed.' } }
      if (tab.status === 'complete') { await sleep(SETTLE_MS); return { ok: true, tab } }
      await sleep(300)
    }
    return { ok: false, reason: 'The page did not finish loading in time.' }
  }
  // A script in the page, with a time limit: a page held by a browser dialog
  // (alert, confirm) never answers, and that is the learner's to deal with.
  async function run(tabId, func, args = [], timeoutMs = SCRIPT_TIMEOUT_MS) {
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), timeoutMs) })
    try {
      const [frame] = await Promise.race([chrome.scripting.executeScript({ target: { tabId }, func, args }), timeout])
      return frame?.result
    } finally { clearTimeout(timer) }
  }
  const tabUrl = async id => { try { return (await chrome.tabs.get(id)).url || '' } catch { return '' } }
  // Watch mode: what the learner sees on the tab before an action.
  const WATCH_PAUSE_MS = 550
  async function show(tabId, index, label) {
    if (!watch()) return
    try { await run(tabId, showAction, [index, label], 2000); await sleep(index === null ? 0 : WATCH_PAUSE_MS) } catch { /* the page will not take it: nothing to show */ }
  }
  const nameOf = index => { const e = page?.elements?.find(x => x.i === index) ?? page?.links?.find(x => x.i === index); return (e?.name ?? e?.text ?? '').slice(0, 50) }
  const LABEL = {
    click: a => `clicking ${nameOf(a.index) ? `“${nameOf(a.index)}”` : 'here'}`,
    fill: a => `typing “${String(a.text).slice(0, 30)}${String(a.text).length > 30 ? '…' : ''}”`,
    select: a => `choosing “${a.option}”`,
    check: a => `${a.checked === false ? 'clearing' : 'selecting'} ${nameOf(a.index) ? `“${nameOf(a.index)}”` : 'this'}`,
    press: a => `pressing ${a.key}`,
  }
  const askAccess = url => ({ ok: false, needsAccess: { site: siteOf(url), pattern: sitePattern(url), url }, result: `Nova needs the learner's permission to use ${siteOf(url)}.` })

  // A script that could not run: why, in the learner's terms.
  async function failure(err, tabId) {
    if (err?.timeout) return { ok: false, needsUser: { message: 'The page has stopped answering. It may be showing a browser dialog (a message or a question). Look at the tab, deal with it, then press Resume.', tab: tabId }, result: 'The page stopped answering (a browser dialog?).' }
    const url = await tabUrl(tabId)
    if (/error page/i.test(String(err?.message ?? '')) || url.startsWith('chrome-error:')) return { ok: false, result: 'The site could not be reached (the page did not load).' }
    if (accessDenied(err?.message) && allowedUrl(url).ok) return askAccess(url)
    return { ok: false, result: 'Kivo is not allowed to read that page (the browser or the site blocks it).' }
  }

  async function look(tabId, partNumber = 1) {
    const info = tabs.get(tabId)
    let raw
    try { raw = await run(tabId, observePage, [{ textMax: 80_000, elements: 90 }]) } catch (err) { return failure(err, tabId) }
    if (!raw) return { ok: false, result: 'The page could not be read.' }
    if (raw.isPdf) return { ok: false, result: 'This is a PDF, which Kivo cannot read from the browser. Look for an HTML version (an abstract page or documentation page).' }
    const parts = partsOf(raw.text || '')
    const part = Math.min(Math.max(1, partNumber), parts.length || 1)
    page = { tab: tabId, url: raw.url, title: raw.title, headings: raw.headings, parts, links: raw.links, elements: raw.elements, dialog: raw.dialog, alerts: raw.alerts, signIn: raw.signIn, challenge: raw.challenge, more: raw.more, kind: 'page', fullText: raw.text, fingerprint: raw.fingerprint }
    if (info) { info.url = raw.url; info.title = raw.title }
    await show(tabId, null, 'reading the page')
    return { ok: true, result: `Read part ${part} of ${parts.length} of "${raw.title}".`, observation: observation(part) }
  }
  function observation(part) {
    if (!page) return null
    return {
      tab: page.tab, url: page.url, title: page.title, headings: page.headings, text: page.parts[part - 1] ?? '', part, parts: page.parts.length,
      links: page.links, elements: page.elements ?? [], dialog: page.dialog ?? null, alerts: page.alerts ?? [], signIn: Boolean(page.signIn), challenge: Boolean(page.challenge), more: Boolean(page.more), kind: page.kind,
    }
  }

  /** Whether the browser lets Kivo into this site now (a site allowed for the task, or any site). */
  async function mayUse(url) {
    const pattern = sitePattern(url)
    if (!pattern || !chrome.permissions?.contains) return true
    try { return await chrome.permissions.contains({ origins: [pattern] }) } catch { return false }
  }

  async function goTo(url, { newTab = false } = {}) {
    const allowed = allowedUrl(readableUrl(url))
    if (!allowed.ok) return { ok: false, result: allowed.reason }
    if (!(await mayUse(allowed.url))) return askAccess(allowed.url)
    try {
      // The learner's own page is never navigated away by "open": a tab of Nova's is used.
      if (!newTab && current !== null && tabs.get(current)?.own && current !== searchTab) await chrome.tabs.update(current, { url: allowed.url })
      else { const tab = await chrome.tabs.create({ url: allowed.url, active: watch(), ...(typeof windowId === 'number' ? { windowId } : {}) }); tabs.set(tab.id, { url: allowed.url, title: '', own: true, learners: false }); current = tab.id }
      if (watch()) await chrome.tabs.update(current, { active: true })
    } catch { return { ok: false, result: 'The browser would not open that page.' } }
    const done = await settled(current)
    if (!done.ok) return { ok: false, result: done.reason }
    const landed = allowedUrl(done.tab.url || '')
    if (!landed.ok) return { ok: false, result: `The page did not open (${done.tab.url?.startsWith('chrome-error') ? 'the site could not be reached' : landed.reason}).` }
    return null
  }

  // After an action: the page settles (a load, or the DOM going quiet), then
  // is read again, and the result says whether anything changed.
  async function after(tabId, beforeUrl, beforePrint, words) {
    await sleep(150)
    let url = await tabUrl(tabId)
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab.status === 'loading' || url !== beforeUrl) { const done = await settled(tabId, 15_000); if (!done.ok) return { ok: false, result: done.reason }; url = done.tab.url || url }
      else await run(tabId, settleDom, [2500, ''], 4000).catch(() => undefined)
    } catch { return { ok: false, result: 'The tab was closed.' } }
    if (!allowedUrl(url).ok) return { ok: false, result: `${words}, and the tab went to a page Kivo does not use.` }
    const read = await look(tabId, 1)
    if (!read.ok) return { ...read, result: `${words}. Then: ${read.result}` }
    const moved = url !== beforeUrl
    const changed = moved || page?.fingerprint !== beforePrint
    return { ...read, result: `${words}${moved ? `; the page is now "${page.title}"` : changed ? '; the page changed' : '; nothing visible changed'}.` }
  }

  // The element an index named, found again by role and name if the page re-drew it.
  function sameElement(before, index) {
    const was = before?.find(e => e.i === index)
    if (!was || !page) return null
    const matches = (page.elements ?? []).filter(e => e.role === was.role && e.name === was.name && (e.group ?? '') === (was.group ?? ''))
    return matches.length === 1 ? matches[0].i : null
  }

  async function act(op, args) {
    if (current === null) return { ok: false, result: 'No page is open.' }
    const tabId = current
    const beforeUrl = await tabUrl(tabId)
    const beforePrint = page?.fingerprint
    const beforeElements = page?.elements
    await show(tabId, args.index ?? null, LABEL[op](args))
    let res
    try { res = await run(tabId, actOn, [args.index ?? null, op, args]) } catch (err) { return failure(err, tabId) }
    if (res?.stale) {
      // Re-drawn: look again and find the same element once.
      const read = await look(tabId, 1)
      if (!read.ok) return read
      const again = sameElement(beforeElements, args.index)
      if (again === null) return { ok: false, result: 'That element is not on the page any more. Look at the new ELEMENTS.', observation: read.observation }
      try { res = await run(tabId, actOn, [again, op, { ...args, index: again }]) } catch (err) { return failure(err, tabId) }
      if (res && !res.stale) res.recovered = again
    }
    if (res?.never) return { ok: false, result: res.reason }
    if (!res?.ok) {
      const read = await look(tabId, 1)
      return { ok: false, result: res?.reason ?? 'That did not work.', observation: read.observation }
    }
    const words = {
      click: 'Clicked',
      fill: `Typed into the field; it now shows "${String(res?.value ?? '').slice(0, 60)}"${res?.valid === false ? ` (the page says: ${res.message || 'invalid'})` : ''}`,
      select: `Chose "${res?.value ?? args.option}"`,
      check: res?.checked ? 'It is now checked' : 'It is now unchecked',
      press: `Pressed ${args.key}`,
    }[op] + (res?.recovered !== undefined ? ` (the page had re-drawn; found it again as ${res.recovered})` : '')
    return after(tabId, beforeUrl, beforePrint, words)
  }

  const tools = {
    tabList: () => [...tabs.entries()].map(([tab, t]) => ({ tab, url: t.url, title: t.title, learners: Boolean(t.learners) })),
    page: () => page,
    current: () => current,
    ownTabs: () => [...tabs.entries()].filter(([, t]) => t.own).map(([id]) => id),
    /** What to keep so a restarted worker can carry on. */
    snapshot: () => ({ tabs: [...tabs.entries()], current, searchTab }),
    /** A tab the learner put into the task. */
    adopt(tab) { if (tab && !tabs.has(tab.id)) tabs.set(tab.id, { url: tab.url, title: tab.title, own: false, learners: true }) },

    async search({ query }) {
      let raw = null, challenged = false
      for (const url of SEARCH_URLS) {
        const allowed = allowedUrl(url(query))
        if (!(await mayUse(allowed.url))) return askAccess(allowed.url)
        try {
          if (searchTab !== null && tabs.has(searchTab)) await chrome.tabs.update(searchTab, { url: allowed.url })
          else { const tab = await chrome.tabs.create({ url: allowed.url, active: watch(), ...(typeof windowId === 'number' ? { windowId } : {}) }); searchTab = tab.id; tabs.set(tab.id, { url: allowed.url, title: 'Search', own: true, learners: false }) }
          if (watch()) await chrome.tabs.update(searchTab, { active: true })
        } catch { continue }
        current = searchTab
        const done = await settled(searchTab)
        if (!done.ok) continue
        try { raw = await run(searchTab, readSearchResults) } catch { raw = null }
        if (raw?.results?.length) break
        challenged = challenged || Boolean(raw?.challenge)
      }
      // A human check is the learner's to pass, never the agent's.
      if (!raw?.results?.length && challenged) return { ok: false, needsUser: { message: 'The search site wants to check that a person is searching. Open the search tab, complete the check there, then come back and press Resume.', tab: searchTab }, result: 'The search site asked for a human check.' }
      if (!raw?.results?.length) return { ok: false, result: `No results for "${query}". Try other words.` }
      const text = raw.results.map(r => `(${r.i}) ${r.title}\n${r.href}\nSnippet (not verified): ${r.snippet}`).join('\n\n')
      page = { tab: searchTab, url: raw.url, title: `Search: ${query}`, headings: [], parts: [text], links: raw.results.map(r => ({ i: r.i, text: r.title, href: r.href })), elements: [], dialog: null, alerts: [], signIn: false, challenge: false, more: false, kind: 'search_results', fullText: '', fingerprint: raw.url }
      return { ok: true, result: `${raw.results.length} results for "${query}".`, observation: observation(1) }
    },

    async open({ url, newTab = false }) {
      const failed = await goTo(url, { newTab })
      if (failed) return failed
      return look(current, 1)
    },

    /** The page the task is on, read again (after the learner did something, or access was given). */
    async observe() {
      if (current === null) return { ok: false, result: 'No page is open.' }
      return look(current, 1)
    },

    async read({ part }) {
      if (current === null) return { ok: false, result: 'No page is open. Search or open one first.' }
      if (page && page.tab === current && page.kind === 'page' && part > 1 && part <= page.parts.length) {
        // The same page, not changed: no need to read it again.
        return { ok: true, result: `Part ${part} of ${page.parts.length} of "${page.title}".`, observation: observation(part) }
      }
      return look(current, part)
    },

    async scroll({ direction }) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      let moved
      try { moved = await run(current, scrollPage, [direction]) } catch (err) { return failure(err, current) }
      await sleep(900)
      const before = page?.fingerprint
      const read = await look(current, 1)
      if (read.ok && before === page?.fingerprint && !moved?.moved) return { ok: false, result: moved?.atEnd ? 'Already at the end of the page.' : 'Scrolling changed nothing.', observation: read.observation }
      return read
    },

    async wait({ seconds, text }) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      let res
      try { res = await run(current, settleDom, [seconds * 1000, text || ''], seconds * 1000 + 3000) } catch (err) { return failure(err, current) }
      const read = await look(current, 1)
      if (!read.ok) return read
      return { ...read, result: text ? (res?.found ? `"${text}" appeared.` : `"${text}" did not appear within ${seconds} s.`) : 'Waited for the page to settle.' }
    },

    back: () => tools.history('back'),
    forward: () => tools.history('forward'),
    async history(way) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      const before = await tabUrl(current)
      try { await (way === 'back' ? chrome.tabs.goBack(current) : chrome.tabs.goForward(current)) } catch { return { ok: false, result: `There is no page to go ${way} to.` } }
      const done = await settled(current, 15_000)
      if (!done.ok) return { ok: false, result: done.reason }
      if (!allowedUrl(done.tab.url || '').ok) return { ok: false, result: 'That page is not one Kivo uses.' }
      const read = await look(current, 1)
      return read.ok ? { ...read, result: done.tab.url === before ? `Nothing to go ${way} to.` : `Went ${way} to "${page.title}".` } : read
    },

    /** null: allowed. Otherwise why it waits for the learner, or 'never'. */
    async check(action) {
      const op = action.tool
      if (op === 'open') { let url = action.args.url || ''; try { url = decodeURIComponent(url) } catch { /* as given */ } return carriesPrivate(url, privateTexts()) ? 'The address would carry text from your Kivo notes to another site.' : null }
      if (!['click', 'fill', 'select', 'check', 'press'].includes(op) || current === null) return null
      if (op === 'fill' && carriesPrivate(action.args.text, privateTexts())) return `It would put text from your Kivo notes into ${siteOf(page?.url) || 'this site'}.`
      if (op === 'press' && action.args.key !== 'Enter') return null
      let target
      try { target = await run(current, inspectTarget, [action.args.index ?? -1]) } catch { return null }
      return needsConfirmation(target, op, action.args)
    },

    async click({ index }) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      let target
      try { target = await run(current, inspectTarget, [index]) } catch (err) { return failure(err, current) }
      // A link: its address is checked first; a link that opens a new tab is
      // opened in a tab of Nova's, so nothing escapes the task's tabs.
      const href = target?.href ?? page?.links?.find(l => l.i === index)?.href ?? null
      if (href && !href.startsWith('javascript:')) {
        const allowed = allowedUrl(href)
        if (!allowed.ok) return { ok: false, result: allowed.reason }
        if (!(await mayUse(allowed.url)) && siteOf(allowed.url) !== siteOf(page?.url)) return askAccess(allowed.url)
        if (target?.opensNewTab || !target?.exists) return tools.open({ url: allowed.url, newTab: Boolean(target?.opensNewTab) })
      }
      return act('click', { index })
    },
    fill: ({ index, text, submit }) => act('fill', { index, text, submit }),
    select: ({ index, option }) => act('select', { index, option }),
    setChecked: ({ index, checked }) => act('check', { index, checked }),
    press: ({ key, index }) => act('press', { key, index }),

    async switchTab({ tab }) {
      if (!tabs.has(tab)) return { ok: false, result: `Tab ${tab} is not part of this task. Its tabs: ${[...tabs.keys()].join(', ') || 'none'}.` }
      current = tab
      if (watch()) await chrome.tabs.update(tab, { active: true }).catch(() => undefined)
      return look(tab, 1)
    },
    async closeTab({ tab }) {
      if (!tabs.get(tab)?.own) return { ok: false, result: 'Nova closes only tabs it opened.' }
      await chrome.tabs.remove(tab).catch(() => undefined)
      tabs.delete(tab)
      if (searchTab === tab) searchTab = null
      if (current === tab) { current = [...tabs.keys()].pop() ?? null; page = null }
      if (current === null) return { ok: true, result: 'Closed the tab.' }
      const read = await look(current, 1)
      return { ...read, result: `Closed the tab. ${read.result}` }
    },

    /** Verifies a quote against the whole page it claims to come from. */
    verifyQuote(quote) {
      if (!page || page.kind !== 'page') return { ok: false, result: 'Quote only from a page you have opened and read, not from search results.' }
      return quoteOnPage(quote, page.fullText) ? { ok: true, source: { url: page.url, title: page.title } } : { ok: false, result: 'That quote is not on the current page word for word. Copy it exactly from the text.' }
    },

    /** Brings one of the task's tabs to the front, for the learner. */
    async showTab(tab) {
      if (!tabs.has(tab)) return false
      try { await chrome.tabs.update(tab, { active: true }); return true } catch { return false }
    },

    /** Takes the watch-mode overlay off every tab of the task. */
    async clearOverlays() {
      for (const id of tabs.keys()) await run(id, clearOverlay, [], 2000).catch(() => undefined)
    },

    async closeOwnTabs() {
      const own = tools.ownTabs()
      if (own.length) await chrome.tabs.remove(own).catch(() => undefined)
      for (const id of own) tabs.delete(id)
      searchTab = null
      if (current !== null && !tabs.has(current)) current = null
    },
  }
  return tools
}

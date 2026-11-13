// The research agent's hands: the browser operations it may use, each one
// checked before and verified after. The model proposes (server:
// research-agent-rules.ts); this decides whether and how it happens.
//
//   where      only http(s) pages, never this machine or a private network,
//              never a browser or extension page. Only tabs the agent opened
//              itself (in the background, beside the learner's own), plus the
//              learner's current page if they included it.
//   what       read, search, open, follow a link, scroll, type into a search
//              box. Never into a password field. Anything that would submit a
//              form other than a search, sign in, buy, post, send, delete,
//              subscribe or download stops and asks the learner first.
//   verified   an action is not assumed to have worked: a page must finish
//              loading at an http(s) address; a click must change the page or
//              the address; an extract must quote the page word for word.
//
// Every result is { ok, result } with words for the model, plus an
// observation when there is a page to look at.

import { clickTarget, inspectTarget, observePage, readSearchResults, scrollPage, typeInto } from './agent-page.js'

export const PART_CHARS = 6_000
export const LOAD_TIMEOUT_MS = 20_000
const SETTLE_MS = 700
// DuckDuckGo first (it keeps no profile of the searcher); Bing when it asks
// for a human check or finds nothing.
const SEARCH_URLS = [q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`]
const RISKY = ['buy', 'purchase', 'checkout', 'check out', 'pay', 'order', 'subscribe', 'sign up', 'signup', 'register', 'log in', 'login', 'sign in', 'signin', 'delete', 'remove', 'send', 'post', 'publish', 'submit', 'comment', 'reply', 'share', 'donate', 'book now', 'confirm', 'unsubscribe', 'download', 'install', 'add to cart', 'follow']

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

/** arXiv's PDF is not readable from the page; its abstract page is. */
export function readableUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('arxiv.org') && u.pathname.startsWith('/pdf/')) { u.pathname = u.pathname.replace('/pdf/', '/abs/').replace(/\.pdf$/, ''); return u.href }
  } catch { /* as given */ }
  return url
}

/** Why an action on this element needs the learner's say-so, or null. */
export function needsConfirmation(target, action) {
  if (!target?.exists) return null
  const label = (target.label || '').toLowerCase()
  if (target.download) return 'It would download a file.'
  if (action === 'type') {
    if (target.isPassword) return 'never'
    return target.isSearchBox ? null : `It would type into "${target.label || 'a field'}", which is not a search box.`
  }
  if (target.form && !target.form.isSearch && (target.isSubmit || target.form.hasPassword || target.form.hasPayment)) return `It would submit a form ("${target.label || 'button'}").`
  if (target.tag !== 'a' && RISKY.some(w => label === w || label.startsWith(`${w} `) || label.endsWith(` ${w}`) || label.includes(` ${w} `))) return `"${target.label}" could change something on that site.`
  if (target.tag === 'a' && target.href && !allowedUrl(target.href).ok) return 'It leads somewhere Kivo does not open.'
  return null
}

const squash = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
/** Whether `quote` is on the page, word for word (spacing, case and curly quotes aside). */
export function quoteOnPage(quote, pageText) {
  const q = squash(quote).replace(/^["'…. ]+|["'…. ]+$/g, '')
  return q.length >= 20 && squash(pageText).includes(q)
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

/**
 * @param {{ chrome: typeof chrome, windowId?: number, startTab?: { id: number, url: string, title: string } | null, now?: () => number }} deps
 */
export function createBrowserTools({ chrome, windowId, startTab = null, now = () => Date.now() }) {
  // The agent's own tabs (and the learner's page, if they included it): id → what it shows.
  const tabs = new Map()
  let current = null
  let page = null   // { tab, url, title, headings, parts, links, controls, kind, fullText, fingerprint }
  if (startTab) { tabs.set(startTab.id, { url: startTab.url, title: startTab.title, own: false }); current = startTab.id }

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
  const run = async (tabId, func, args = []) => {
    const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
    return frame?.result
  }

  async function look(tabId, partNumber = 1) {
    const info = tabs.get(tabId)
    let raw
    try { raw = await run(tabId, observePage, [{ textMax: 80_000 }]) } catch { return { ok: false, result: 'Kivo is not allowed to read that page (the browser or the site blocks it).' } }
    if (!raw) return { ok: false, result: 'The page could not be read.' }
    if (raw.isPdf) return { ok: false, result: 'This is a PDF, which Kivo cannot read from the browser. Look for an HTML version (an abstract page or documentation page).' }
    const parts = partsOf(raw.text || '')
    const part = Math.min(Math.max(1, partNumber), parts.length || 1)
    page = { tab: tabId, url: raw.url, title: raw.title, headings: raw.headings, parts, links: raw.links, controls: raw.controls, kind: 'page', fullText: raw.text, fingerprint: raw.fingerprint }
    if (info) { info.url = raw.url; info.title = raw.title }
    return { ok: true, result: `Read part ${part} of ${parts.length} of "${raw.title}".`, observation: observation(part) }
  }
  function observation(part) {
    if (!page) return null
    return { tab: page.tab, url: page.url, title: page.title, headings: page.headings, text: page.parts[part - 1] ?? '', part, parts: page.parts.length, links: page.links, controls: page.controls, kind: page.kind }
  }

  async function navigate(url) {
    const allowed = allowedUrl(readableUrl(url))
    if (!allowed.ok) return { ok: false, result: allowed.reason }
    try {
      if (current !== null && tabs.get(current)?.own) await chrome.tabs.update(current, { url: allowed.url })
      else { const tab = await chrome.tabs.create({ url: allowed.url, active: false, ...(typeof windowId === 'number' ? { windowId } : {}) }); tabs.set(tab.id, { url: allowed.url, title: '', own: true }); current = tab.id }
    } catch { return { ok: false, result: 'The browser would not open that page.' } }
    const done = await settled(current)
    if (!done.ok) return { ok: false, result: done.reason }
    const landed = allowedUrl(done.tab.url || '')
    if (!landed.ok) return { ok: false, result: `The page did not open (${done.tab.url?.startsWith('chrome-error') ? 'the site could not be reached' : landed.reason}).` }
    return null
  }

  const tools = {
    tabList: () => [...tabs.entries()].map(([tab, t]) => ({ tab, url: t.url, title: t.title })),
    page: () => page,
    ownTabs: () => [...tabs.entries()].filter(([, t]) => t.own).map(([id]) => id),

    async search({ query }) {
      let raw = null, challenged = false
      for (const url of SEARCH_URLS) {
        const failed = await navigate(url(query))
        if (failed) continue
        try { raw = await run(current, readSearchResults) } catch { raw = null }
        if (raw?.results?.length) break
        challenged = challenged || Boolean(raw?.challenge)
      }
      // A human check is the learner's to pass, never the agent's.
      if (!raw?.results?.length && challenged) return { ok: false, needsUser: { message: 'The search site wants to check that a person is searching. Open the search tab, complete the check there, then come back and press Resume.', tab: current }, result: 'The search site asked for a human check.' }
      if (!raw?.results?.length) return { ok: false, result: `No results for "${query}". Try other words.` }
      const text = raw.results.map(r => `(${r.i}) ${r.title}\n${r.href}\nSnippet (not verified): ${r.snippet}`).join('\n\n')
      page = { tab: current, url: raw.url, title: `Search: ${query}`, headings: [], parts: [text], links: raw.results.map(r => ({ i: r.i, text: r.title, href: r.href })), controls: [], kind: 'search_results', fullText: '', fingerprint: raw.url }
      return { ok: true, result: `${raw.results.length} results for "${query}".`, observation: observation(1) }
    },

    async open({ url }) {
      const failed = await navigate(url)
      if (failed) return failed
      return look(current, 1)
    },

    async read({ part }) {
      if (current === null) return { ok: false, result: 'No page is open. Search or open one first.' }
      if (page && page.tab === current && page.kind === 'page' && part <= page.parts.length) {
        // The same page, not changed: no need to read it again.
        return { ok: true, result: `Part ${part} of ${page.parts.length} of "${page.title}".`, observation: observation(part) }
      }
      return look(current, part)
    },

    async scroll({ direction }) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      let moved
      try { moved = await run(current, scrollPage, [direction]) } catch { return { ok: false, result: 'That page cannot be scrolled by Kivo.' } }
      await sleep(900)
      const before = page?.fingerprint
      const read = await look(current, 1)
      if (read.ok && before === page?.fingerprint && !moved?.moved) return { ok: false, result: moved?.atEnd ? 'Already at the end of the page.' : 'Scrolling changed nothing.', observation: read.observation }
      return read
    },

    /** null: allowed. Otherwise why it waits for the learner (or 'never'). */
    async check(action) {
      if ((action.tool === 'click' || action.tool === 'type') && current !== null) {
        let target
        try { target = await run(current, inspectTarget, [action.args.index]) } catch { return null }
        return needsConfirmation(target, action.tool)
      }
      return null
    },

    async click({ index }) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      const link = page?.links.find(l => l.i === index)
      // A link the agent can open itself: opened, not clicked, so the page
      // stays in the agent's own tab and is checked like any other address.
      if (link) return tools.open({ url: link.href })
      const before = page?.fingerprint
      let res
      try { res = await run(current, clickTarget, [index]) } catch { return { ok: false, result: 'Kivo cannot click on that page.' } }
      if (!res?.ok) return { ok: false, result: res?.reason ?? 'That click did not work.' }
      const done = await settled(current, 10_000)
      if (!done.ok) return { ok: false, result: done.reason }
      const read = await look(current, 1)
      if (read.ok && before === page?.fingerprint) return { ok: false, result: 'The click changed nothing on the page.', observation: read.observation }
      return read
    },

    async type({ index, text, submit }) {
      if (current === null) return { ok: false, result: 'No page is open.' }
      let res
      try { res = await run(current, typeInto, [index, text, submit]) } catch { return { ok: false, result: 'Kivo cannot type on that page.' } }
      if (!res?.ok) return { ok: false, result: res?.reason ?? 'That did not work.' }
      const done = await settled(current, 12_000)
      if (!done.ok) return { ok: false, result: done.reason }
      return look(current, 1)
    },

    async switchTab({ tab }) {
      if (!tabs.has(tab)) return { ok: false, result: `Tab ${tab} is not one Kivo opened. Its tabs: ${[...tabs.keys()].join(', ') || 'none'}.` }
      current = tab
      return look(tab, 1)
    },

    /** Verifies a quote against the whole page it claims to come from. */
    verifyQuote(quote) {
      if (!page || page.kind !== 'page') return { ok: false, result: 'Quote only from a page you have opened and read, not from search results.' }
      return quoteOnPage(quote, page.fullText) ? { ok: true, source: { url: page.url, title: page.title } } : { ok: false, result: 'That quote is not on the current page word for word. Copy it exactly from the text.' }
    },

    /** Brings one of the agent's own tabs to the front, for the learner. */
    async showTab(tab) {
      if (!tabs.get(tab)?.own) return false
      try { await chrome.tabs.update(tab, { active: true }); return true } catch { return false }
    },

    async closeOwnTabs() {
      const own = tools.ownTabs()
      if (own.length) await chrome.tabs.remove(own).catch(() => undefined)
      for (const id of own) tabs.delete(id)
      if (current !== null && !tabs.has(current)) current = null
    },
  }
  return tools
}

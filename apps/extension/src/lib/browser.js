// The browser, as the extension uses it. This is the only file that calls the
// browser's extension API, so it is the whole list of what the extension can
// ask a browser to do:
//
//   chrome.storage.local             keep this browser's Nova credential
//   chrome.tabs.query                which tab the popup was opened on
//   chrome.tabs.create               open Nova in a new tab
//   chrome.scripting.executeScript   read the selected text and the canonical
//                                    link of that one tab, once, as the popup opens
//   chrome.scripting.executeScript   also draws the area selector (region-overlay.js)
//                                    on that tab, when they press Select area
//   chrome.tabs.captureVisibleTab    a picture of what that tab is showing, only
//                                    when the learner presses Screenshot
//   chrome.storage.session           the area they selected, until this popup takes it
//   chrome.action.setBadgeText       clears the mark on the icon when it is taken
//
// background.js is the only other file that calls it, for one job: taking the
// picture of a selected area once the popup has closed.
//
// Chrome, Edge, Brave, Arc and Safari all provide these under `chrome`, so
// there is one adapter and no per-browser branch. A browser that lacks the
// scripting call simply has no selection to offer: saving a page still works.
//
// There is no content script. Two things ever run inside a page, both because
// the learner clicked the Nova button on that tab (activeTab), never on any
// other tab: `probePage` below, and the area selector when they ask for it. The
// screenshot needs no permission beyond that click either: activeTab is what
// lets an extension capture the tab it was opened on, and nothing else.

import { REGION_SHOT_KEY, freshShot } from './region.js'
import { observePage } from './agent-page.js'
import { ANY_SITE } from './agent-tools.js'

const SELECTION_READ_MAX = 4200   // enough to tell "too long" from "fits"
const ADDRESS_MAX        = 2048

// Runs inside the page. It must not use anything from this file: the browser
// copies the function's text into the page. It returns the text the learner
// has selected, the address the page gives as its canonical one, and what the
// page publicly says about itself in its metadata tags (description, preview
// image, author, dates, type, a video's length: <meta> tags and JSON-LD), so
// Saved can show what the page is (1.3.0). It reads nothing else: no page
// text, no forms, no cookies, no storage.
export function probePage() {
  const selected  = window.getSelection ? String(window.getSelection()) : ''
  const canonical = document.querySelector('link[rel~="canonical"][href]')
  const tag = selectors => {
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      const value = el && (el.getAttribute('content') || el.getAttribute('href'))
      if (value) return value.slice(0, 1000)
    }
    return ''
  }
  const types = []
  const ogType = tag(['meta[property="og:type"]'])
  if (ogType) types.push(ogType)
  let published = '', author = '', duration = ''
  // JSON-LD: the page's structured description of itself. Its type, dates, author, length.
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 4)) {
    let data
    try { data = JSON.parse(String(script.textContent).slice(0, 100000)) } catch { continue }
    const items = [].concat(data && data['@graph'] ? data['@graph'] : data).slice(0, 8)
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      for (const t of [].concat(item['@type'] || [])) if (typeof t === 'string') types.push(t)
      if (!published && typeof item.datePublished === 'string') published = item.datePublished
      if (!duration && typeof item.duration === 'string') duration = item.duration
      const by = [].concat(item.author || [])[0]
      if (!author && by) author = typeof by === 'string' ? by : typeof by.name === 'string' ? by.name : ''
    }
  }
  return {
    selection: selected.slice(0, 4200), canonical: canonical ? canonical.href : null,
    meta: {
      description: tag(['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']),
      imageUrl: tag(['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]']),
      author: author || tag(['meta[name="author"]', 'meta[name="citation_author"]', 'span[itemprop="author"] link[itemprop="name"]', 'meta[property="article:author"]']),
      siteName: tag(['meta[property="og:site_name"]', 'meta[name="application-name"]']),
      publishedAt: published || tag(['meta[property="article:published_time"]', 'meta[name="citation_publication_date"]', 'meta[itemprop="datePublished"]', 'meta[name="date"]']),
      duration: duration || tag(['meta[itemprop="duration"]']),
      types: types.slice(0, 12),
      citation: Boolean(document.querySelector('meta[name="citation_title"]')),
    },
  }
}

// What a page said about itself, kept to its fields and their sizes. The
// server checks it again (resource-meta.ts readPageMeta).
function readMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {}
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const meta = {
    description: text(m.description, 500), imageUrl: text(m.imageUrl, 1000), author: text(m.author, 200), siteName: text(m.siteName, 120),
    publishedAt: text(m.publishedAt, 40), duration: text(m.duration, 40),
    types: Array.isArray(m.types) ? m.types.filter(t => typeof t === 'string' && t.length <= 60).slice(0, 6) : [],
    citation: m.citation === true,
  }
  for (const k of Object.keys(meta)) if (meta[k] === '' || (Array.isArray(meta[k]) && meta[k].length === 0)) delete meta[k]
  if (meta.citation === false) delete meta.citation
  return Object.keys(meta).length ? meta : null
}

/**
 * What the probe returned, as data the popup can trust the shape of.
 * @param {unknown} raw
 * @param {number} max the longest passage Nova keeps
 * @returns {{ available: true, selection: string, tooLong: boolean, canonicalUrl: string | null, meta: object | null }}
 */
export function readProbe(raw, max) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const text  = typeof value.selection === 'string' ? value.selection.trim() : ''
  let canonicalUrl = null
  if (typeof value.canonical === 'string' && value.canonical.length <= ADDRESS_MAX) {
    try {
      const url = new URL(value.canonical)
      if (url.protocol === 'http:' || url.protocol === 'https:') { url.hash = ''; url.username = ''; url.password = ''; canonicalUrl = url.toString() }
    } catch { /* not an address: left out */ }
  }
  const tooLong = text.length > max
  return { available: true, selection: tooLong ? '' : text, tooLong, canonicalUrl, meta: readMeta(value.meta) }
}

// Where the worker keeps the agent's task (lib/agent.js STATE_KEY).
const AGENT_STATE = 'kivo.agent'

export const NO_PROBE = { available: false, selection: '', tooLong: false, canonicalUrl: null, meta: null }

// The side panel's page for one tab, and what the popup hands it.
const PANEL_PAGE = 'sidepanel.html'
const HANDOFF = tabId => `nova.panel:${tabId}`
const PANEL_REGION = 'novaPanelRegion'

export const browser = {
  storage: () => chrome.storage.local,
  // In memory only, gone when the browser quits; for the conversation (thread.js).
  session: () => chrome.storage.session,

  /** Whether this browser has a side panel (Chrome 116+; not Safari). */
  panelAvailable: () => Boolean(globalThis.chrome?.sidePanel?.open),

  /**
   * Opens Nova's side panel beside the page, for the window, so it stays open
   * when the user switches tabs and follows the page they are on
   * (lib/page-context.js). It must run straight from the user's click (the
   * browser allows it only then), so nothing is awaited first. false: not opened.
   * @param {number} tabId the tab it was opened from
   * @param {object} handoff the page, the selection, and a task waiting to start, if any
   */
  openPanel(tabId, handoff) {
    if (typeof tabId !== 'number' || !globalThis.chrome?.sidePanel?.open) return false
    try {
      const windowId = handoff?.windowId
      void chrome.sidePanel.setOptions({ path: `${PANEL_PAGE}?tab=${tabId}`, enabled: true })
      const opening = typeof windowId === 'number' ? chrome.sidePanel.open({ windowId }) : chrome.sidePanel.open({ tabId })
      void chrome.storage.session.set({ [HANDOFF(tabId)]: { ...handoff, at: Date.now() } })
      return opening.then(() => true, () => false)
    } catch {
      return false
    }
  },

  /** The window this page (the side panel) is in. */
  async ownWindow() { try { return (await chrome.windows.getCurrent())?.id ?? null } catch { return null } },
  /** A tab as the browser shows it to Nova: no address or title unless Nova may see that site, or follows tabs. */
  async tab(tabId) { try { return await chrome.tabs.get(tabId) } catch { return null } },
  async activeTabIn(windowId) { try { const [t] = await chrome.tabs.query({ active: true, ...(typeof windowId === 'number' ? { windowId } : { currentWindow: true }) }); return t ?? null } catch { return null } },
  /** Tab switches and page changes in the panel's window. Returns a function that stops listening. */
  onTabsChanged(windowId, onChange) {
    const activated = info => { if (typeof windowId !== 'number' || info.windowId === windowId) onChange({ kind: 'switched', tabId: info.tabId }) }
    const updated = (tabId, change, tab) => { if ((typeof windowId !== 'number' || tab?.windowId === windowId) && (change.status === 'complete' || change.url || change.title)) onChange({ kind: 'changed', tabId }) }
    chrome.tabs.onActivated.addListener(activated)
    chrome.tabs.onUpdated.addListener(updated)
    return () => { chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated) }
  },
  /** Whether Nova may run inside this tab now (activeTab from a click, or an allowed site). */
  async canRead(tabId) {
    try { await chrome.scripting.executeScript({ target: { tabId }, func: () => true }); return true } catch { return false }
  },
  /** The page's text, as the agent reads it, for a question answered from the page. Null when not allowed. */
  async readPageText(tabId, max = 24_000) {
    try {
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: observePage, args: [{ textMax: max + 1, elements: 0 }] })
      const r = frame?.result
      if (!r || r.isPdf) return null
      return { text: String(r.text ?? '').slice(0, max), complete: String(r.text ?? '').length <= max, url: r.url, title: r.title }
    } catch { return null }
  },

  // ── Which sites Nova may use, kept until the user removes them ──────────────
  /** Sites the user allowed (Chrome's optional host access), and whether "any site" is on now. */
  async allowedSites() {
    try {
      const { origins = [], permissions = [] } = await chrome.permissions.getAll()
      const wide = o => ANY_SITE.includes(o) || o === '<all_urls>'
      return { sites: origins.filter(o => !wide(o) && !o.startsWith('*')), anySite: origins.some(wide), followTabs: permissions.includes('tabs') }
    } catch { return { sites: [], anySite: false, followTabs: false } }
  },
  removeAnySite: () => (chrome.permissions?.remove ? chrome.permissions.remove({ origins: ANY_SITE }).catch(() => false) : Promise.resolve(false)),
  removeSites: origins => (chrome.permissions?.remove ? chrome.permissions.remove({ origins }).catch(() => false) : Promise.resolve(false)),
  /** Lets Nova see which page each tab shows, so the panel can follow the user (Chrome asks; optional). */
  followTabs: () => (chrome.permissions?.request ? chrome.permissions.request({ permissions: ['tabs'] }).catch(() => false) : Promise.resolve(false)),
  stopFollowingTabs: () => (chrome.permissions?.remove ? chrome.permissions.remove({ permissions: ['tabs'] }).catch(() => false) : Promise.resolve(false)),
  async followsTabs() { try { return await chrome.permissions.contains({ permissions: ['tabs'] }) } catch { return false } },
  onPermissionsChanged(onChange) {
    if (!chrome.permissions?.onAdded) return () => {}
    chrome.permissions.onAdded.addListener(onChange); chrome.permissions.onRemoved.addListener(onChange)
    return () => { chrome.permissions.onAdded.removeListener(onChange); chrome.permissions.onRemoved.removeListener(onChange) }
  },
  /** Whether to keep the tabs Nova opens after a task (off unless the user turns it on). */
  async keepTabsPreference() { try { return (await chrome.storage.local.get('nova.keepTabs'))?.['nova.keepTabs'] === true } catch { return false } },
  setKeepTabsPreference: on => chrome.storage.local.set({ 'nova.keepTabs': Boolean(on) }).catch(() => undefined),

  /** Where there is no side panel (Safari): the same page opens in the popup. */
  async handOffInline(tabId, handoff) {
    try { await chrome.storage.session.set({ [HANDOFF(tabId)]: { ...handoff, at: Date.now() } }); return `${PANEL_PAGE}?tab=${tabId}&inline=1` } catch { return null }
  },

  /** A task handed over is started once: taken out of the hand-off. */
  async panelHandoffDone(tabId) {
    const key = HANDOFF(tabId)
    try { const v = (await chrome.storage.session.get(key))?.[key]; if (v?.task) { const { task: _done, ...rest } = v; await chrome.storage.session.set({ [key]: rest }) } } catch { /* nothing to clear */ }
  },
  /** A hand-off from the popup while the panel is already open (Chat → Do it for me, Ask on another page). */
  onHandoff(onHandoff) {
    const listen = (changes, area) => {
      if (area !== 'session') return
      for (const [key, change] of Object.entries(changes)) if (key.startsWith('nova.panel:') && change.newValue?.at) onHandoff(Number(key.slice('nova.panel:'.length)), change.newValue)
    }
    chrome.storage.onChanged.addListener(listen)
    return () => chrome.storage.onChanged.removeListener(listen)
  },

  /** What the popup handed this tab's panel. Waits a moment for it to arrive. */
  async panelHandoff(tabId) {
    const key = HANDOFF(tabId)
    const read = async () => (await chrome.storage.session.get(key).catch(() => ({})))?.[key] ?? null
    const now = await read()
    if (now) return now
    return new Promise(resolve => {
      const done = value => { chrome.storage.onChanged.removeListener(listen); clearTimeout(timer); resolve(value) }
      const listen = (changes, area) => { if (area === 'session' && changes[key]?.newValue) done(changes[key].newValue) }
      const timer = setTimeout(() => void read().then(done), 2500)
      chrome.storage.onChanged.addListener(listen)
    })
  },

  /**
   * In the panel: Select area, then the picture comes back here instead of
   * to the popup. Returns a function that stops waiting.
   * @param {number} tabId
   * @param {(shot: object) => void} onShot
   */
  waitForRegion(tabId, onShot) {
    void chrome.storage.session.set({ [PANEL_REGION]: tabId })
    const listen = (changes, area) => {
      if (area !== 'session' || !changes[REGION_SHOT_KEY]?.newValue) return
      void browser.takeRegionShot(tabId).then(shot => { if (shot) { stop(); onShot(shot) } })
    }
    const stop = () => { chrome.storage.onChanged.removeListener(listen); void chrome.storage.session.remove(PANEL_REGION) }
    chrome.storage.onChanged.addListener(listen)
    return stop
  },

  // ── Nova's browser agent, run by the background worker (lib/agent-runtime.js) ──
  /** The task's state as the worker saved it, or null. */
  async agentState() {
    try { return (await chrome.storage.session.get(AGENT_STATE))?.[AGENT_STATE] ?? null } catch { return null }
  },
  /** Calls `onState` whenever the worker saves the task. Returns a function that stops listening. */
  onAgentState(onState) {
    const listen = (changes, area) => { if (area === 'session' && changes[AGENT_STATE]?.newValue) onState(changes[AGENT_STATE].newValue) }
    chrome.storage.onChanged.addListener(listen)
    return () => chrome.storage.onChanged.removeListener(listen)
  },
  /** One message to the worker (agent:begin, agent:pause, …); null when it does not answer. */
  agentSend: (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload }).catch(() => null),
  /** Asks the browser to let Nova use these sites, straight from the learner's click. */
  allowSites: origins => (chrome.permissions?.request ? chrome.permissions.request({ origins }).catch(() => false) : Promise.resolve(false)),
  /** Whether the learner watches Nova work (on unless they turned it off). */
  async watchPreference() { try { return (await chrome.storage.local.get('nova.watch'))?.['nova.watch'] !== false } catch { return true } },
  setWatchPreference: on => chrome.storage.local.set({ 'nova.watch': Boolean(on) }).catch(() => undefined),
  /** Closes tabs Nova opened for a task. */
  closeTabs: ids => chrome.tabs.remove(ids).catch(() => undefined),

  /** The tab the popup was opened on, or null. */
  async activeTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return tab ?? null
    } catch {
      return null
    }
  },

  openTab: url => chrome.tabs.create({ url }),

  /**
   * What the tab in this window is showing, as a JPEG data URL, or null when
   * the browser will not allow it. The popup is not in the picture.
   * @param {number | undefined} windowId
   */
  async captureTab(windowId) {
    try {
      const shot = await chrome.tabs.captureVisibleTab(typeof windowId === 'number' ? windowId : undefined, { format: 'jpeg', quality: 90 })
      return typeof shot === 'string' && shot.startsWith('data:image/') ? shot : null
    } catch {
      return null
    }
  },

  /**
   * Draws the area selector on the tab. false: the browser won't allow it here.
   * @param {number | undefined} tabId
   */
  async startRegion(tabId) {
    if (typeof tabId !== 'number' || !globalThis.chrome?.scripting) return false
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['region-overlay.js'] })
      return true
    } catch {
      return false
    }
  },

  // What they had typed when they stepped aside to select an area.
  async keepQuestion(text) {
    try { await chrome.storage.session.set({ novaRegionQuestion: text }) } catch { /* it is only typing */ }
  },
  async takeQuestion() {
    try {
      const { novaRegionQuestion: text } = await chrome.storage.session.get('novaRegionQuestion')
      if (text) await chrome.storage.session.remove('novaRegionQuestion')
      return typeof text === 'string' ? text : ''
    } catch {
      return ''
    }
  },

  /**
   * The area selected on this tab, if one is waiting. Taking it removes it.
   * @param {number | undefined} tabId
   */
  async takeRegionShot(tabId) {
    if (!globalThis.chrome?.storage?.session) return null
    try {
      const { [REGION_SHOT_KEY]: stored } = await chrome.storage.session.get(REGION_SHOT_KEY)
      if (stored) await chrome.storage.session.remove(REGION_SHOT_KEY)
      if (typeof tabId === 'number') void chrome.action?.setBadgeText?.({ tabId, text: '' })
      return freshShot(stored, tabId)
    } catch {
      return null
    }
  },

  /**
   * The selection and canonical link of one tab. Never throws: a page the
   * browser will not let an extension into answers "not available".
   * @param {number | undefined} tabId
   * @param {number} max
   */
  async readPage(tabId, max) {
    if (typeof tabId !== 'number' || !globalThis.chrome?.scripting) return NO_PROBE
    try {
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: probePage })
      return readProbe(frame?.result, max)
    } catch {
      return NO_PROBE
    }
  },
}

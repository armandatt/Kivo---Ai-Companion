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

const SELECTION_READ_MAX = 4200   // enough to tell "too long" from "fits"
const ADDRESS_MAX        = 2048

// Runs inside the page. It must not use anything from this file: the browser
// copies the function's text into the page. It returns the text the learner
// has selected and the address the page gives as its canonical one, and reads
// nothing else: no page text, no forms, no cookies, no storage.
export function probePage() {
  const selected  = window.getSelection ? String(window.getSelection()) : ''
  const canonical = document.querySelector('link[rel~="canonical"][href]')
  return { selection: selected.slice(0, 4200), canonical: canonical ? canonical.href : null }
}

/**
 * What the probe returned, as data the popup can trust the shape of.
 * @param {unknown} raw
 * @param {number} max the longest passage Nova keeps
 * @returns {{ available: true, selection: string, tooLong: boolean, canonicalUrl: string | null }}
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
  return { available: true, selection: tooLong ? '' : text, tooLong, canonicalUrl }
}

export const NO_PROBE = { available: false, selection: '', tooLong: false, canonicalUrl: null }

export const browser = {
  storage: () => chrome.storage.local,

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

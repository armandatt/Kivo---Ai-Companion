// What Nova takes from a tab when the learner opens the popup on it: the
// address, the title and the site. Nothing is read from inside the page:
// no text, no form fields, no cookies. There is no content script.
//
// An adapter turns a tab into that small description. V1 has one, for any
// ordinary web page. A site-specific adapter (a video, a coding problem)
// would be added to ADAPTERS with its own `matches`; nothing else changes.

/** @typedef {{ url?: string, title?: string }} Tab */
/** @typedef {{ supported: true, url: string, title: string, domain: string, kind: string } | { supported: false, reason: 'no_page' | 'not_a_web_page' }} PageContext */

const TITLE_MAX = 300

const genericPage = {
  kind: 'page',
  matches: () => true,
  /** @param {URL} url @param {Tab} tab */
  describe: (url, tab) => ({ title: cleanTitle(tab.title) || hostOf(url) }),
}

// First match wins; the generic adapter is last and matches everything.
export const ADAPTERS = [genericPage]

const hostOf = url => (url.hostname.startsWith('www.') ? url.hostname.slice(4) : url.hostname)

export function cleanTitle(title) {
  return typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : ''
}

/** @param {Tab | null | undefined} tab @returns {PageContext} */
export function describePage(tab) {
  if (!tab || typeof tab.url !== 'string' || tab.url === '') return { supported: false, reason: 'no_page' }
  let url
  try { url = new URL(tab.url) } catch { return { supported: false, reason: 'not_a_web_page' } }
  // Browser pages, files, extensions: not something to save to a study list.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { supported: false, reason: 'not_a_web_page' }

  const adapter = ADAPTERS.find(a => a.matches(url))
  // The address is sent without its fragment or any login it carries. The
  // server cleans it again; it does not rely on this.
  url.hash = ''; url.username = ''; url.password = ''
  return { supported: true, url: url.toString(), domain: hostOf(url), kind: adapter.kind, ...adapter.describe(url, tab) }
}

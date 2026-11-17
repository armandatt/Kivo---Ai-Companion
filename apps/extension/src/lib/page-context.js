// The page the user is on, for the side panel: the one place that knows.
//
// The panel stays open beside every tab of its window, so the page it talks
// about must follow the user: a link followed in the same tab, a switch to
// another tab, a page that finished loading. This listens to the browser for
// exactly those (tab switched, tab changed, window focused) and resolves the
// active tab to one of:
//
//   ready        the address and title are known and Nova may read the page
//                (the click that opened Nova on it, or a site the user allowed)
//   no_access    the address is known, Nova may not read it yet: "Allow Nova
//                on this site" (the browser asks the user)
//   unknown      the browser does not tell Nova which page this is: Nova was
//                not opened on it and does not follow tabs. Clicking Nova in
//                the toolbar on it, or letting Nova follow tabs (an optional
//                permission the user grants), makes it known.
//   unsupported  a browser page, a file, the extension store: nothing to read
//
// Tabs that a running task opened are the agent's, not a move by the user:
// they are skipped (isAgentTab). Each resolution carries `at` and the tab's
// id, so a page read earlier is known to be stale when the tab has changed
// since (`version` counts the changes seen).

const HTTP = url => typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))
export const siteFrom = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
export const patternFrom = url => { try { const u = new URL(url); return `${u.protocol}//${u.hostname}/*` } catch { return null } }

/** What the browser's answer about a tab means for Nova. Pure. */
export function describeTab(tab, readable) {
  if (!tab) return { status: 'unknown', tabId: null, url: null, title: '', site: '' }
  const base = { tabId: tab.id, title: String(tab.title ?? ''), url: tab.url ?? tab.pendingUrl ?? null }
  if (!base.url) return { ...base, status: readable ? 'ready_untitled' : 'unknown', site: '' }
  if (!HTTP(base.url)) return { ...base, status: 'unsupported', site: '' }
  return { ...base, status: readable ? 'ready' : 'no_access', site: siteFrom(base.url) }
}

/**
 * @param {{
 *   browser: { activeTabIn: Function, tab: Function, canRead: Function, onTabsChanged: Function, onPermissionsChanged?: Function },
 *   windowId: number | null,
 *   isAgentTab?: (tabId: number) => boolean,
 *   onChange: (page: object) => void,
 *   now?: () => number,
 * }} deps
 */
export function createPageContext({ browser, windowId, isAgentTab = () => false, onChange, now = () => Date.now() }) {
  let current = null
  let version = 0
  let resolving = null

  async function resolve(tabId = null) {
    const tab = tabId === null ? await browser.activeTabIn(windowId) : await browser.tab(tabId)
    if (tab && isAgentTab(tab.id)) return current
    // Only the tab in front counts: an update to a background tab is not a move.
    if (tabId !== null) {
      const front = await browser.activeTabIn(windowId)
      if (front && front.id !== tabId) return current
    }
    const readable = tab && (HTTP(tab.url) || !tab.url) ? await browser.canRead(tab.id) : false
    const next = { ...describeTab(tab, readable), at: now() }
    // A tab whose address Nova cannot see but may read (activeTab): it is
    // asked for its own address, so the page is still known.
    if (next.status === 'ready_untitled') next.status = 'ready'
    const same = current && current.tabId === next.tabId && current.url === next.url && current.status === next.status && current.title === next.title
    if (!same) { version++; current = { ...next, version }; onChange(current) }
    return current
  }
  const queue = tabId => { resolving = (resolving ?? Promise.resolve()).then(() => resolve(tabId)).catch(() => current); return resolving }

  const stopTabs = browser.onTabsChanged(windowId, e => { void queue(e.kind === 'changed' ? e.tabId : null) })
  const stopPerms = browser.onPermissionsChanged?.(() => { void queue(null) }) ?? (() => {})

  return {
    /** The page now (asks the browser again). */
    refresh: () => queue(null),
    current: () => current,
    /** Whether something read at `version` is still the page in front. */
    isStale: v => !current || current.version !== v,
    stop() { stopTabs(); stopPerms() },
  }
}

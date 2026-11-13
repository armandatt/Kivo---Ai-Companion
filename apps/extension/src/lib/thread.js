// A conversation with Nova about one article: the questions asked and Nova's
// answers, kept so a follow-up ("explain the second point") has what came
// before, and so closing the panel or the popup loses nothing.
//
// Where it is kept:
//   unlocked (the default)  chrome.storage.session: in memory, never written to
//                           disk or synced, gone when the browser quits.
//   locked (Keep)           chrome.storage.local, on this device only, so it
//                           survives a browser restart while the learner is
//                           still reading the article. Until they unlock it or
//                           press New conversation, or LOCK_DAYS unused; at
//                           most LOCKED_KEPT articles.
// Web pages can read neither. Nova's server keeps none of it: each question
// sends the latest turns with it (HISTORY_SENT).
//
// One article, one conversation: the key is the article's address with what
// does not change the article taken out (the fragment, tracking parameters,
// "www.", a trailing slash), its canonical address when the page names one on
// the same site, and an arXiv PDF read as its abstract page.

const PREFIX  = 'nova.thread:'
const TYPING  = 'nova.typing:'
export const THREADS_KEPT = 20
export const LOCKED_KEPT  = 10
export const LOCK_DAYS    = 14
export const TURNS_KEPT   = 40
export const HISTORY_SENT = 6
const DAY_MS = 24 * 60 * 60 * 1000

const TRACKING = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'yclid', '_hsenc', '_hsmi', 'mkt_tok', 'ref', 'ref_src', 'ref_url', 'spm', 'si'])

/** The article an address is: what stays the same however it was reached. */
export function articleOf(url, canonical = null) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  // A canonical address counts only on the same site: a page cannot claim to be another site's.
  if (canonical) {
    try {
      const c = new URL(canonical)
      const host = h => h.toLowerCase().replace(/^www\./, '')
      if ((c.protocol === 'https:' || c.protocol === 'http:') && host(c.hostname) === host(u.hostname)) u = c
    } catch { /* not an address: ignored */ }
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  let path = u.pathname.length > 1 && u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname
  if (host === 'arxiv.org' && path.startsWith('/pdf/')) path = `/abs/${path.slice(5).replace(/\.pdf$/, '')}`
  const params = [...u.searchParams].filter(([k]) => !k.toLowerCase().startsWith('utm_') && !TRACKING.has(k.toLowerCase())).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
  return `${host}${path}${query}`
}

/** One conversation per article. */
export function threadKey(url, canonical = null) {
  const article = articleOf(url, canonical)
  return article ? PREFIX + article : null
}

/** The turns that go with a question: the latest ones, question and answer only. */
export const historyOf = turns => turns.filter(t => t.answer).slice(-HISTORY_SENT).map(t => ({ question: t.question, answer: t.answer }))

/**
 * @param {{ get: Function, set: Function, remove: Function }} session chrome.storage.session, or a stand-in
 * @param {{ get: Function, set: Function, remove: Function }} [device] chrome.storage.local, for locked conversations only
 */
export function createThreads(session, device = null) {
  const read = async (area, key) => (await area.get(key).catch(() => ({})))?.[key] ?? null
  const valid = v => v && Array.isArray(v.turns)
  async function entries(area) {
    const stored = (await area.get(null).catch(() => ({}))) ?? {}
    return Object.entries(stored).filter(([k, v]) => k.startsWith(PREFIX) && valid(v))
  }
  // Locked conversations past their time, and beyond the newest LOCKED_KEPT, go.
  async function pruneLocked(now) {
    if (!device) return
    const all = (await entries(device)).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    const gone = all.filter(([, v], i) => i >= LOCKED_KEPT || now - (v.at ?? 0) > LOCK_DAYS * DAY_MS).map(([k]) => k)
    if (gone.length) await device.remove(gone).catch(() => undefined)
  }
  async function pruneSession() {
    const all = (await entries(session)).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    const extra = all.slice(THREADS_KEPT).map(([k]) => k)
    if (extra.length) await session.remove(extra).catch(() => undefined)
  }

  return {
    /** The conversation for this article: a locked one first, then this session's. */
    async load(url, canonical = null, now = Date.now()) {
      const key = threadKey(url, canonical)
      if (!key) return { turns: [], locked: false }
      if (device) {
        const kept = await read(device, key)
        if (valid(kept) && now - (kept.at ?? 0) <= LOCK_DAYS * DAY_MS) return { ...kept, locked: true }
      }
      const open = await read(session, key)
      return valid(open) ? { ...open, locked: false } : { turns: [], locked: false }
    },

    /** Saves it where its lock says. Locking moves it to the device; unlocking back to memory. */
    async save(url, canonical, page, turns, { locked = false, now = Date.now() } = {}) {
      const key = threadKey(url, canonical)
      if (!key) return
      const value = { title: page.title, domain: page.domain, turns: turns.slice(-TURNS_KEPT), at: now }
      if (locked && device) {
        await device.set({ [key]: value }).catch(() => undefined)
        await session.remove(key).catch(() => undefined)
        await pruneLocked(now)
      } else {
        await session.set({ [key]: value }).catch(() => undefined)
        if (device) await device.remove(key).catch(() => undefined)
        await pruneSession()
      }
    },

    /** Forgets it everywhere: New conversation. */
    async clear(url, canonical = null) {
      const key = threadKey(url, canonical)
      if (!key) return
      await session.remove([key, TYPING + key.slice(PREFIX.length)]).catch(() => undefined)
      if (device) await device.remove(key).catch(() => undefined)
    },

    /** What was being typed, and whether the selection was attached, kept in memory for this article. */
    async loadTyping(url, canonical = null) {
      const key = threadKey(url, canonical)
      const v = key ? await read(session, TYPING + key.slice(PREFIX.length)) : null
      return v && typeof v.text === 'string' ? v : { text: '', useSelection: null }
    },
    async saveTyping(url, canonical, typing) {
      const key = threadKey(url, canonical)
      if (key) await session.set({ [TYPING + key.slice(PREFIX.length)]: typing }).catch(() => undefined)
    },

    prune: (now = Date.now()) => Promise.all([pruneLocked(now), pruneSession()]),
  }
}

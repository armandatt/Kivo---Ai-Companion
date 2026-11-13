// A conversation with Nova about one page: the questions asked and Nova's
// answers, kept so a follow-up ("explain the second point") has what came
// before, and so closing the panel or the popup loses nothing.
//
// Where it is kept: chrome.storage.session, the browser's in-memory extension
// storage. Web pages cannot read it, it is never written to disk or synced,
// and it is gone when the browser quits. Nova's server keeps none of it: each
// question sends the latest turns with it (HISTORY_SENT). New conversation
// clears it.

const PREFIX = 'nova.thread:'
export const THREADS_KEPT = 20
export const TURNS_KEPT   = 40
export const HISTORY_SENT = 6

/** One conversation per page: its address without a fragment. */
export function threadKey(url) {
  try {
    const u = new URL(url)
    u.hash = ''
    return PREFIX + u.toString()
  } catch {
    return null
  }
}

/** The turns that go with a question: the latest ones, question and answer only. */
export const historyOf = turns => turns.filter(t => t.answer).slice(-HISTORY_SENT).map(t => ({ question: t.question, answer: t.answer }))

/** @param {{ get: Function, set: Function, remove: Function }} area chrome.storage.session, or a stand-in */
export function createThreads(area) {
  async function all() {
    const stored = (await area.get(null).catch(() => ({}))) ?? {}
    return Object.entries(stored).filter(([k, v]) => k.startsWith(PREFIX) && v && Array.isArray(v.turns))
  }
  return {
    async load(url) {
      const key = threadKey(url)
      if (!key) return { turns: [] }
      const stored = (await area.get(key).catch(() => ({})))?.[key]
      return stored && Array.isArray(stored.turns) ? stored : { turns: [] }
    },
    async save(url, page, turns) {
      const key = threadKey(url)
      if (!key) return
      await area.set({ [key]: { title: page.title, domain: page.domain, turns: turns.slice(-TURNS_KEPT), at: Date.now() } }).catch(() => undefined)
      // Only the latest conversations are kept.
      const kept = (await all()).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
      const extra = kept.slice(THREADS_KEPT).map(([k]) => k)
      if (extra.length) await area.remove(extra).catch(() => undefined)
    },
    clear: url => { const key = threadKey(url); return key ? area.remove(key).catch(() => undefined) : Promise.resolve() },
  }
}

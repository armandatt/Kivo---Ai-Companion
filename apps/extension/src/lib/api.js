// The extension's calls to Nova, all to Nova's own address: redeem a pairing
// code, read the learner's subjects, send one learning event (a page saved, a
// passage saved, a page to study), find a note and put a passage into it,
// ask about the page, disconnect. The credential travels as a bearer header and nowhere
// else; cookies are never sent.
//
// Every failure comes back as { ok: false, kind, message } with words a
// person can read. The popup never shows a status code or a URL.

const TIMEOUT_MS = 12_000
// A question with a screenshot: the model takes longer to read a picture.
const SCREENSHOT_TIMEOUT_MS = 30_000

export const WORDS = {
  offline:         "Can't reach Nova right now. Check your connection and try again.",
  unauthenticated: 'Nova was disconnected from this browser. Connect it again.',
  rate_limited:    "That's a lot at once. Give it a minute.",
  failed:          "That didn't work. Try again in a moment.",
  disconnected:    'Disconnected. This browser can no longer save to Nova.',
  disconnect_unconfirmed: "This browser has forgotten its connection, but Nova couldn't be told. To be sure it is closed, disconnect this browser on Nova's Browser Extension page.",
}

/**
 * What to tell the learner after Disconnect. The browser forgets its
 * credential whatever the answer was. Nova has closed the connection only
 * when it said so, or when it no longer knows the credential (a 401); an
 * unreachable Nova or a failed request has closed nothing, and says so.
 * @param {{ ok: boolean, kind?: string }} result what client.disconnect() returned
 */
export function disconnectOutcome(result) {
  const confirmed = result.ok || result.kind === 'unauthenticated'
  return { confirmed, message: confirmed ? WORDS.disconnected : WORDS.disconnect_unconfirmed }
}

/**
 * @param {{ baseUrl: string, fetch: typeof fetch, getToken: () => Promise<string | null> }} deps
 */
export function createClient({ baseUrl, fetch: doFetch, getToken }) {
  async function call(path, { method = 'GET', body, auth = true, timeoutMs = TIMEOUT_MS } = {}) {
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (auth) {
      const token = await getToken()
      if (!token) return { ok: false, kind: 'unauthenticated', message: WORDS.unauthenticated }
      headers.authorization = `Bearer ${token}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method, headers, signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      })
    } catch {
      return { ok: false, kind: 'offline', message: WORDS.offline }
    } finally {
      clearTimeout(timer)
    }
    const data = await res.json().catch(() => null)
    if (res.status === 401) return { ok: false, kind: 'unauthenticated', message: WORDS.unauthenticated }
    if (res.status === 429) return { ok: false, kind: 'rate_limited', message: data?.message ?? WORDS.rate_limited }
    if (!res.ok || data === null) {
      // The server's own sentence when it sent one; never the transport's.
      return { ok: false, kind: typeof data?.error === 'string' ? data.error : 'failed', message: typeof data?.message === 'string' ? data.message : WORDS.failed }
    }
    return { ok: true, data }
  }

  return {
    connect:    (code, label) => call('/api/nova/extension/connect', { method: 'POST', body: { code, label }, auth: false }),
    context:    () => call('/api/nova/extension/context'),
    disconnect: () => call('/api/nova/extension/disconnect', { method: 'POST' }),
    // One explicit action. `event.clientEventId` is what makes a retry safe.
    sendEvent:  event => call('/api/nova/learning-events', { method: 'POST', body: event }),
    // The learner's notes to choose from: titles and where they are filed, no text.
    noteChoices: ({ q = '', subjectId = '', topic = '', skip = 0 } = {}) => {
      const p = new URLSearchParams()
      if (q.trim()) p.set('q', q.trim())
      if (subjectId) p.set('subjectId', subjectId)
      if (subjectId && topic) p.set('topic', topic)
      if (skip) p.set('skip', String(skip))
      const query = p.toString()
      return call(`/api/nova/extension/notes${query ? `?${query}` : ''}`)
    },
    notePreview: id => call(`/api/nova/extension/notes?preview=${encodeURIComponent(id)}`),
    // A passage into a note, or into a new one. A retry repeats the id, and adds nothing.
    saveToNote: body => call('/api/nova/extension/notes', { method: 'POST', body }),
    // A question about the page. Answered and not kept, screenshot included.
    ask:        question => call('/api/nova/extension/ask', { method: 'POST', body: question, timeoutMs: question.screenshot ? SCREENSHOT_TIMEOUT_MS : TIMEOUT_MS }),
  }
}

/**
 * The fields of a learning event, and only those. Nothing about who the
 * learner is goes in: the server knows that from the credential.
 */
export function buildEvent({ eventType, clientEventId, page, title, subjectId, topicName, excerpt, now = new Date() }) {
  const event = {
    eventType,
    clientEventId,
    url: page.url,
    title: (title ?? page.title).trim(),
    capturedAt: now.toISOString(),
    subjectId: subjectId || null,
    topicName: subjectId && topicName && topicName.trim() ? topicName.trim() : null,
    // What the page calls its own address, when it says.
    canonicalUrl: page.canonicalUrl || null,
  }
  // What the page says about itself in its metadata tags (1.3.0). Optional:
  // the server saves the page without it.
  if (page.meta && typeof page.meta === 'object') event.meta = page.meta
  // The selected passage travels only with the action that is about it.
  if (eventType === 'selection_saved') event.excerpt = typeof excerpt === 'string' ? excerpt : ''
  return event
}

/**
 * A passage for a note: the passage's own event fields, and where it goes.
 * @param {{ clientEventId: string, page: object, title?: string, excerpt: string, noteId?: string, newNote?: { title: string }, subjectId?: string, topicName?: string, now?: Date }} input
 */
export function buildNoteSave({ clientEventId, page, title, excerpt, noteId, newNote, subjectId, topicName, now = new Date() }) {
  const event = buildEvent({ eventType: 'selection_saved', clientEventId, page, title, subjectId: noteId ? '' : subjectId, topicName: noteId ? '' : topicName, excerpt, now })
  const pad = n => String(n).padStart(2, '0')
  return { ...event, day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, ...(noteId ? { noteId } : { newNote }) }
}

/**
 * What a question about the page carries: the question, the page's address
 * and title, the selected passage if there is one, and the screenshot the
 * learner took and saw, if they took one. Never the page itself.
 * @param {{ question: string, page: { url: string, title: string }, title?: string, excerpt?: string, screenshot?: string | null }} input
 *   screenshot: a JPEG as plain base64
 */
export function buildQuestion({ question, page, title, excerpt, screenshot }) {
  const asked = {
    question: question.trim(),
    url: page.url,
    title: (title ?? page.title).trim(),
    excerpt: typeof excerpt === 'string' && excerpt ? excerpt : null,
  }
  if (typeof screenshot === 'string' && screenshot) asked.screenshot = { mimeType: 'image/jpeg', data: screenshot }
  return asked
}

export const newActionId = () => crypto.randomUUID()

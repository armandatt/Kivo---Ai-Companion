// The extension's calls to Nova. Four of them, all to Nova's own address:
// redeem a pairing code, read the learner's subjects, send one learning
// event, disconnect. The credential travels as a bearer header and nowhere
// else; cookies are never sent.
//
// Every failure comes back as { ok: false, kind, message } with words a
// person can read. The popup never shows a status code or a URL.

const TIMEOUT_MS = 12_000

export const WORDS = {
  offline:         "Can't reach Nova right now. Check your connection and try again.",
  unauthenticated: 'Nova was disconnected from this browser. Connect it again.',
  rate_limited:    "That's a lot at once. Give it a minute.",
  failed:          "That didn't work. Try again in a moment.",
}

/**
 * @param {{ baseUrl: string, fetch: typeof fetch, getToken: () => Promise<string | null> }} deps
 */
export function createClient({ baseUrl, fetch: doFetch, getToken }) {
  async function call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (auth) {
      const token = await getToken()
      if (!token) return { ok: false, kind: 'unauthenticated', message: WORDS.unauthenticated }
      headers.authorization = `Bearer ${token}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
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
  }
}

/**
 * The fields of a learning event, and only those. Nothing about who the
 * learner is goes in: the server knows that from the credential.
 */
export function buildEvent({ eventType, clientEventId, page, title, subjectId, topicName, now = new Date() }) {
  return {
    eventType,
    clientEventId,
    url: page.url,
    title: (title ?? page.title).trim(),
    capturedAt: now.toISOString(),
    subjectId: subjectId || null,
    topicName: subjectId && topicName && topicName.trim() ? topicName.trim() : null,
  }
}

export const newActionId = () => crypto.randomUUID()

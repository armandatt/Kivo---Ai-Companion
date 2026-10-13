// The web app's calls for saved pages and the browser extension's
// connection. Contracts: packages/api/src/nova/product/learning-events.types.ts.

import type {
  ExtensionConnectionView, LearningEventInput, LearningEventResponse, LearningResourceResponse, PairingCodeResponse,
  ResourceUpdateResponse,
} from '@repo/api/nova/product/learning-events.types'

const FAILED = 'Could not reach the server. Check your connection and try again.'

export async function fetchResource(id: string): Promise<LearningResourceResponse> {
  try {
    const res = await fetch(`/api/nova/learning-events/${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'unauthenticated', message: FAILED } }
    return await res.json() as LearningResourceResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

export async function removeResource(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/nova/learning-events/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// One change to a saved page, answered with the page as it now is.
async function updateResource(path: string, method: 'PATCH' | 'POST', body?: unknown): Promise<ResourceUpdateResponse> {
  try {
    const res = await fetch(path, {
      method, cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const json = await res.json().catch(() => null) as ResourceUpdateResponse | null
    if (json && typeof json === 'object' && 'ok' in json) return json
    return { ok: false, error: 'failed', message: res.status === 401 ? 'Sign in again to do that.' : "That didn't work. Try again." }
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

const resourcePath = (id: string) => `/api/nova/learning-events/${encodeURIComponent(id)}`

// File a saved page under a subject and topic (a place Nova suggested, usually).
export const fileResource = (id: string, subjectId: string, topicName: string | null) => updateResource(resourcePath(id), 'PATCH', { subjectId, topicName })
// Keep, or undo, a link Nova made by itself.
export const keepNovaLink = (id: string) => updateResource(resourcePath(id), 'PATCH', { keep: true })
export const undoNovaLink = (id: string) => updateResource(resourcePath(id), 'PATCH', { undo: true })
// Take one suggestion off a page's list.
export const dismissSuggestion = (id: string, subjectId: string, topicName: string | null) => updateResource(resourcePath(id), 'PATCH', { dismiss: { subjectId, topicName } })
// Ask Nova to look at a saved page again.
export const retryProcessing = (id: string) => updateResource(`${resourcePath(id)}/process`, 'POST')

// A task made from a saved page. `clientKey` is the page's own, so pressing
// twice makes one task. It is a to-do and nothing else.
export async function addTaskFromResource(resource: { id: string; title: string; subjectId: string | null; topicName: string | null }): Promise<boolean> {
  try {
    const res = await fetch('/api/nova/tasks', {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `Read: ${resource.title}`.slice(0, 160),
        subjectId: resource.subjectId, topicName: resource.subjectId ? resource.topicName : null,
        clientKey: `resource:${resource.id}`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function requestPairingCode(): Promise<PairingCodeResponse> {
  try {
    const res = await fetch('/api/nova/extension/pair', { method: 'POST', cache: 'no-store' })
    return await res.json() as PairingCodeResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

export async function fetchConnections(): Promise<ExtensionConnectionView[] | null> {
  try {
    const res = await fetch('/api/nova/extension/connections', { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json() as { status: string; connections?: ExtensionConnectionView[] }
    return json.connections ?? []
  } catch {
    return null
  }
}

export async function disconnectBrowser(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/nova/extension/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// Whether this browser still has a session, asked of the web app itself.
// Unknown (the check failed) counts as no: the learner is offered sign-in.
async function stillSignedIn(): Promise<boolean> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

// Saving a link from the web app: the same request the extension makes, to
// the same endpoint, as the signed-in learner. `clientEventId` is made once
// per link and sent again on a retry, so a retry never saves twice.
export async function saveLink(input: { clientEventId: string; url: string; title: string; subjectId: string | null; topicName: string | null }): Promise<LearningEventResponse> {
  const body: LearningEventInput = { eventType: 'resource_saved', capturedAt: new Date().toISOString(), ...input }
  try {
    const res = await fetch('/api/nova/learning-events', {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null) as LearningEventResponse | null
    // "Unauthenticated" from the save is believed only if the session really
    // is gone. A server that does not accept saves from the web app yet (the
    // API is deployed separately and can be a version behind) answers the
    // same way, and sending a signed-in learner to sign in fixes nothing.
    if (res.status === 401 && await stillSignedIn()) {
      return { success: false, error: 'failed', message: "You're signed in, but Nova's server can't save links from here yet. Nothing is lost: try again in a little while." }
    }
    if (json && typeof json === 'object' && 'success' in json) return json
    return { success: false, error: res.status === 401 ? 'unauthenticated' : 'failed', message: res.status === 401 ? 'Sign in to save this.' : "That didn't save. Try again." }
  } catch {
    return { success: false, error: 'failed', message: FAILED }
  }
}

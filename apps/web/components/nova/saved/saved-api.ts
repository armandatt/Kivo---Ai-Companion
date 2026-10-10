// The web app's calls for saved pages and the browser extension's
// connection. Contracts: packages/api/src/nova/product/learning-events.types.ts.

import type {
  ExtensionConnectionView, LearningEventInput, LearningEventResponse, LearningResourceResponse, PairingCodeResponse,
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
    if (json && typeof json === 'object' && 'success' in json) return json
    return { success: false, error: res.status === 401 ? 'unauthenticated' : 'failed', message: res.status === 401 ? 'Sign in to save this.' : "That didn't save. Try again." }
  } catch {
    return { success: false, error: 'failed', message: FAILED }
  }
}

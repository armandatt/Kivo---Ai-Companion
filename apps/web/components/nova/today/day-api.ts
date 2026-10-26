// The web app's calls for today's flow. Every change goes to /api/nova/day
// with the version the page has; the copilot to /api/nova/day/copilot.

import type { CopilotRequest, CopilotResponse, DayFlowResponse, NovaDayView } from '@repo/api/nova/product/day-flow.types'

const FAILED = 'Could not reach the server. Check your connection and try again.'

async function call<T>(url: string, init?: RequestInit): Promise<T | { ok: false; error: 'failed'; message: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'failed', message: 'Sign in again.' } }
    const data = await res.json().catch(() => null) as T | null
    // A host's own error page (a proxy timeout) is not an answer.
    if (!data || typeof data !== 'object') return { ok: false, error: 'failed', message: res.status === 504 ? 'That took too long. Try again.' : FAILED }
    return data
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

export const fetchDay = () => call<NovaDayView | { ok: false; error: string; message: string }>('/api/nova/day')
export const sendDay = (body: Record<string, unknown>) => call<DayFlowResponse>('/api/nova/day', { method: 'POST', body: JSON.stringify(body) })
export const askCopilot = (body: CopilotRequest) => call<CopilotResponse>('/api/nova/day/copilot', { method: 'POST', body: JSON.stringify(body) })

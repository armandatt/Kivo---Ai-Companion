// The drafts routes (apps/api /api/nova/drafts), from the page. Every call
// answers { ok, … } or { ok: false, message }; a lost connection is said as
// one sentence, never thrown.

import type { CaptureItem, DraftDetail, DraftEdit, DraftSummary } from '@repo/api/nova/product/capture-draft-rules'

export type { CaptureItem, DraftDetail, DraftEdit, DraftSummary }

type Fail = { ok: false; error: string; message: string; draft?: DraftDetail }
const OFFLINE: Fail = { ok: false, error: 'failed', message: "Kivo couldn't be reached. Check your connection and try again." }

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<({ ok: true } & T) | Fail> {
  try {
    const res = await fetch(url, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    if (res.status === 401) { window.location.href = '/signin'; return OFFLINE }
    const out = await res.json().catch(() => null) as ({ ok: true } & T) | Fail | null
    return out ?? OFFLINE
  } catch {
    return OFFLINE
  }
}

export const fetchDrafts = () => call<{ drafts: DraftSummary[]; current: DraftSummary | null; open: number }>('/api/nova/drafts')
export const fetchDraft = (id: string) => call<{ draft: DraftDetail }>(`/api/nova/drafts/${encodeURIComponent(id)}`)
export const editDraft = (id: string, version: number, edits: DraftEdit[]) => call<{ draft: DraftDetail }>(`/api/nova/drafts/${encodeURIComponent(id)}`, 'PATCH', { version, edits })
export const discardDraft = (id: string) => call<{ draft: DraftDetail }>(`/api/nova/drafts/${encodeURIComponent(id)}`, 'DELETE')
export const restoreDraft = (id: string) => call<{ draft: DraftDetail }>(`/api/nova/drafts/${encodeURIComponent(id)}`, 'PATCH', { restore: true })
export const keepInDrafts = (capture: { key: string; url: string | null; title: string; text: string; note?: string; newDraft?: boolean }) =>
  call<{ action: 'added' | 'already_in_draft'; draft: DraftSummary; itemId: string }>('/api/nova/drafts', 'POST', capture)

export type MergeTarget = { kind: 'new'; title: string; subjectId: string | null; topicName: string | null } | { kind: 'existing'; noteId: string }
export type MergePreview = { preview: true; body: string; added: string; joined: string[]; noteTitle: string; noteLength: number | null }
export type MergeDone = { preview: false; noteId: string; noteTitle: string; already: boolean }
export const mergeDraft = (id: string, body: { target: MergeTarget; version: number; day: string; preview?: boolean }) =>
  call<MergePreview | MergeDone>(`/api/nova/drafts/${encodeURIComponent(id)}/merge`, 'POST', body)

// The learner's own day, for the "Added …" line.
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

// Calls to the Build with Nova routes. Each answers what the page can show;
// a request that fails keeps nothing from the page (the caller holds the
// words and the edits).

import type { BuilderResponse, ChangeSet, DraftListView, DraftView, Snapshot, VersionItem, WorkspaceDetailResponse } from '@repo/api/nova/product/builder.types'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'

export type Failure = { ok: false; error: string; message: string; draft?: DraftView }
const failure = (message: string, error = 'failed'): Failure => ({ ok: false, error, message })

async function call<T extends { ok: boolean }>(url: string, init: RequestInit = {}): Promise<T | Failure> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: init.body ? { 'Content-Type': 'application/json' } : undefined })
    if (res.status === 401) { window.location.href = `/signin?from=${encodeURIComponent(window.location.pathname + window.location.search)}`; return failure('Signed out.') }
    const data = await res.json().catch(() => null) as (T & { message?: string; error?: string }) | null
    if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') return failure("Kivo didn't answer. Nothing you typed is lost; try again.")
    return data
  } catch {
    return failure("Couldn't reach Kivo. Check your connection; nothing you typed is lost.")
  }
}

const post = <T extends { ok: boolean }>(url: string, body: unknown = {}) => call<T>(url, { method: 'POST', body: JSON.stringify(body) })
const id = (draftId: string) => encodeURIComponent(draftId)

export type SharedFile = { name: string; data: string }
export const startDraft = (body: { clientKey: string; text?: string; files?: SharedFile[]; targetWorkspaceId?: string }) => post<BuilderResponse>('/api/nova/builder', body)
export const loadDraft = (draftId: string) => call<BuilderResponse>(`/api/nova/builder/${id(draftId)}`)
export const sendMessage = (draftId: string, text: string, files: SharedFile[] = []) =>
  post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/messages`, files.length ? { text, files } : { text })
export const resumeDraft = (draftId: string) => post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/messages`, { resume: true })
export const retryDraft = (draftId: string) => post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/retry`)
export const cancelDraft = (draftId: string) => post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/cancel`)
// The conversation's history: every version, one to look at, and restoring one.
export type VersionView = { ok: true; item: VersionItem; plan: WorkspacePlan | null; changes: ChangeSet | null; snapshot: Snapshot | null }
export const listVersions = (draftId: string) => call<{ ok: true; versions: VersionItem[]; current: number }>(`/api/nova/builder/${id(draftId)}/versions`)
export const loadVersion = (draftId: string, versionId: string) => call<VersionView>(`/api/nova/builder/${id(draftId)}/versions/${encodeURIComponent(versionId)}`)
export const restoreVersion = (draftId: string, versionId: string, baseVersion: number) => post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/versions/${encodeURIComponent(versionId)}/restore`, { baseVersion })
// The deletion shown in the conversation: confirmed (exactly that scope), or kept.
export const confirmDeletion = (draftId: string, fingerprint: string) => post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/delete`, { fingerprint })
export const keepResource = (draftId: string) => post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/keep`)
export const approveDraft = (draftId: string, body: { version: number; addTo?: string; confirmAnother?: boolean }) =>
  post<BuilderResponse>(`/api/nova/builder/${id(draftId)}/approve`, body)
export const saveDraftPlan = (draftId: string, plan: WorkspacePlan, baseVersion: number) =>
  call<BuilderResponse>(`/api/nova/builder/${id(draftId)}`, { method: 'PATCH', body: JSON.stringify({ plan, baseVersion }) })

// Which of the proposed changes to an existing resource stay (by id).
export const saveDraftChanges = (draftId: string, keep: string[], baseVersion: number) =>
  call<BuilderResponse>(`/api/nova/builder/${id(draftId)}`, { method: 'PATCH', body: JSON.stringify({ keep, baseVersion }) })
// Removes the conversation only; what it built stays.
export const deleteDraft = (draftId: string) => call<{ ok: true }>(`/api/nova/builder/${id(draftId)}`, { method: 'DELETE' })

export async function listDrafts(): Promise<DraftListView | Failure> {
  try {
    const res = await fetch('/api/nova/builder', { cache: 'no-store' })
    const data = await res.json().catch(() => null) as DraftListView | null
    return res.ok && data?.status === 'ready' ? data : failure("Your conversations didn't load.")
  } catch {
    return failure("Your conversations didn't load.")
  }
}

export const loadWorkspaceDetail = (workspaceId: string) => call<WorkspaceDetailResponse>(`/api/nova/workspaces/${encodeURIComponent(workspaceId)}`)

// A task in the live workspace, changed through the Planner's own route.
export async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<{ ok: true } | Failure> {
  try {
    const res = await fetch(`/api/nova/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) return { ok: true }
    const data = await res.json().catch(() => null) as { message?: string } | null
    return failure(data?.message ?? "That change wasn't saved. Try again.")
  } catch {
    return failure("Couldn't reach Kivo. That change wasn't saved.")
  }
}

export function newClientKey(): string {
  try { return crypto.randomUUID() } catch { return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` }
}

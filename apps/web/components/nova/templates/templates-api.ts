// Calls to the workspace routes, each answering what the page can show. A
// request that fails keeps nothing from the page: the caller holds the inputs.

import type { CreateWorkspaceResponse, ProposeResponse, WorkspacesView } from '@repo/api/nova/product/workspaces.types'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'

export type Failure = { ok: false; error: string; message: string }

const failure = (message: string, error = 'failed'): Failure => ({ ok: false, error, message })

async function send<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T | Failure> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (res.status === 401) { window.location.href = '/signin?from=/templates'; return failure('Signed out.') }
    const data = await res.json().catch(() => null) as (T & { ok?: boolean; message?: string }) | null
    if (!data || typeof data !== 'object') return failure("Kivo didn't answer. Your inputs are still here; try again.")
    if (res.status === 429 && !('route' in data)) return failure(data.message ?? 'That is a lot at once. Give it a minute.', 'rate_limited')
    return data
  } catch (err) {
    if ((err as Error).name === 'AbortError') return failure('Cancelled.', 'cancelled')
    return failure("Couldn't reach Kivo. Check your connection; your inputs are still here.")
  }
}

export const propose = (body: Record<string, unknown>, signal?: AbortSignal) =>
  send<ProposeResponse>('/api/nova/workspaces/propose', body, signal)

export const createWorkspace = (body: { plan: WorkspacePlan; clientKey: string; addTo?: string; confirmAnother?: boolean }) =>
  send<CreateWorkspaceResponse>('/api/nova/workspaces', body)

export async function loadWorkspaces(): Promise<WorkspacesView | Failure> {
  try {
    const res = await fetch('/api/nova/workspaces', { cache: 'no-store' })
    const data = await res.json().catch(() => null) as WorkspacesView | null
    return res.ok && data?.status === 'ready' ? data : failure("Your workspaces didn't load.")
  } catch {
    return failure("Your workspaces didn't load.")
  }
}

export async function removeWorkspace(id: string): Promise<boolean> {
  try { return (await fetch(`/api/nova/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })).ok } catch { return false }
}

// A key for one creation: the same plan sent twice (a double click, a retry)
// makes one workspace.
export function newClientKey(): string {
  try { return crypto.randomUUID() } catch { return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` }
}

// Files as the propose route takes them. Checked again on the server, by
// their bytes; these limits only save a wasted upload.
export const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
export const FILES_MAX = 3
export const FILES_TOTAL_BYTES = 3 * 1024 * 1024

export async function encodeFile(file: File): Promise<{ name: string; data: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name: file.name, data: btoa(binary) }
}

// The map's adds and deletes, each through the route that already owns the
// record: Subject Studio's batch (POST /api/nova/subjects, applied whole or
// not at all, against the version it was made from), the archive route, and
// the task routes. Each route checks the learner and every id again; nothing
// here is trusted by the server.

import type { StudyEditResponse, StudyStructure, StudyStructureView, StudyEdit } from '@repo/api/nova/product/setup-edit.types'
import type { TaskInput, TaskResponse } from '@repo/api/nova/product/tasks.types'
import type { AddRequest, DeleteRequest } from './map-structure'

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

async function call<T>(url: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<{ status: number; json: T | null }> {
  const res = await fetch(url, {
    method, cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) window.location.href = '/signin'
  return { status: res.status, json: await res.json().catch(() => null) as T | null }
}

export type Outcome<T = undefined> = { ok: true; value: T; said: string[] } | { ok: false; message: string; stale?: boolean }

export async function loadStructure(): Promise<Outcome<StudyStructure>> {
  try {
    const { json } = await call<StudyStructureView>('/api/nova/subjects', 'GET')
    if (json && json.status === 'ready') return { ok: true, value: { version: json.version, subjects: json.subjects }, said: [] }
    return { ok: false, message: "Couldn't load your subjects and topics." }
  } catch { return { ok: false, message: OFFLINE } }
}

async function studyBatch(version: string, edits: StudyEdit[]): Promise<Outcome<StudyStructure>> {
  try {
    const { json } = await call<StudyEditResponse>('/api/nova/subjects', 'POST', { version, edits })
    if (json?.ok) return { ok: true, value: json.structure, said: json.applied }
    if (json && json.error === 'stale') return { ok: false, stale: true, message: 'Your subjects changed somewhere else after the map loaded. Nothing was changed. The map has been reloaded: look again and try once more.' }
    return { ok: false, message: json?.issues?.[0]?.message ?? json?.message ?? 'Nothing was changed. Try again.' }
  } catch { return { ok: false, message: OFFLINE } }
}

// An add, from the structure as it now is. A batch made against an older
// version is refused by the server; an add is checked against the current
// one, so it is read fresh first.
export async function sendAdd(req: AddRequest): Promise<Outcome<{ before: StudyStructure | null; after: StudyStructure | null; taskId: string | null }>> {
  if (req.route === 'task') {
    try {
      const { json } = await call<TaskResponse>('/api/nova/tasks', 'POST', req.input satisfies TaskInput)
      if (json?.ok) return { ok: true, value: { before: null, after: null, taskId: json.task.id }, said: [`Added “${json.task.title}”.`] }
      return { ok: false, message: (json && !json.ok && json.message) || 'The task wasn’t saved. Try again.' }
    } catch { return { ok: false, message: OFFLINE } }
  }
  const before = await loadStructure()
  if (!before.ok) return before
  const done = await studyBatch(before.value.version, req.edits)
  if (!done.ok) return done
  return { ok: true, value: { before: before.value, after: done.value, taskId: null }, said: done.said }
}

// What a topic says about itself, after it was made.
export async function describeTopic(structure: StudyStructure, topicId: string, explanation: string): Promise<Outcome> {
  const done = await studyBatch(structure.version, [{ op: 'update_topic', topicId, details: { explanation } }])
  return done.ok ? { ok: true, value: undefined, said: done.said } : done
}

// A deletion, against the structure the learner saw when they confirmed it:
// if it changed meanwhile, nothing is deleted and they look again.
export async function sendDelete(req: DeleteRequest, structure: StudyStructure | null): Promise<Outcome> {
  if (req.route === 'study') {
    if (!structure) return { ok: false, message: 'Nothing was changed. Try again.' }
    const done = await studyBatch(structure.version, req.edits)
    return done.ok ? { ok: true, value: undefined, said: done.said } : done
  }
  try {
    // Steps kept first, so a failure part way leaves every step in place.
    for (const id of req.lift) {
      const { json } = await call<TaskResponse>(`/api/nova/tasks/${encodeURIComponent(id)}`, 'PATCH', { parentId: null } satisfies TaskInput)
      if (!json?.ok) return { ok: false, message: `A step couldn’t be kept${json && !json.ok ? `: ${json.message}` : ''}. The task was not deleted.` }
    }
    const { status, json } = await call<{ ok: boolean; message?: string }>(`/api/nova/tasks/${encodeURIComponent(req.remove)}`, 'DELETE')
    if (json?.ok) return { ok: true, value: undefined, said: ['Deleted.'] }
    if (status === 404) return { ok: true, value: undefined, said: ['It was already gone.'] }
    return { ok: false, message: json?.message ?? 'The task wasn’t deleted. Try again.' }
  } catch { return { ok: false, message: OFFLINE } }
}

export async function archiveTopic(topicId: string): Promise<Outcome> {
  try {
    const { json } = await call<{ ok: boolean; message?: string }>('/api/nova/topics/archive', 'POST', { topicId, archived: true })
    return json?.ok ? { ok: true, value: undefined, said: ['Archived. Its history stays; restore it in Subject Studio on Knowledge.'] } : { ok: false, message: json?.message ?? 'Nothing was changed. Try again.' }
  } catch { return { ok: false, message: OFFLINE } }
}

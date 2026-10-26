// The web app's calls to Nova's tutor on a note and to the file import.
// Each is one request the learner made; neither stores anything.

import type { TutorRequest, TutorResponse } from '@repo/api/nova/product/note-tutor.types'
import type { NoteImportResponse } from '@repo/api/nova/product/note-import'

const FAILED = 'Could not reach the server. Check your connection and try again.'

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T | { ok: false; error: 'failed' | 'unauthenticated' | 'aborted'; message: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'unauthenticated', message: 'Sign in again.' } }
    const data = await res.json().catch(() => null) as (T & { ok?: boolean; message?: string }) | null
    // A host's own error page (a timeout at the proxy) is not an answer.
    if (!data || typeof data.ok !== 'boolean') {
      return { ok: false, error: 'failed', message: res.status === 504 || res.status === 502 ? 'That took too long to come back. Try again.' : FAILED }
    }
    return data
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { ok: false, error: 'aborted', message: 'Stopped.' }
    return { ok: false, error: 'failed', message: FAILED }
  }
}

export const askTutor = (noteId: string, request: TutorRequest, signal?: AbortSignal) =>
  post<TutorResponse>(`/api/nova/notes/${encodeURIComponent(noteId)}/tutor`, request, signal)

// The file is sent as base64 inside the JSON, as Create with Nova sends files.
export async function transcribeFile(file: File, signal?: AbortSignal) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return post<NoteImportResponse>('/api/nova/notes/import', { file: { name: file.name, data: btoa(binary) } }, signal)
}

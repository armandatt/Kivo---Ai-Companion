// The web app's calls to the notes routes. A note goes to /api/nova/notes
// and nowhere else: it is the learner's content, not a message to Nova.

import type {
  NoteDeleteResponse, NoteInput, NoteResponse, NovaNotesView,
} from '@repo/api/nova/product/notes.types'

const FAILED = 'Could not reach the server. Check your connection and try again.'
const failed = { ok: false as const, error: 'failed' as const, message: FAILED }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type NoteFilters = { q?: string; subjectId?: string; topic?: string }

export function notesUrl(filters: NoteFilters = {}): string {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.subjectId) params.set('subjectId', filters.subjectId)
  if (filters.topic) params.set('topic', filters.topic)
  const query = params.toString()
  return `/api/nova/notes${query ? `?${query}` : ''}`
}

export async function fetchNotes(filters: NoteFilters = {}): Promise<NovaNotesView | null> {
  try {
    const res = await fetch(notesUrl(filters), { cache: 'no-store' })
    if (res.status === 401) { window.location.href = '/signin'; return null }
    return res.ok ? await res.json() as NovaNotesView : null
  } catch {
    return null
  }
}

async function send(url: string, method: string, body?: NoteInput): Promise<NoteResponse> {
  try {
    const res = await fetch(url, { method, headers: JSON_HEADERS, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
    if (res.status === 401) { window.location.href = '/signin'; return failed }
    return await res.json() as NoteResponse
  } catch {
    return failed
  }
}

export const fetchNote  = (id: string) => send(`/api/nova/notes/${encodeURIComponent(id)}`, 'GET')
export const createNote = (input: NoteInput) => send('/api/nova/notes', 'POST', input)
export const updateNote = (id: string, input: NoteInput) => send(`/api/nova/notes/${encodeURIComponent(id)}`, 'PATCH', input)

export async function deleteNote(id: string): Promise<NoteDeleteResponse> {
  try {
    const res = await fetch(`/api/nova/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return await res.json() as NoteDeleteResponse
  } catch {
    return failed
  }
}

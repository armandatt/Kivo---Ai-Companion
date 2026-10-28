// Putting what the learner took from a PDF (a quoted passage, a captured
// page or region) into a note: one they have, or a new one. Every write is the
// note's own guarded save (PATCH with the version read), retried once on a
// conflict against the note as it then stands; what is already in the note
// is not added again. A captured image is stored first (note-images route),
// for the note it goes in, and only its reference goes in the text.

import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type NoteDetail } from '@repo/api/nova/product/notes.types'
import { alreadyIn, insertAt, placementFor, resolvePlacement } from '@repo/api/nova/product/note-outline'
import { paperPlacement } from '@repo/api/nova/product/paper-source'
import { createNote, fetchNote, updateNote } from './notes-api'

export type SendResult =
  | { ok: true; noteId: string; title: string; already?: boolean }
  | { ok: false; message: string }

// Where an addition goes in a body: under "My notes" in a paper's note
// (never into the paper's own text), else where the note's structure says,
// else the end. Pure.
export function addInto(body: string, markdown: string, label: string): { body: string } | { already: true } | { tooLong: true } {
  if (alreadyIn(body, markdown)) return { already: true }
  const placed = paperPlacement(body, placementFor(body, { kind: 'other', title: label } as Parameters<typeof placementFor>[1]))
  const at = resolvePlacement(body, placed.clear ? placed.best : { how: 'end', anchor: null, heading: null, label: 'At the end of the note' } as never) ?? body.length
  const heading = placed.clear && placed.best.how === 'newSection' ? placed.best.heading : null
  const next = insertAt(body, at, markdown, heading).body
  return next.length > NOTE_BODY_MAX ? { tooLong: true } : { body: next }
}

export async function appendToNote(noteId: string, markdown: string, label: string): Promise<SendResult> {
  let loaded = await fetchNote(noteId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!loaded.ok) return { ok: false, message: loaded.message }
    const note: NoteDetail = loaded.note
    const r = addInto(note.body, markdown, label)
    if ('already' in r) return { ok: true, noteId, title: note.title, already: true }
    if ('tooLong' in r) return { ok: false, message: `That would make “${note.title}” longer than a note can be. Nothing was added.` }
    const saved = await updateNote(noteId, { body: r.body, baseUpdatedAt: note.updatedAt })
    if (saved.ok) return { ok: true, noteId, title: saved.note.title }
    if (saved.error === 'conflict' && saved.current) { loaded = { ok: true, note: saved.current }; continue }
    return { ok: false, message: saved.message }
  }
  return { ok: false, message: 'That note kept changing while this was being added. Try again.' }
}

export async function newNoteWith(title: string, markdown: string): Promise<SendResult> {
  const r = await createNote({ title: title.trim().slice(0, NOTE_TITLE_MAX) || 'Notes', body: markdown, once: true })
  return r.ok ? { ok: true, noteId: r.note.id, title: r.note.title } : { ok: false, message: r.message }
}

export async function newEmptyNote(title: string): Promise<SendResult> {
  const r = await createNote({ title: title.trim().slice(0, NOTE_TITLE_MAX) || 'Notes', body: '' })
  return r.ok ? { ok: true, noteId: r.note.id, title: r.note.title } : { ok: false, message: r.message }
}

const base64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function uploadImage(input: { noteId: string; blob: Blob; clientKey: string; sourceUrl: string; sourceTitle: string; page: number }): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/nova/notes/images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: input.noteId, data: await base64(input.blob), clientKey: input.clientKey, sourceUrl: input.sourceUrl, sourceTitle: input.sourceTitle, page: input.page }),
    })
    const data = await res.json().catch(() => null) as { ok?: boolean; image?: { id: string }; message?: string } | null
    if (res.ok && data?.ok && data.image) return { ok: true, id: data.image.id }
    return { ok: false, message: data?.message ?? 'The image didn’t save. Try again.' }
  } catch {
    return { ok: false, message: 'The image didn’t save: Kivo couldn’t be reached. Try again.' }
  }
}

export const clientKey = (prefix: string) =>
  `${prefix}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`}`

// The map's two edits, each through the route that already does it: a link
// is added by the ordinary guarded note save (PATCH /api/nova/notes/:id with
// baseUpdatedAt), and filing goes through the note save or the saved-page
// filing route. Neither has a shortcut here.

import { NOTE_BODY_MAX } from '@repo/api/nova/product/notes.types'
import { linkKey } from '@repo/api/nova/product/note-links'
import { fetchNote, updateNote } from '../notes/notes-api'
import { fileResource } from '../saved/saved-api'
import { alreadyLinks, appendLink, type LinkPlan, type Placement } from './map-edit'

export type EditOutcome =
  | { kind: 'done'; message: string }
  | { kind: 'unchanged'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'failed'; message: string }

const CONFLICT = 'This note was changed somewhere else after the map loaded. Nothing was overwritten. The map has been reloaded: try again.'

// Adds [[title]] to the end of the note, from the version the server has now.
// After the save the server's own reading of the link is checked; if it
// opens something other than what was chosen, the note is put back.
export async function addNoteLink(noteId: string, plan: Extract<LinkPlan, { ok: true }>): Promise<EditOutcome> {
  const opened = await fetchNote(noteId)
  if (!opened.ok) return { kind: 'failed', message: opened.message }
  const before = opened.note
  if (alreadyLinks(before.body, plan.title)) return { kind: 'unchanged', message: `“${before.title}” already links to “${plan.title}”.` }
  const body = appendLink(before.body, plan.title)
  if (body === null) return { kind: 'failed', message: 'The note ends inside a code block, so a link added there would be code. Add it in the note editor.' }
  if (body.length > NOTE_BODY_MAX) return { kind: 'failed', message: 'The note is too long to add a link to.' }

  const saved = await updateNote(noteId, { body, baseUpdatedAt: before.updatedAt })
  if (!saved.ok) return saved.error === 'conflict' ? { kind: 'conflict', message: CONFLICT } : { kind: 'failed', message: saved.message }

  const link = saved.note.links.outgoing.find(l => linkKey(l.title) === linkKey(plan.title))
  const opens = link ? (link.noteId ? { noteId: link.noteId } : link.topicId ? { topicId: link.topicId } : null) : null
  const meant = JSON.stringify(plan.expect) === JSON.stringify(opens)
  if (meant) return { kind: 'done', message: `Added [[${plan.title}]] to “${before.title}”.` }

  // It names something else on the server (a note of that title the map does
  // not draw, say): the note goes back to what it was, guarded on this save.
  const undone = await updateNote(noteId, { body: before.body, baseUpdatedAt: saved.note.updatedAt })
  return {
    kind: 'failed',
    message: undone.ok
      ? `[[${plan.title}]] would open something else of yours with that name, so it was not kept. Link it in the note editor.`
      : `[[${plan.title}]] opens something else of yours with that name, and the note couldn't be put back. Open “${before.title}” to remove it.`,
  }
}

// Files a note under a subject (and topic), guarded on the version the map
// showed, or a saved page through its own filing route.
export async function fileItem(kind: 'note' | 'resource', id: string, to: Placement, version: string | null, label: string): Promise<EditOutcome> {
  if (kind === 'note') {
    const saved = await updateNote(id, { subjectId: to.subjectId, topicName: to.topicName, ...(version ? { baseUpdatedAt: version } : {}) })
    if (saved.ok) return { kind: 'done', message: `Filed “${saved.note.title}” under ${label}.` }
    return saved.error === 'conflict' ? { kind: 'conflict', message: CONFLICT } : { kind: 'failed', message: saved.message }
  }
  const filed = await fileResource(id, to.subjectId, to.topicName)
  return filed.ok ? { kind: 'done', message: `Filed “${filed.resource.title}” under ${label}.` } : { kind: 'failed', message: filed.message }
}

// The web app's calls for importing a research paper. Each is one request
// the learner made. Preview stores nothing; import saves one note
// (product/paper-import.ts); a topic is created only when the learner asks,
// through Subject Studio's own batch (POST /api/nova/subjects).

import type { PaperImportRequest, PaperImportResponse, PaperPreviewResponse } from '@repo/api/nova/product/paper.types'
import type { StudyEditResponse, StudyStructureView } from '@repo/api/nova/product/setup-edit.types'
import { post } from './tutor-api'

export const previewPaper = (url: string, signal?: AbortSignal) =>
  post<PaperPreviewResponse>('/api/nova/notes/papers/preview', { url }, signal)

export const importPaper = (request: PaperImportRequest, signal?: AbortSignal) =>
  post<PaperImportResponse>('/api/nova/notes/papers', request, signal)

// A new topic in one of the learner's subjects, made on their explicit
// "Create topic": the same versioned batch Subject Studio sends, so the
// structure's own rules apply (no duplicate names, the learner's own subject).
export async function createTopic(subjectId: string, name: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/nova/subjects', { cache: 'no-store' })
    const view = await res.json().catch(() => null) as StudyStructureView | null
    if (!res.ok || !view || view.status !== 'ready') return { ok: false, message: 'Your subjects couldn’t be loaded. Try again.' }
    const subject = view.subjects.find(s => s.id === subjectId)
    if (!subject) return { ok: false, message: 'That subject isn’t one of yours any more.' }
    if (subject.topics.some(t => t.name.toLowerCase() === name.trim().toLowerCase() && !t.archived)) return { ok: true }
    const out = await post<StudyEditResponse>('/api/nova/subjects', { version: view.version, edits: [{ op: 'add_topics', subjectId, names: [name.trim()] }] })
    return out.ok ? { ok: true } : { ok: false, message: out.message }
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' }
  }
}

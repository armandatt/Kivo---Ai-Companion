// The learner's notes as a notebook: by subject, then topic. Pure, for the
// sidebar (notes-tree.tsx) and the list page. Subjects are in name order, the
// notes without one last; inside a group, the most recently updated first,
// as the server sends them.

import type { NoteSummary } from '@repo/api/nova/product/notes.types'

export interface NoteTopicGroup { topic: string | null; notes: NoteSummary[] }
export interface NoteSubjectGroup { subjectId: string | null; subjectName: string | null; count: number; topics: NoteTopicGroup[] }

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

export function groupNotes(notes: NoteSummary[]): NoteSubjectGroup[] {
  const subjects = new Map<string, NoteSubjectGroup>()
  for (const note of notes) {
    const key = note.subjectId ?? ''
    let group = subjects.get(key)
    if (!group) subjects.set(key, group = { subjectId: note.subjectId, subjectName: note.subjectId ? note.subjectName : null, count: 0, topics: [] })
    group.count++
    const topic = note.subjectId ? (note.topicName?.trim() || null) : null
    let t = group.topics.find(x => (x.topic ?? '').toLowerCase() === (topic ?? '').toLowerCase())
    if (!t) group.topics.push(t = { topic, notes: [] })
    t.notes.push(note)
  }
  for (const g of subjects.values()) {
    // Notes filed under the subject alone come first, then topics by name.
    g.topics.sort((a, b) => a.topic === null ? -1 : b.topic === null ? 1 : byName(a.topic, b.topic))
  }
  return [...subjects.values()].sort((a, b) =>
    a.subjectId === null ? 1 : b.subjectId === null ? -1 : byName(a.subjectName ?? '', b.subjectName ?? ''))
}

// The notes whose title, subject or topic contains every word typed.
export function filterNotes(notes: NoteSummary[], query: string): NoteSummary[] {
  const words = query.toLowerCase().split(' ').filter(Boolean)
  if (words.length === 0) return notes
  return notes.filter(n => {
    const hay = [n.title, n.subjectName ?? '', n.topicName ?? ''].join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

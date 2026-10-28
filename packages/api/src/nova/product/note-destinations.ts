// Where a note can be filed: the learner's own subjects (inside one another
// where they are) and their topics (inside one another too), shown with
// their whole path, plus no subject at all. A note is filed by subject and
// topic name (NovaNote.subjectId, topicName), so a destination is exactly
// that pair: nothing here is a second way of organising notes. Pure, no
// imports but types, shared by the Notes pages and Nova's note proposal
// (note-proposal.ts). Tested in notes-shortcuts.test.ts.

import type { NoteSubjectOption } from './notes.types'

export interface Destination {
  key:       string
  subjectId: string | null
  topicName: string | null
  // From the outermost subject down to it.
  path:      string[]
  kind:      'none' | 'subject' | 'topic'
}

export const NO_SUBJECT: Destination = { key: 'none', subjectId: null, topicName: null, path: ['No subject'], kind: 'none' }

const MAX_DEPTH = 8

export function destinationsOf(subjects: NoteSubjectOption[]): Destination[] {
  const byId = new Map(subjects.map(s => [s.id, s] as const))
  const subjectPath = (s: NoteSubjectOption): string[] => {
    const path: string[] = []
    const seen = new Set<string>()
    for (let at: NoteSubjectOption | undefined = s; at && !seen.has(at.id) && path.length < MAX_DEPTH; at = at.parentId ? byId.get(at.parentId) : undefined) {
      seen.add(at.id); path.unshift(at.name)
    }
    return path
  }
  const out: Destination[] = [NO_SUBJECT]
  for (const s of subjects) {
    const base = subjectPath(s)
    out.push({ key: `s:${s.id}`, subjectId: s.id, topicName: null, path: base, kind: 'subject' })
    const parents = s.topicParents ?? {}
    for (const t of s.topics) {
      const chain: string[] = []
      const seen = new Set<string>()
      for (let at: string | null | undefined = parents[t]; at && !seen.has(at) && chain.length < MAX_DEPTH; at = parents[at]) { seen.add(at); chain.unshift(at) }
      out.push({ key: `t:${s.id}:${t.toLowerCase()}`, subjectId: s.id, topicName: t, path: [...base, ...chain, t], kind: 'topic' })
    }
  }
  return [out[0]!, ...out.slice(1).sort((a, b) => a.path.join(' › ').localeCompare(b.path.join(' › ')))]
}

// Every word typed is somewhere in the path, any case; a destination whose
// own name starts with what was typed comes first.
export function searchDestinations(all: Destination[], query: string): Destination[] {
  const words = query.toLowerCase().split(' ').map(w => w.trim()).filter(Boolean)
  if (!words.length) return all
  const q = words.join(' ')
  const hits = all.filter(d => { const p = d.path.join(' ').toLowerCase(); return words.every(w => p.includes(w)) })
  const own = (d: Destination) => d.path[d.path.length - 1]!.toLowerCase()
  return [...hits.filter(d => own(d).startsWith(q)), ...hits.filter(d => !own(d).startsWith(q))]
}

export const destinationLabel = (d: Destination) => d.path.join(' › ')

export function destinationFor(all: Destination[], subjectId: string | null, topicName: string | null): Destination {
  if (!subjectId) return NO_SUBJECT
  const t = topicName?.trim().toLowerCase()
  return all.find(d => d.subjectId === subjectId && (t ? d.topicName?.toLowerCase() === t : d.kind === 'subject')) ?? NO_SUBJECT
}

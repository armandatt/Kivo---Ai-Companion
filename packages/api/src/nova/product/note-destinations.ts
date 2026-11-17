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

// ── Browsing the destinations as a tree (the one picker: destination-picker.tsx) ──
// Subject → its subjects and topics → a topic's topics, by id, never by
// matching names, so two subjects called "Introduction" stay apart.

export function destinationParents(subjects: NoteSubjectOption[]): Map<string, string | null> {
  const parents = new Map<string, string | null>([[NO_SUBJECT.key, null]]);
  const ids = new Set(subjects.map(s => s.id));
  for (const s of subjects) {
    parents.set(`s:${s.id}`, s.parentId && ids.has(s.parentId) && s.parentId !== s.id ? `s:${s.parentId}` : null);
    const tp = s.topicParents ?? {};
    const own = new Set(s.topics.map(t => t.toLowerCase()));
    for (const t of s.topics) {
      const p = tp[t];
      parents.set(`t:${s.id}:${t.toLowerCase()}`, p && own.has(p.toLowerCase()) && p.toLowerCase() !== t.toLowerCase() ? `t:${s.id}:${p.toLowerCase()}` : `s:${s.id}`);
    }
  }
  return parents;
}

/** What sits directly inside `parentKey` (null: the top level), subjects first, then topics, by name. */
export function childrenOf(all: Destination[], parents: Map<string, string | null>, parentKey: string | null): Destination[] {
  const kids = all.filter(d => d.kind !== "none" && (parents.get(d.key) ?? null) === parentKey);
  const name = (d: Destination) => d.path[d.path.length - 1]!.toLowerCase();
  return kids.sort((a, b) => (a.kind === b.kind ? name(a).localeCompare(name(b)) : a.kind === "subject" ? -1 : 1));
}

/** The chain from the top level down to `key` (for the breadcrumb), the key itself last. */
export function ancestorsOf(parents: Map<string, string | null>, key: string | null): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  for (let at = key; at && !seen.has(at) && chain.length < 20; at = parents.get(at) ?? null) { seen.add(at); chain.unshift(at); }
  return chain;
}

/** An existing topic of this subject with this name (any case), or null: typing never makes a topic. */
export function existingTopic(all: Destination[], subjectId: string, name: string): Destination | null {
  const n = name.trim().toLowerCase();
  return n ? all.find(d => d.kind === "topic" && d.subjectId === subjectId && d.topicName?.toLowerCase() === n) ?? null : null;
}

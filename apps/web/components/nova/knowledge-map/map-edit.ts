import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { NOTE_LINK_TITLE_MAX, linkKey, linkedTitles } from '@repo/api/nova/product/note-links'

// What the map may change, and only through what already exists:
//   - a link from a note to a note or topic is the text [[Title]] in the
//     note's body, added by the ordinary guarded note save;
//   - a note or saved page is filed under one of the learner's subjects (and
//     one of its topics) by the ordinary note save or saved-page filing.
// Nothing here is stored and nothing is sent: these are the rules the page
// checks before it asks. A link is refused whenever [[Title]] could open
// something other than the item the learner chose. Pure.

export type LinkPlan =
  | { ok: true; title: string; expect: { noteId: string } | { topicId: string } }
  | { ok: false; reason: string }

const rowId = (node: MapNode) => node.id.slice(node.id.indexOf(':') + 1)

// Whether [[Title]] can name this target, written as it stands.
function writable(title: string): string | null {
  if (!title.trim()) return 'It has no title to link to.'
  if (title.length > NOTE_LINK_TITLE_MAX) return 'Its title is too long to write as a link.'
  if (title.includes('[[') || title.includes(']]') || title.includes('|') || title.includes('\n')) {
    return 'Its title has characters a [[link]] cannot hold. Link it in the note editor instead.'
  }
  return null
}

export function planLink(source: MapNode, target: MapNode, nodes: MapNode[], edges: MapEdge[]): LinkPlan {
  if (source.type !== 'note') return { ok: false, reason: 'Only a note can link to something.' }
  if (target.type !== 'note' && target.type !== 'topic') return { ok: false, reason: 'A note links to another note or to a topic.' }
  if (target.id === source.id) return { ok: false, reason: 'A note cannot link to itself.' }
  if (edges.some(e => e.kind === 'links_to' && e.from === source.id && e.to === target.id)) {
    return { ok: false, reason: `“${source.label}” already links to it.` }
  }
  const title = target.label
  const bad = writable(title)
  if (bad) return { ok: false, reason: bad }
  const key = linkKey(title)
  const notesNamed  = nodes.filter(n => n.type === 'note' && linkKey(n.label) === key)
  const topicsNamed = nodes.filter(n => n.type === 'topic' && linkKey(n.label) === key)
  if (target.type === 'note') {
    // Two notes with one title: a link opens the more recently edited, which
    // can change with any edit. Refused rather than guessed.
    if (notesNamed.length > 1) return { ok: false, reason: `More than one of your notes is called “${title}”. Rename one, then link to it.` }
    return { ok: true, title, expect: { noteId: rowId(target) } }
  }
  // A link opens a note of that title before a topic of that name.
  if (notesNamed.length > 0) return { ok: false, reason: `A note is also called “${title}”, so [[${title}]] would open the note, not the topic.` }
  if (topicsNamed.length > 1) {
    const where = topicsNamed.map(t => (t.type === 'topic' ? t.subjectName : '')).filter(Boolean).join(' and ')
    return { ok: false, reason: `More than one topic is called “${title}”${where ? ` (in ${where})` : ''}, so a link cannot say which.` }
  }
  return { ok: true, title, expect: { topicId: rowId(target) } }
}

// The body with [[title]] added on a line of its own at the end. Nothing
// already written changes. null: added there, it would not be a link (the
// note ends inside a ``` block), so it is not added.
export function appendLink(body: string, title: string): string | null {
  const link = `[[${title}]]`
  const next = body.length === 0 ? link : body + (body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n') + link
  return linkedTitles(next).some(t => linkKey(t) === linkKey(title)) ? next : null
}

export const alreadyLinks = (body: string, title: string) => linkedTitles(body).some(t => linkKey(t) === linkKey(title))

// ── Filing ───────────────────────────────────────────────────────────────────

export interface Placement { subjectId: string; topicName: string | null }

// Where a note or saved page is filed now. null: under nothing.
export function placementOf(node: MapNode): Placement | null {
  if ((node.type !== 'note' && node.type !== 'resource') || !node.subjectId) return null
  return { subjectId: node.subjectId, topicName: node.topicLinked ? node.topicName : null }
}

export const samePlacement = (a: Placement | null, b: Placement | null) =>
  a !== null && b !== null && a.subjectId === b.subjectId && linkKey(a.topicName ?? '') === linkKey(b.topicName ?? '')

// The places the map offers: the learner's subjects on the map, each with its
// topics on the map. Only what exists; nothing is created by filing.
export function filingChoices(nodes: MapNode[]): Array<{ subjectId: string; name: string; topics: string[] }> {
  return nodes.filter(n => n.type === 'subject' && n.subjectId).map(s => ({
    subjectId: s.subjectId!, name: s.label,
    topics: nodes.filter(t => t.type === 'topic' && t.subjectId === s.subjectId).map(t => t.label).sort((a, b) => a.localeCompare(b)),
  }))
}

// "Operating Systems › Deadlocks", or "Operating Systems" for the subject alone.
export function placementLabel(p: Placement | null, nodes: MapNode[]): string {
  if (!p) return 'Not filed'
  const subject = nodes.find(n => n.type === 'subject' && n.subjectId === p.subjectId)?.label ?? 'a subject'
  return p.topicName ? `${subject} › ${p.topicName}` : subject
}

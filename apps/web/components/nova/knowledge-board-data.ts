// What Today's Knowledge board and Recently captured lay out, taken from the
// Knowledge Map and Today views as they are. Grouping and one date order only:
// nothing here ranks, scores or links anything the server did not.
// Run with `npm test`.

import type { MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'

type Subject  = Extract<MapNode, { type: 'subject' }>
type Topic    = Extract<MapNode, { type: 'topic' }>
type Resource = Extract<MapNode, { type: 'resource' }>

export type SubjectCard = { subject: Subject; topics: Topic[] }

// One card per subject, in the map's order, with the subject's topics in the
// map's order. A topic belongs to the subject whose id it carries.
export function subjectCards(map: Pick<NovaKnowledgeMapReady, 'nodes'>): SubjectCard[] {
  const subjects = map.nodes.filter((n): n is Subject => n.type === 'subject')
  const topics   = map.nodes.filter((n): n is Topic => n.type === 'topic')
  return subjects.map(subject => ({ subject, topics: topics.filter(t => t.subjectId === subject.subjectId) }))
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

// Which topics to mark due. Today lists only the first few due topics, so a
// marker is drawn only when that list is the whole of them; otherwise none is,
// and the board gives the count instead. Never a due topic left unmarked
// beside marked ones.
export function dueMarks(reviewDue: NovaTodayReady['reviewDue']): { complete: boolean; isDue: (topic: Topic) => boolean } {
  const complete = reviewDue.count === reviewDue.topics.length
  const due = new Set(reviewDue.topics.map(t => `${norm(t.subjectName)}\u0000${norm(t.topicName)}`))
  return { complete, isDue: topic => complete && due.has(`${norm(topic.subjectName)}\u0000${norm(topic.label)}`) }
}

// Saved pages newest first, by the date each was saved. The map holds the
// newest ones, so the most recent are always among them.
export function recentPages(map: Pick<NovaKnowledgeMapReady, 'nodes'>, shown: number): Resource[] {
  return map.nodes
    .filter((n): n is Resource => n.type === 'resource')
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, shown)
}

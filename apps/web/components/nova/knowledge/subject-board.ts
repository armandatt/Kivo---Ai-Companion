import type { MapEdge, MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'

// One subject laid out as a board: each of its topics with the notes and
// saved pages filed under that topic, what is filed under the subject alone,
// and the [[links]] the learner wrote that touch any of it. Read from the
// Knowledge Map's edges as they are: an item sits under a topic only when an
// edge says so, and no link is drawn that the map did not return. Map order
// throughout. Pure, so it is tested without a page.

export type Topic = Extract<MapNode, { type: 'topic' }>
export type Item  = Extract<MapNode, { type: 'note' | 'resource' }>

export interface BoardTopic { topic: Topic; items: Item[] }
export interface BoardLink  { id: string; from: MapNode; to: MapNode }

export interface SubjectBoard {
  topics: BoardTopic[]
  // Filed under the subject, under no topic.
  loose:  Item[]
  links:  BoardLink[]
}

const isItem = (n: MapNode | undefined): n is Item => n?.type === 'note' || n?.type === 'resource'

export function subjectBoard(map: Pick<NovaKnowledgeMapReady, 'nodes' | 'edges'>, subjectId: string): SubjectBoard {
  const byId = new Map(map.nodes.map(n => [n.id, n]))
  const subjectNode = `subject:${subjectId}`
  const edges = map.edges as MapEdge[]

  const topics: BoardTopic[] = edges
    .filter(e => e.kind === 'has_topic' && e.from === subjectNode)
    .map(e => byId.get(e.to))
    .filter((n): n is Topic => n?.type === 'topic')
    .map(topic => ({
      topic,
      items: edges.filter(e => e.kind === 'about_topic' && e.from === topic.id).map(e => byId.get(e.to)).filter(isItem),
    }))

  const loose = edges
    .filter(e => e.kind === 'filed_under' && e.from === subjectNode)
    .map(e => byId.get(e.to))
    .filter(isItem)

  const here = new Set<string>([subjectNode, ...topics.flatMap(t => [t.topic.id, ...t.items.map(i => i.id)]), ...loose.map(i => i.id)])
  const links: BoardLink[] = []
  for (const edge of edges) {
    if (edge.kind !== 'links_to' || !(here.has(edge.from) || here.has(edge.to))) continue
    const from = byId.get(edge.from)
    const to   = byId.get(edge.to)
    if (from && to) links.push({ id: edge.id, from, to })
  }

  return { topics, loose, links }
}

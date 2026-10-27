import type { MapEdge, MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'

// One subject laid out as a board: each of its topics (topics inside topics
// too, in saved order, each with its depth) with the notes and saved pages
// filed under that topic, what is filed under the subject alone,
// and the [[links]] the learner wrote that touch any of it. Read from the
// Knowledge Map's edges as they are: an item sits under a topic only when an
// edge says so, and no link is drawn that the map did not return. Map order
// throughout. Pure, so it is tested without a page.

export type Topic = Extract<MapNode, { type: 'topic' }>
export type Item  = Extract<MapNode, { type: 'note' | 'resource' }>

// depth 0: at the top of the subject; parent: the topic it sits inside.
export interface BoardTopic { topic: Topic; items: Item[]; depth: number; parent: string | null }
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

  // Depth first from the subject, following "has_topic" then "subtopic"
  // edges, so a topic is followed by what is inside it. Map order among
  // siblings (a topic's saved position first).
  const childrenOf = (from: string, kind: 'has_topic' | 'subtopic') => edges
    .filter(e => e.kind === kind && e.from === from)
    .map(e => byId.get(e.to))
    .filter((n): n is Topic => n?.type === 'topic')
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (a.n.order ?? Infinity) - (b.n.order ?? Infinity) || a.i - b.i)
    .map(({ n }) => n)
  const topics: BoardTopic[] = []
  const seen = new Set<string>()
  const walk = (topic: Topic, depth: number, parent: string | null) => {
    if (seen.has(topic.id)) return
    seen.add(topic.id)
    topics.push({ topic, depth, parent, items: edges.filter(e => e.kind === 'about_topic' && e.from === topic.id).map(e => byId.get(e.to)).filter(isItem) })
    for (const child of childrenOf(topic.id, 'subtopic')) walk(child, depth + 1, topic.id)
  }
  for (const top of childrenOf(subjectNode, 'has_topic')) walk(top, 0, null)

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

// What is joined to one thing on the board, for drawing attention to it: a
// topic with what is filed under it, an item with the topic it is filed
// under, and either with the far end of every stored link that touches it
// or anything filed under it. The thing itself is included.
export function boardNeighbourhood(board: SubjectBoard, id: string): Set<string> {
  const near = new Set<string>([id])
  const tile = board.topics.find(t => t.topic.id === id || t.items.some(i => i.id === id))
  if (tile) {
    near.add(tile.topic.id)
    if (tile.topic.id === id) tile.items.forEach(i => near.add(i.id))
  }
  const ends = new Set(near)
  for (const link of board.links) {
    if (ends.has(link.from.id)) near.add(link.to.id)
    if (ends.has(link.to.id)) near.add(link.from.id)
  }
  return near
}

// The subject a node belongs to, by name: a subject is its own.
export function nodeSubject(node: MapNode): string | null {
  return node.type === 'subject' ? node.label : node.subjectName
}

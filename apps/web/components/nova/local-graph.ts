// The part of the Knowledge Map that touches one topic: the topic, its
// subject, and the notes and saved pages linked to it. Only edges the server
// returned are followed, one step out; nothing is inferred and nothing is
// ranked: neighbours keep the map's own order. Run with `npm test`.

import type { MapEdge, MapEdgeKind, MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'

export type LocalNeighbour = { node: MapNode; kind: MapEdgeKind }

export type LocalGraph = {
  topic:      Extract<MapNode, { type: 'topic' }>
  neighbours: LocalNeighbour[]
  // Linked items not drawn because of `limit`. They are on the map.
  hidden:     number
}

// A topic is the same topic when it has the same subject and name, compared
// the way the map compares names: trimmed, single-spaced, any case.
const same = (a: string, b: string) => {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return norm(a) === norm(b)
}

// The map's node for a topic named by its subject and name, if it has one.
export function topicNode(
  map: Pick<NovaKnowledgeMapReady, 'nodes'>,
  where: { subjectName: string; topicName: string },
): Extract<MapNode, { type: 'topic' }> | null {
  return map.nodes.find((n): n is Extract<MapNode, { type: 'topic' }> =>
    n.type === 'topic' && same(n.subjectName, where.subjectName) && same(n.label, where.topicName)) ?? null
}

export function localGraph(
  map: Pick<NovaKnowledgeMapReady, 'nodes' | 'edges'>,
  where: { subjectName: string; topicName: string },
  limit = 8,
): LocalGraph | null {
  const topic = topicNode(map, where)
  if (!topic) return null

  const byId = new Map(map.nodes.map(n => [n.id, n]))
  const seen = new Set<string>()
  const all: LocalNeighbour[] = []
  for (const edge of map.edges as MapEdge[]) {
    const other = edge.from === topic.id ? edge.to : edge.to === topic.id ? edge.from : null
    if (other === null || seen.has(other)) continue
    const node = byId.get(other)
    if (!node) continue
    seen.add(other)
    all.push({ node, kind: edge.kind })
  }
  if (all.length === 0) return null
  return { topic, neighbours: all.slice(0, limit), hidden: Math.max(0, all.length - limit) }
}

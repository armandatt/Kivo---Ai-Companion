// ─── Finding a card, and saying where it is ─────────────────────────────────
// Knowledge Map 3.0. Search reads what the map already has: a card's name,
// what it is filed under, a saved page's site. A result says where it sits
// in the tree ("Machine Learning › Optimisation"), so the learner knows what
// they are jumping to. Pure.

import type { MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'

// What a card is found by, lower-cased.
function textOf(n: MapNode): { name: string; rest: string } {
  const rest = [
    'subjectName' in n ? n.subjectName : null,
    'topicName' in n ? n.topicName : null,
    n.type === 'resource' ? n.domain : null,
  ].filter(Boolean).join('\n')
  return { name: n.label.toLowerCase(), rest: rest.toLowerCase() }
}

const TYPE_ORDER: Record<MapNodeType, number> = { subject: 0, topic: 1, note: 2, resource: 3, task: 4 }

// Matches, best first: a name that starts with the query, then one with a
// word that does, then a name that contains it, then a match on what it is
// filed under. Within each, subjects and topics before notes, pages and tasks.
export function searchMap(nodes: readonly MapNode[], query: string, limit = 12): MapNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: Array<{ n: MapNode; score: number }> = []
  for (const n of nodes) {
    const { name, rest } = textOf(n)
    const score = name.startsWith(q) ? 0 : name.split(/[\s\-_/:.()]+/).some(w => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : rest.includes(q) ? 3 : -1
    if (score >= 0) scored.push({ n, score })
  }
  scored.sort((a, b) => a.score - b.score || TYPE_ORDER[a.n.type] - TYPE_ORDER[b.n.type] || a.n.label.localeCompare(b.n.label))
  return scored.slice(0, limit).map(s => s.n)
}

// Every card the query matches (for lighting them on the map), without a limit.
export function matchesOf(nodes: readonly MapNode[], query: string): Set<string> {
  return new Set(searchMap(nodes, query, Number.MAX_SAFE_INTEGER).map(n => n.id))
}

// The names of what a card sits inside, from the top: the tree as drawn.
export function pathOf(id: string, parent: ReadonlyMap<string, string>, label: (id: string) => string | undefined, max = 6): string[] {
  const out: string[] = []
  for (let p = parent.get(id), hops = 0; p && hops < max; p = parent.get(p), hops++) {
    const l = label(p)
    if (l) out.unshift(l)
  }
  return out
}

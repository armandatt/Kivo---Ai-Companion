// ─── Everything as an overview ──────────────────────────────────────────────
// Everything shows the learner's knowledge architecture, not every item at
// once: subjects (and the subjects inside them) and their top-level topics.
// Notes, saved pages, tasks and topics deeper than the first level are folded
// into counts on the card they hang from, and open by going into that card
// (Explore) or by search. Nothing is removed: this decides what is drawn at
// this level of attention, never what exists. A workspace's own map, and any
// card explored, show everything as before. Pure.

import type { MapEdge, MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'

export type Density = 'overview' | 'all'

export interface FoldedCounts { topics: number; notes: number; resources: number; tasks: number }
export interface OverviewDensity {
  // Drawn later, by going in: not drawn at this level.
  hidden: Set<string>
  // On each card drawn, what is folded under it.
  folded: Map<string, FoldedCounts>
  // Items filed under nothing, folded too (said in the overview's corner).
  loose: number
}

const DETAIL_TYPES: ReadonlySet<MapNodeType> = new Set(['note', 'resource', 'task'])

export function overviewDensity(nodes: readonly MapNode[], parent: ReadonlyMap<string, string>): OverviewDensity {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const hidden = new Set<string>()
  const folded = new Map<string, FoldedCounts>()
  let loose = 0
  // Topics from the top of their subject: 1 is a subject's own topic.
  const topicDepth = (id: string) => {
    let d = 0
    for (let at: string | undefined = id, hops = 0; at && hops < nodes.length; at = parent.get(at), hops++) if (byId.get(at)?.type === 'topic') d++
    return d
  }
  const isDetail = (n: MapNode) => DETAIL_TYPES.has(n.type) || (n.type === 'topic' && topicDepth(n.id) >= 2)
  for (const n of nodes) {
    if (!isDetail(n)) continue
    hidden.add(n.id)
    // The nearest card still drawn holds the count.
    let holder: string | undefined = parent.get(n.id)
    for (let hops = 0; holder && byId.has(holder) && isDetail(byId.get(holder)!) && hops < nodes.length; hops++) holder = parent.get(holder)
    if (!holder || !byId.has(holder)) { loose++; continue }
    const c = folded.get(holder) ?? { topics: 0, notes: 0, resources: 0, tasks: 0 }
    if (n.type === 'topic') c.topics++
    else if (n.type === 'note') c.notes++
    else if (n.type === 'resource') c.resources++
    else c.tasks++
    folded.set(holder, c)
  }
  return { hidden, folded, loose }
}

export const foldedTotal = (c: FoldedCounts | undefined) => (c ? c.topics + c.notes + c.resources + c.tasks : 0)

// "4 topics · 3 notes · 1 page" for what is folded under a card.
export function foldedLabel(c: FoldedCounts): string {
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : null)
  return [part(c.topics, 'topic', 'topics'), part(c.notes, 'note', 'notes'), part(c.resources, 'page', 'pages'), part(c.tasks, 'task', 'tasks')].filter(Boolean).join(' · ')
}

// The top of a card's tree: the subject it belongs to, at the top.
export function rootOf(id: string, parent: ReadonlyMap<string, string>, max = 64): string {
  let r = id
  for (let p = parent.get(r), hops = 0; p && hops < max; p = parent.get(p), hops++) r = p
  return r
}

// Links that cross from one top-level subject to another, counted per pair:
// only [[links]] the learner wrote (links_to). Never made up for balance.
export interface SubjectLink { a: string; b: string; count: number }
export function crossSubjectLinks(edges: readonly MapEdge[], parent: ReadonlyMap<string, string>, isSubject: (id: string) => boolean): SubjectLink[] {
  const pairs = new Map<string, SubjectLink>()
  for (const e of edges) {
    if (e.kind !== 'links_to') continue
    const ra = rootOf(e.from, parent), rb = rootOf(e.to, parent)
    if (ra === rb || !isSubject(ra) || !isSubject(rb)) continue
    const [a, b] = ra < rb ? [ra, rb] : [rb, ra]
    const key = `${a}\n${b}`
    const p = pairs.get(key) ?? { a, b, count: 0 }
    p.count++
    pairs.set(key, p)
  }
  return [...pairs.values()].sort((x, y) => y.count - x.count)
}

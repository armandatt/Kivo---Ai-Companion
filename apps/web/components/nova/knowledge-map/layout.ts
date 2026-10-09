import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'

// Where each node is drawn. The picture is worked out from the links on
// record and nothing else: a subject in the middle of its topics, a topic's
// notes and saved pages fanned out behind it, and what is filed under the
// subject alone on a ring close to it. No physics, so the same data always
// draws the same map and nothing moves while it is being read.

export interface Placed { id: string; x: number; y: number }
export interface MapLayout {
  at:     Map<string, Placed>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  // Top-left of the block of items filed under nothing. null: there are none.
  loose:  { x: number; y: number; width: number } | null
}

const TOPIC_GAP  = 92     // room along the ring for one topic
const LEAF_GAP   = 46     // room along an arc for one note or page
const INNER_RING = 96     // items filed under the subject only
const MIN_TOPIC_RING = 190
const LEAF_OUT   = 84     // how far behind its topic a leaf sits
const LOOSE_COLS = 6
const LOOSE_DX   = 150
const LOOSE_DY   = 64

export function layoutMap(nodes: MapNode[], edges: MapEdge[]): MapLayout {
  const at = new Map<string, Placed>()
  const present = new Set(nodes.map(n => n.id))
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()
  for (const e of edges) {
    if (!present.has(e.from) || !present.has(e.to)) continue
    children.set(e.from, [...(children.get(e.from) ?? []), e.to])
    hasParent.add(e.to)
  }
  const type = new Map(nodes.map(n => [n.id, n.type]))

  // One cluster per subject, sized by what hangs from it.
  const subjects = nodes.filter(n => n.type === 'subject')
  const clusters = subjects.map(s => {
    const kids   = children.get(s.id) ?? []
    const topics = kids.filter(k => type.get(k) === 'topic')
    const direct = kids.filter(k => type.get(k) !== 'topic')
    const deepest = Math.max(0, ...topics.map(t => (children.get(t) ?? []).length))
    const ring   = Math.max(MIN_TOPIC_RING, (topics.length * TOPIC_GAP) / (2 * Math.PI))
    const radius = ring + (deepest > 0 ? LEAF_OUT + 40 + Math.floor((deepest - 1) / 5) * 34 : 60)
    return { id: s.id, topics, direct, ring, radius }
  })

  // Clusters stand on a circle wide enough that neighbours do not touch.
  const widest = Math.max(0, ...clusters.map(c => c.radius))
  const orbit  = clusters.length <= 1 ? 0 : (widest + 30) / Math.sin(Math.PI / clusters.length)
  clusters.forEach((c, i) => {
    const a  = clusters.length <= 1 ? 0 : (2 * Math.PI * i) / clusters.length - Math.PI / 2
    const cx = orbit * Math.cos(a), cy = orbit * Math.sin(a)
    at.set(c.id, { id: c.id, x: cx, y: cy })

    // Topics around the subject, starting at the top.
    c.topics.forEach((t, j) => {
      const ta = (2 * Math.PI * j) / Math.max(1, c.topics.length) - Math.PI / 2
      const tx = cx + c.ring * Math.cos(ta), ty = cy + c.ring * Math.sin(ta)
      at.set(t, { id: t, x: tx, y: ty })
      // A topic's notes and pages fan out behind it, away from the subject,
      // five to an arc.
      const leaves = children.get(t) ?? []
      leaves.forEach((leaf, k) => {
        const row   = Math.floor(k / 5), inRow = Math.min(5, leaves.length - row * 5), pos = k % 5
        const r     = LEAF_OUT + row * 34
        const span  = Math.min(1.25, ((inRow - 1) * LEAF_GAP) / r)
        const la    = ta + (inRow === 1 ? 0 : -span / 2 + (span * pos) / (inRow - 1))
        at.set(leaf, { id: leaf, x: tx + r * Math.cos(la), y: ty + r * Math.sin(la) })
      })
    })
    // Filed under the subject only: close in, between the subject and its topics.
    c.direct.forEach((d, j) => {
      const da = (2 * Math.PI * j) / Math.max(1, c.direct.length) - Math.PI / 2 + (c.topics.length > 0 ? Math.PI / Math.max(1, c.topics.length) : 0)
      const r  = INNER_RING + (j % 2) * 26
      at.set(d, { id: d, x: cx + r * Math.cos(da), y: cy + r * Math.sin(da) })
    })
  })

  const edge = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of at.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
    return at.size === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY }
  }

  // Filed under nothing: a plain block below the rest, never joined to it.
  const alone = nodes.filter(n => !at.has(n.id) && !hasParent.has(n.id))
  let loose: MapLayout['loose'] = null
  if (alone.length > 0) {
    const b      = edge()
    const cols   = Math.min(LOOSE_COLS, alone.length)
    const width  = (cols - 1) * LOOSE_DX
    const left   = at.size === 0 ? -width / 2 : (b.minX + b.maxX) / 2 - width / 2
    const top    = at.size === 0 ? 0 : b.maxY + 150
    alone.forEach((n, i) => at.set(n.id, { id: n.id, x: left + (i % cols) * LOOSE_DX, y: top + Math.floor(i / cols) * LOOSE_DY }))
    loose = { x: left, y: top, width }
  }
  // Anything still unplaced (its parent is filtered out): with the loose block.
  const rest = nodes.filter(n => !at.has(n.id))
  if (rest.length > 0) {
    const b = edge()
    rest.forEach((n, i) => at.set(n.id, { id: n.id, x: b.minX + (i % LOOSE_COLS) * LOOSE_DX, y: b.maxY + 110 + Math.floor(i / LOOSE_COLS) * LOOSE_DY }))
  }

  const b = edge()
  return { at, bounds: { minX: b.minX - 130, minY: b.minY - 90, maxX: b.maxX + 130, maxY: b.maxY + 90 }, loose }
}

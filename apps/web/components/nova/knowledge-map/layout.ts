import type { MapEdge, MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'

// Where each card is drawn. The picture is worked out from the links on
// record and nothing else: a subject in the middle of its topics, a topic's
// notes and saved pages in a block behind it, and what is filed under the
// subject alone on rings close to it. No physics, so the same data always
// draws the same map and nothing moves while it is being read. A card the
// learner moved keeps the place they gave it (withPositions); every other
// card stays where this puts it.

export interface Placed { id: string; x: number; y: number }
export interface MapLayout {
  at:     Map<string, Placed>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  // Top-left of the block of items filed under nothing. null: there are none.
  loose:  { x: number; y: number; width: number } | null
}

// The size of each kind of card, centred on its position.
export const CARD: Record<MapNodeType, { w: number; h: number }> = {
  subject:  { w: 208, h: 66 },
  topic:    { w: 180, h: 58 },
  note:     { w: 164, h: 48 },
  resource: { w: 164, h: 48 },
  task:     { w: 168, h: 44 },
}

const LEAF_DX     = 180   // a column of notes and pages behind a topic
const LEAF_DY     = 58    // a row of them
const LEAF_GAP    = 34    // between a topic and its block
const TOPIC_MIN_W = 220   // room around the ring for one topic
const MIN_RING    = 210
const DIRECT_GAP  = 30    // between a subject and what is filed under it alone
const CLUSTER_GAP = 120
const LOOSE_COLS  = 5   // in portrait, 2
const LOOSE_DX    = 184
const LOOSE_DY    = 62
const STEP_DX     = 26    // a step sits this far in from the task it belongs to

// How far a w × h box reaches from its centre in the direction (c, s).
const reach = (w: number, h: number, c: number, s: number) => Math.abs(c) * w / 2 + Math.abs(s) * h / 2

// portrait: the map is drawn for a frame taller than it is wide (a phone):
// subjects one under another, each with its topics above and below it.
export function layoutMap(nodes: MapNode[], edges: MapEdge[], { portrait = false }: { portrait?: boolean } = {}): MapLayout {
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
  // A task's steps (has_step), nested to any depth, are drawn under it in the
  // same block, each level indented: the block reads as the outline it is.
  const stepsOf = new Map<string, string[]>()
  for (const e of edges) if (e.kind === 'has_step' && present.has(e.from) && present.has(e.to)) stepsOf.set(e.from, [...(stepsOf.get(e.from) ?? []), e.to])
  const withSteps = (ids: string[]): Array<{ id: string; depth: number }> => {
    const out: Array<{ id: string; depth: number }> = []
    const seen = new Set<string>()
    const walk = (id: string, depth: number) => {
      if (seen.has(id)) return
      seen.add(id); out.push({ id, depth })
      for (const c of stepsOf.get(id) ?? []) walk(c, depth + 1)
    }
    for (const id of ids) walk(id, 0)
    return out
  }

  // One cluster per subject, laid out around (0, 0) first and sized by what
  // hangs from it.
  const clusters = nodes.filter(n => n.type === 'subject').map(s => {
    const kids   = children.get(s.id) ?? []
    const topics = kids.filter(k => type.get(k) === 'topic').map(id => {
      const items   = withSteps(children.get(id) ?? [])
      const leaves  = items.map(i => i.id)
      const nested  = items.some(i => i.depth > 0)
      const deepest = Math.max(0, ...items.map(i => i.depth))
      // An outline is one column; a plain block of notes and pages, a grid.
      const perRow  = nested ? 1 : leaves.length > 6 ? 3 : leaves.length > 1 ? 2 : 1
      const rows    = Math.ceil(leaves.length / perRow)
      const blockW  = leaves.length === 0 ? 0 : perRow * LEAF_DX - (LEAF_DX - CARD.note.w) + deepest * STEP_DX
      const blockH  = leaves.length === 0 ? 0 : rows * LEAF_DY - (LEAF_DY - CARD.note.h)
      return { id, leaves, depth: new Map(items.map(i => [i.id, i.depth])), perRow, blockW, blockH, weight: Math.max(TOPIC_MIN_W, Math.max(blockW, blockH) + 48) }
    })
    const directItems = withSteps(kids.filter(k => type.get(k) !== 'topic'))
    const direct = directItems.map(i => i.id)
    const directDepth = new Map(directItems.map(i => [i.id, i.depth]))

    // Items filed under the subject only: a block just below it, inside the
    // ring of topics.
    const dCols   = directItems.some(i => i.depth > 0) ? 1 : direct.length > 4 ? 3 : Math.min(2, direct.length)
    const dRows   = dCols === 0 ? 0 : Math.ceil(direct.length / dCols)
    const dTop    = CARD.subject.h / 2 + DIRECT_GAP
    const dBottom = dTop + dRows * LEAF_DY - (LEAF_DY - CARD.note.h)
    const directReach = dRows === 0 ? CARD.subject.w / 2 : Math.hypot((dCols * LEAF_DX) / 2, dBottom)
    const total = topics.reduce((sum, t) => sum + t.weight, 0)
    const ring  = topics.length === 0 ? 0 : Math.max(MIN_RING, total / (2 * Math.PI), directReach + CARD.topic.w / 2 + 40)

    const local = new Map<string, { x: number; y: number }>()
    local.set(s.id, { x: 0, y: 0 })
    let used = 0
    for (const t of topics) {
      // The first topic on the right (at the top in portrait) and round from
      // there, so two topics sit either side: a cluster has the frame's shape.
      const start = portrait ? -Math.PI / 2 : 0
      const a = start + (topics.length === 1 ? 0 : (2 * Math.PI * (used + t.weight / 2)) / total - (Math.PI * topics[0]!.weight) / total)
      used += t.weight
      const c = Math.cos(a), sn = Math.sin(a)
      const tx = ring * c, ty = ring * sn
      local.set(t.id, { x: tx, y: ty })
      if (t.leaves.length === 0) continue
      // The topic's notes and pages: a block behind it, away from the subject.
      const d  = reach(CARD.topic.w, CARD.topic.h, c, sn) + LEAF_GAP + reach(t.blockW, t.blockH, c, sn)
      const bx = tx + d * c, by = ty + d * sn
      t.leaves.forEach((leaf, k) => {
        const row = Math.floor(k / t.perRow), col = k % t.perRow
        const inRow = Math.min(t.perRow, t.leaves.length - row * t.perRow)
        local.set(leaf, {
          x: bx + (col - (inRow - 1) / 2) * LEAF_DX + ((t.depth.get(leaf) ?? 0) - (t.perRow === 1 ? Math.max(0, ...t.depth.values()) / 2 : 0)) * STEP_DX,
          y: by - t.blockH / 2 + CARD.note.h / 2 + row * LEAF_DY,
        })
      })
    }
    // Filed under the subject only.
    direct.forEach((d, k) => {
      const row = Math.floor(k / dCols), col = k % dCols
      const inRow = Math.min(dCols, direct.length - row * dCols)
      local.set(d, { x: (col - (inRow - 1) / 2) * LEAF_DX + (directDepth.get(d) ?? 0) * STEP_DX, y: dTop + CARD.note.h / 2 + row * LEAF_DY })
    })

    // How far the cluster reaches from its subject each way, cards included.
    const box = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    for (const [id, p] of local) {
      const size = CARD[type.get(id) ?? 'note']
      box.minX = Math.min(box.minX, p.x - size.w / 2); box.maxX = Math.max(box.maxX, p.x + size.w / 2)
      box.minY = Math.min(box.minY, p.y - size.h / 2); box.maxY = Math.max(box.maxY, p.y + size.h / 2)
    }
    return { id: s.id, local, box }
  })

  // Clusters on shelves, left to right, as many to a shelf as keep the whole
  // about as wide as a screen (one to a shelf in portrait), each shelf as
  // tall as its tallest cluster.
  const perShelf = portrait ? 1 : Math.max(1, Math.ceil(Math.sqrt(clusters.length * 1.8)))
  let shelfTop = 0
  for (let i = 0; i < clusters.length; i += perShelf) {
    const shelf = clusters.slice(i, i + perShelf)
    const up    = Math.max(...shelf.map(c => -c.box.minY))
    const down  = Math.max(...shelf.map(c => c.box.maxY))
    const width = shelf.reduce((sum, c) => sum + c.box.maxX - c.box.minX, 0) + CLUSTER_GAP * (shelf.length - 1)
    let x = -width / 2
    for (const c of shelf) {
      // In portrait the subjects share one vertical line.
      const cx = portrait ? 0 : x - c.box.minX, cy = shelfTop + up
      for (const [id, p] of c.local) at.set(id, { id, x: cx + p.x, y: cy + p.y })
      x += c.box.maxX - c.box.minX + CLUSTER_GAP
    }
    shelfTop += up + down + CLUSTER_GAP
  }

  const centres = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of at.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
    return at.size === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY }
  }

  // Filed under nothing: a plain block below the rest, never joined to it.
  const alone = nodes.filter(n => !at.has(n.id) && !hasParent.has(n.id))
  let loose: MapLayout['loose'] = null
  if (alone.length > 0) {
    const b     = centres()
    const cols  = Math.min(portrait ? 2 : LOOSE_COLS, alone.length)
    const width = (cols - 1) * LOOSE_DX
    const left  = at.size === 0 ? -width / 2 : (b.minX + b.maxX) / 2 - width / 2
    const top   = at.size === 0 ? 0 : b.maxY + 170
    alone.forEach((n, i) => at.set(n.id, { id: n.id, x: left + (i % cols) * LOOSE_DX, y: top + Math.floor(i / cols) * LOOSE_DY }))
    loose = { x: left, y: top, width }
  }
  // Anything still unplaced (its parent is filtered out): with the loose block.
  const rest = nodes.filter(n => !at.has(n.id))
  if (rest.length > 0) {
    const b = centres()
    rest.forEach((n, i) => at.set(n.id, { id: n.id, x: b.minX + (i % LOOSE_COLS) * LOOSE_DX, y: b.maxY + 120 + Math.floor(i / LOOSE_COLS) * LOOSE_DY }))
  }

  return { at, bounds: boundsOf(at, type), loose }
}

// The box around every card, with room at the bottom for the caption that
// sits over the map.
function boundsOf(at: Map<string, Placed>, type: Map<string, MapNodeType>): MapLayout['bounds'] {
  if (at.size === 0) return { minX: -100, minY: -100, maxX: 100, maxY: 100 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of at.values()) {
    const size = CARD[type.get(p.id) ?? 'note']
    minX = Math.min(minX, p.x - size.w / 2); maxX = Math.max(maxX, p.x + size.w / 2)
    minY = Math.min(minY, p.y - size.h / 2); maxY = Math.max(maxY, p.y + size.h / 2)
  }
  return { minX: minX - 60, minY: minY - 60, maxX: maxX + 60, maxY: maxY + 110 }
}

// The layout with the learner's own positions in place of the computed ones,
// for the cards that are drawn. A position for a card not drawn is ignored.
export function withPositions(layout: MapLayout, nodes: MapNode[], positions: ReadonlyMap<string, { x: number; y: number }>): MapLayout {
  if (positions.size === 0) return layout
  const at = new Map(layout.at)
  for (const n of nodes) {
    const p = positions.get(n.id)
    if (p && at.has(n.id)) at.set(n.id, { id: n.id, x: p.x, y: p.y })
  }
  return { at, bounds: boundsOf(at, new Map(nodes.map(n => [n.id, n.type]))), loose: layout.loose }
}

import type { MapEdge, MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'

// Where each card is drawn. The picture is worked out from the links on
// record and nothing else, as a tree read left to right: a subject, then
// the subjects inside it, its topics in their saved order with the topics
// inside them, the tasks filed under each with their steps, and the notes
// and saved pages filed there, each column one level deeper. Siblings go
// top to bottom in their order, so the map reads in the order the learner
// (or their plan) gave. On a phone (portrait) the same tree is an indented
// outline. What is filed under nothing sits in a block below. No physics,
// so the same data always draws the same map and nothing moves while it is
// being read. A card the learner moved keeps the place they gave it
// (withPositions); every other card stays where this puts it.

export interface Placed { id: string; x: number; y: number }
export interface MapLayout {
  at:     Map<string, Placed>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  // Top-left of the block of items filed under nothing. null: there are none.
  loose:  { x: number; y: number; width: number } | null
  // How the line to a card in a wrapped column (after the first) runs: out
  // to a trunk beside the first column, along the gap above its row, then
  // into it, so it never crosses the cards before it. Kept with the card's
  // own place (x, y): once the learner moves the card, its line is straight.
  lanes?: Map<string, { trunkX: number; laneY: number; x: number; y: number }>
}

// The size of each kind of card, centred on its position.
export const CARD: Record<MapNodeType, { w: number; h: number }> = {
  subject:  { w: 208, h: 66 },
  topic:    { w: 180, h: 58 },
  task:     { w: 176, h: 48 },
  note:     { w: 164, h: 48 },
  resource: { w: 164, h: 48 },
}

// The links that make the tree. A [[link]] and a wait are drawn, never laid out.
export const TREE_EDGES: ReadonlySet<MapEdge['kind']> = new Set(['contains', 'has_topic', 'subtopic', 'has_task', 'step', 'about_topic', 'filed_under'])

const COL       = 250   // one level deeper, to the right
const ROW_GAP   = 14    // between cards one under another
const GROUP_GAP = 24    // around a card with cards hanging from it, so branches read apart
const BRANCH_GAP = 36   // between two subjects' trees
// A run of this many cards with nothing inside them, side by side in a
// branch, wraps into up to WRAP_COLS short columns instead of one long one.
const WRAP      = 8
const WRAP_ROWS = 6
const WRAP_COLS = 3
const WRAP_GAP  = 22    // between the wrapped columns
// Subjects' trees are packed into columns toward this shape (width to
// height), not stacked into one strip. A constant, not the window's shape,
// so resizing never moves anything.
const ASPECT    = 1.6
const TREE_GAP  = 90    // between two columns of subjects' trees
const INDENT    = 34    // a level in the portrait outline
const LOOSE_COLS = 5    // in portrait, 2
const LOOSE_DX  = 184
const LOOSE_DY  = 62

// The order of what hangs from a card: subjects inside it, then topics and
// tasks in their saved order, then notes and saved pages by name. Notes come
// from the server newest first; ordering them by that would move a branch
// every time a note is edited, so the map never uses it.
const RANK: Record<MapNodeType, number> = { subject: 0, topic: 1, task: 2, note: 3, resource: 3 }
const orderOf = (n: MapNode): number => ('order' in n && typeof n.order === 'number' ? n.order : 0)
const byName = (a: MapNode, b: MapNode): number =>
  a.type === 'note' || a.type === 'resource' ? a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : 0

// The tree the links make: each card's children in order, and the cards at
// its top (subjects inside no drawn subject). A card is under one parent
// only, the first link on record that reaches it; a loop is broken.
export function treeOf(nodes: MapNode[], edges: MapEdge[]): { children: Map<string, string[]>; roots: string[]; parent: Map<string, string> } {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const parent = new Map<string, string>()
  for (const e of edges) {
    if (!TREE_EDGES.has(e.kind) || !byId.has(e.from) || !byId.has(e.to) || parent.has(e.to) || e.from === e.to) continue
    // Not under something that is under it.
    let at: string | undefined = e.from, loop = false
    for (let hops = 0; at && hops <= nodes.length; hops++) { if (at === e.to) { loop = true; break } at = parent.get(at) }
    if (!loop) parent.set(e.to, e.from)
  }
  const children = new Map<string, string[]>()
  for (const [child, p] of parent) { const list = children.get(p); if (list) list.push(child); else children.set(p, [child]) }
  for (const list of children.values()) list.sort((a, b) => {
    const x = byId.get(a)!, y = byId.get(b)!
    return RANK[x.type] - RANK[y.type] || orderOf(x) - orderOf(y) || byName(x, y) || index.get(a)! - index.get(b)!
  })
  const roots = nodes.filter(n => n.type === 'subject' && !parent.has(n.id)).map(n => n.id)
  return { children, roots, parent }
}

// portrait: the map is drawn for a frame taller than it is wide (a phone).
export function layoutMap(nodes: MapNode[], edges: MapEdge[], { portrait = false }: { portrait?: boolean } = {}): MapLayout {
  const at = new Map<string, Placed>()
  const lanes = new Map<string, { trunkX: number; laneY: number; x: number; y: number }>()
  const type = new Map(nodes.map(n => [n.id, n.type]))
  const { children, roots, parent } = treeOf(nodes, edges)
  const h = (id: string) => CARD[type.get(id) ?? 'note'].h

  if (portrait) {
    // An outline: every card on its own row, indented by its level.
    let y = 0
    const walk = (id: string, depth: number) => {
      if (at.has(id)) return
      at.set(id, { id, x: depth * INDENT, y: y + h(id) / 2 })
      y += h(id) + ROW_GAP
      for (const c of children.get(id) ?? []) walk(c, depth + 1)
    }
    for (const r of roots) { walk(r, 0); y += BRANCH_GAP }
  } else {
    // A tree: a card's column is its level; it sits level with the middle of
    // what hangs from it, and never over the card above it. `placed` lists
    // cards in the order they were placed, so a branch is one stretch of it.
    const placed: string[] = []
    const kidsOf = (id: string) => (children.get(id) ?? []).filter(c => !at.has(c))
    const leaf = (id: string) => kidsOf(id).length === 0
    const w = (id: string) => CARD[type.get(id) ?? 'note'].w
    // A long run of leaves: short columns, each read top to bottom, in order.
    const grid = (run: string[], depth: number, top: number): number => {
      const cols = Math.min(WRAP_COLS, Math.ceil(run.length / WRAP_ROWS))
      const rows = Math.ceil(run.length / cols)
      const rowH = Math.max(...run.map(h)) + ROW_GAP
      const colW = Math.max(...run.map(w)) + WRAP_GAP
      const x0 = depth * COL
      const trunkX = x0 - Math.max(...run.map(w)) / 2 - WRAP_GAP / 2
      run.forEach((id, i) => {
        const c = Math.floor(i / rows), r = i % rows
        const p = { id, x: x0 + c * colW, y: top + r * rowH + h(id) / 2 }
        at.set(id, p)
        placed.push(id)
        if (c > 0) lanes.set(id, { trunkX, laneY: top + r * rowH - ROW_GAP / 2, x: p.x, y: p.y })
      })
      return top + rows * rowH - ROW_GAP
    }
    const place = (id: string, depth: number, top: number): number => {
      const kids = kidsOf(id)
      const x = depth * COL
      if (kids.length === 0) {
        at.set(id, { id, x, y: top + h(id) / 2 })
        placed.push(id)
        return top + h(id)
      }
      at.set(id, { id, x, y: 0 })
      placed.push(id)
      let bottom = top
      const from = placed.length
      const direct: string[] = []
      for (let i = 0; i < kids.length;) {
        const c = kids[i]!
        // A card with cards inside it gets a little more room around it.
        const gap = bottom === top ? 0 : leaf(c) && (i === 0 || leaf(kids[i - 1]!)) ? ROW_GAP : GROUP_GAP
        let j = i
        while (j < kids.length && leaf(kids[j]!)) j++
        if (j - i >= WRAP) {
          const run = kids.slice(i, j)
          bottom = grid(run, depth + 1, bottom + gap)
          direct.push(...run)
          i = j
          continue
        }
        bottom = place(c, depth + 1, bottom + gap)
        direct.push(c)
        i++
      }
      const below = placed.slice(from)
      const ys = direct.map(k => at.get(k)!.y)
      let y = (Math.min(...ys) + Math.max(...ys)) / 2
      // Taller than what hangs from it: the whole branch moves down.
      if (y - h(id) / 2 < top) {
        const by = top - (y - h(id) / 2)
        for (const k of below) {
          const p = at.get(k)!
          at.set(k, { ...p, y: p.y + by })
          const l = lanes.get(k)
          if (l) lanes.set(k, { ...l, laneY: l.laneY + by, y: l.y + by })
        }
        y += by; bottom += by
      }
      at.set(id, { id, x, y })
      return Math.max(bottom, y + h(id) / 2)
    }
    // Each subject's tree on its own, then packed into columns in their
    // order: down one column until it is as tall as the shape asks, then the next.
    const trees: Array<{ ids: string[]; minX: number; minY: number; maxX: number; maxY: number }> = []
    for (const r of roots) {
      if (at.has(r)) continue
      const from = placed.length
      place(r, 0, 0)
      const ids = placed.slice(from)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const id of ids) {
        const p = at.get(id)!
        minX = Math.min(minX, p.x - w(id) / 2); maxX = Math.max(maxX, p.x + w(id) / 2)
        minY = Math.min(minY, p.y - h(id) / 2); maxY = Math.max(maxY, p.y + h(id) / 2)
      }
      trees.push({ ids, minX, minY, maxX, maxY })
    }
    const area = trees.reduce((a, t) => a + (t.maxX - t.minX + TREE_GAP) * (t.maxY - t.minY + BRANCH_GAP), 0)
    const tall = Math.max(0, ...trees.map(t => t.maxY - t.minY))
    const columnH = Math.max(tall, Math.sqrt(area / ASPECT))
    let cx = 0, cy = 0, colW = 0
    for (const t of trees) {
      const tw = t.maxX - t.minX, th = t.maxY - t.minY
      if (cy > 0 && cy + th > columnH) { cx += colW + TREE_GAP; cy = 0; colW = 0 }
      const dx = cx - t.minX, dy = cy - t.minY
      for (const id of t.ids) {
        const p = at.get(id)!
        at.set(id, { id, x: p.x + dx, y: p.y + dy })
        const l = lanes.get(id)
        if (l) lanes.set(id, { trunkX: l.trunkX + dx, laneY: l.laneY + dy, x: l.x + dx, y: l.y + dy })
      }
      cy += th + BRANCH_GAP
      colW = Math.max(colW, tw)
    }
  }

  const centres = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of at.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
    return at.size === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY }
  }

  // Filed under nothing: a plain block below the rest, never joined to it.
  const alone = nodes.filter(n => !at.has(n.id) && !parent.has(n.id)).sort((a, b) => RANK[a.type] - RANK[b.type] || byName(a, b))
  let loose: MapLayout['loose'] = null
  if (alone.length > 0) {
    const b     = centres()
    const cols  = Math.min(portrait ? 2 : LOOSE_COLS, alone.length)
    const width = (cols - 1) * LOOSE_DX
    const left  = at.size === 0 ? 0 : b.minX
    const top   = at.size === 0 ? 0 : b.maxY + 170
    alone.forEach((n, i) => at.set(n.id, { id: n.id, x: left + (i % cols) * LOOSE_DX, y: top + Math.floor(i / cols) * LOOSE_DY }))
    loose = { x: left, y: top, width }
  }
  // Anything still unplaced (under a card that is not drawn, or in a loop): with the loose block.
  const rest = nodes.filter(n => !at.has(n.id))
  if (rest.length > 0) {
    const b = centres()
    rest.forEach((n, i) => at.set(n.id, { id: n.id, x: b.minX + (i % LOOSE_COLS) * LOOSE_DX, y: b.maxY + 120 + Math.floor(i / LOOSE_COLS) * LOOSE_DY }))
  }

  return { at, bounds: boundsOf(at, type), loose, lanes }
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
  return { at, bounds: boundsOf(at, new Map(nodes.map(n => [n.id, n.type]))), loose: layout.loose, lanes: layout.lanes }
}

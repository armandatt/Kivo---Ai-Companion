import type { MapEdge, MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'

// Where each card is drawn. The picture is worked out from the links on
// record and nothing else, as a tree read outward from its subject: the
// subjects inside it, its topics in their saved order with the topics inside
// them, the tasks filed under each with their steps, and the notes and saved
// pages filed there, each column one level further out. A subject with
// several branches has them on both its sides, balanced by size (the first
// ones to its right, the rest to its left), so a cluster is about as tall as
// it is wide instead of one long column. Siblings go top to bottom in their
// order, so the map reads in the order the learner (or their plan) gave. On a phone (portrait) the same tree is an indented
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
  // Cards on the left of their subject (the tree grows leftward there): what
  // sits on a card's outer edge (its fold button) goes on its left.
  left?: Set<string>
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

const COL       = 290   // one level deeper, outward
const ROW_GAP   = 26    // between cards one under another
const GROUP_GAP = 40    // around a card with cards hanging from it, so branches read apart
// Organic, still structured: siblings fan out from their parent in an arc
// (the ones level with it reach furthest), and each card is nudged by a fixed
// amount from its id, so the map reads as branches, not a grid. Neither
// changes which side or level a card is on. A last pass keeps cards apart.
const FAN       = 44
const NUDGE_X   = 14
const NUDGE_Y   = 5
const CLEAR     = 12    // the least room kept between two cards
const BRANCH_GAP = 36   // between two subjects' trees
// A run of this many cards with nothing inside them, side by side in a
// branch, wraps into up to WRAP_COLS short columns instead of one long one.
// wraps into short columns, as many as keep the block about as wide as tall.
const WRAP      = 8
const WRAP_COLS = 4
const WRAP_GAP  = 40    // between the wrapped columns (wider than two nudges)
// Taller than wide: a subject already reaches out on both its sides, so its
// branches fill the page's height before they add width.
const BLOCK_SHAPE = 0.85
// A subject with this many branches has them on both its sides.
const SPLIT     = 4
// Subjects' clusters are packed into rows toward this shape (width to
// height), each centred in its row. A constant, not the window's shape, so
// resizing never moves anything.
const ASPECT    = 1.6
const TREE_GAP  = 110   // between two clusters side by side
const SHELF_GAP = 96    // between two rows of clusters
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
  const left = new Set<string>()
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
    // A subject's branches for one side of it, while that side is placed.
    const side = new Map<string, string[]>()
    const kidsOf = (id: string) => (side.get(id) ?? children.get(id) ?? []).filter(c => !at.has(c))
    const leaf = (id: string) => kidsOf(id).length === 0
    const w = (id: string) => CARD[type.get(id) ?? 'note'].w
    // A long run of leaves: short columns, each read top to bottom, in order.
    const grid = (run: string[], depth: number, top: number): number => {
      // A column is ~200 wide and a row ~70 tall: this many columns keep the block near square.
      const cols = Math.max(1, Math.min(WRAP_COLS, Math.round(Math.sqrt(run.length * 0.45))))
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
    // Many branches under one card: each branch is a block, and the blocks go
    // into columns read top to bottom, then the next, with rows lined up
    // across the columns so the lines into a later column run along the gap
    // above its row. As many columns as keep the whole nearest a slightly
    // wide shape (BLOCK_SHAPE): one column when that is nearest already.
    const blocks = (id: string, kids: string[], depth: number, top: number): number => {
      const list = kids.map(c => {
        const from = placed.length
        const bottom = place(c, depth + 1, 0)
        const ids = placed.slice(from)
        let minX = Infinity, maxX = -Infinity
        for (const k of ids) { const p = at.get(k)!; minX = Math.min(minX, p.x - w(k) / 2); maxX = Math.max(maxX, p.x + w(k) / 2) }
        return { c, ids, minX, maxX, h: bottom }
      })
      const left0 = Math.min(...list.map(b => b.minX))
      const shape = (cols: number) => {
        const rows = Math.ceil(list.length / cols)
        const rowH = Array.from({ length: rows }, (_, r) => Math.max(...list.filter((_, i) => i % rows === r).map(b => b.h)))
        const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...list.slice(c * rows, (c + 1) * rows).map(b => b.maxX - left0)))
        const W = colW.reduce((a, b) => a + b, 0) + WRAP_GAP * (cols - 1), H = rowH.reduce((a, b) => a + b, 0) + GROUP_GAP * (rows - 1)
        // Near the shape, with little left empty by rows lined up across
        // uneven branches (one tall branch beside small ones stays one column).
        const used = list.reduce((a, b) => a + (b.maxX - b.minX) * b.h, 0)
        // Each column more adds lines along the gaps and takes cards further
        // from their parent: worth it only when it clearly helps.
        const score = Math.abs(Math.log(W / H / BLOCK_SHAPE)) + 1.5 * (1 - used / (W * H)) + 0.12 * (cols - 1)
        return { cols, rows, rowH, colW, W, H, score }
      }
      let best = shape(1)
      const areas = list.map(b => (b.maxX - b.minX) * b.h), whole = areas.reduce((a, b) => a + b, 0)
      // One branch holding most of it: the rest go under it, not beside it.
      if (Math.max(...areas) <= whole / 2) for (let c = 2; c <= WRAP_COLS; c++) {
        const s = shape(c)
        if (s.rows < 2) break
        if (s.score < best.score) best = s
      }
      const rowTop: number[] = []
      for (let r = 0, y = top; r < best.rows; r++) { rowTop.push(y); y += best.rowH[r]! + GROUP_GAP }
      const colX: number[] = []
      for (let c = 0, x = 0; c < best.cols; c++) { colX.push(x); x += best.colW[c]! + WRAP_GAP }
      const trunkX = left0 - WRAP_GAP / 2
      list.forEach((b, i) => {
        const c = Math.floor(i / best.rows), r = i % best.rows
        const dx = colX[c]!, dy = rowTop[r]!
        for (const k of b.ids) {
          const p = at.get(k)!
          at.set(k, { id: k, x: p.x + dx, y: p.y + dy })
          const l = lanes.get(k)
          if (l) lanes.set(k, { trunkX: l.trunkX + dx, laneY: l.laneY + dy, x: l.x + dx, y: l.y + dy })
        }
        if (c > 0) { const p = at.get(b.c)!; lanes.set(b.c, { trunkX, laneY: rowTop[r]! - GROUP_GAP / 2, x: p.x, y: p.y }) }
      })
      const ys = kids.map(k => at.get(k)!.y)
      const y = Math.max(top + h(id) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)
      at.set(id, { id, x: depth * COL, y })
      return Math.max(top + best.H, y + h(id) / 2)
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
      if (kids.length >= 3 && kids.some(k => !leaf(k))) return blocks(id, kids, depth, top)
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
    // How much of the map a branch takes: the cards in it.
    const weightOf = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 0
      seen.add(id)
      return 1 + (children.get(id) ?? []).reduce((a, c) => a + weightOf(c, seen), 0)
    }
    // A subject with several branches: the first ones (by order) to its right,
    // the rest to its left, split where the two sides weigh about the same.
    // Each side is the same tree, mirrored, with the subject level with both.
    const placeRoot = (r: string) => {
      const kids = kidsOf(r)
      if (kids.length < SPLIT) { place(r, 0, 0); return }
      const weights = kids.map(k => weightOf(k))
      const total = weights.reduce((a, b) => a + b, 0)
      let cut = 1, run = weights[0]!, best = Infinity
      for (let i = 1; i < kids.length; i++) {
        const d = Math.abs(total / 2 - run)
        if (d <= best) { best = d; cut = i }
        run += weights[i]!
      }
      side.set(r, kids.slice(0, cut))
      place(r, 0, 0)
      const ry = at.get(r)!.y
      side.set(r, kids.slice(cut))
      const from = placed.length
      place(r, 0, 0)
      side.delete(r)
      const dy = ry - at.get(r)!.y
      for (const id of placed.slice(from)) {
        if (id === r) continue
        const p = at.get(id)!
        at.set(id, { id, x: -p.x, y: p.y + dy })
        left.add(id)
        const l = lanes.get(id)
        if (l) lanes.set(id, { trunkX: -l.trunkX, laneY: l.laneY + dy, x: -l.x, y: l.y + dy })
      }
      placed.splice(from, 1)   // the subject, placed twice
      at.set(r, { id: r, x: 0, y: ry })
    }
    // A cluster made organic (see FAN): positions only, the tree unchanged.
    const hash = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) } return ((h >>> 0) % 2001) / 1000 - 1 }
    const organic = (root: string, ids: string[]) => {
      const inCluster = new Set(ids)
      const shift = new Map<string, { dx: number; dy: number }>()
      for (const id of ids) {
        if (id === root) continue
        const p = parent.get(id)
        if (!p || !inCluster.has(p)) continue
        const me = at.get(id)!, pa = at.get(p)!
        const dir = me.x >= pa.x ? 1 : -1
        // The siblings in the same column as this card: how far the column spans.
        const side = (children.get(p) ?? []).filter(c => inCluster.has(c) && Math.sign(at.get(c)!.x - pa.x) === dir)
        const sibs = side.filter(c => Math.abs(at.get(c)!.x - me.x) < 1)
        const span = Math.max(1, ...sibs.map(c => Math.abs(at.get(c)!.y - pa.y)))
        const t = Math.min(1, Math.abs(me.y - pa.y) / span)
        // A run already wrapped into columns keeps its columns: a fan would push one into the next.
        const wrapped = side.some(c => Math.abs(at.get(c)!.x - me.x) >= 1)
        const fan = sibs.length >= 3 && !wrapped ? FAN * (1 - t * t) : 0
        shift.set(id, { dx: dir * fan + hash(id) * NUDGE_X, dy: hash(`${id}:y`) * NUDGE_Y })
      }
      // A card's branch moves with it, so a fan never folds a branch back.
      const total = (id: string): { dx: number; dy: number } => {
        let dx = 0, dy = 0
        for (let at_: string | undefined = id, hops = 0; at_ && inCluster.has(at_) && hops < 64; at_ = parent.get(at_), hops++) { const s = shift.get(at_); if (s) { dx += s.dx; dy += s.dy } }
        return { dx, dy }
      }
      const moved = new Map(ids.map(id => [id, total(id)]))
      for (const id of ids) {
        const m = moved.get(id)!, p = at.get(id)!
        at.set(id, { id, x: p.x + m.dx, y: p.y + m.dy })
        const l = lanes.get(id)
        if (l) lanes.set(id, { ...l, laneY: l.laneY, x: l.x + m.dx, y: l.y + m.dy })
      }
      // Keep every card clear of the others (rarely needed): a sweep along x
      // finds the pairs that touch; the later one moves along the axis that frees it soonest.
      for (let round = 0; round < 40; round++) {
        const order = ids.map(id => ({ id, x0: at.get(id)!.x - w(id) / 2 })).sort((a, b) => a.x0 - b.x0 || (a.id < b.id ? -1 : 1))
        let any = false
        for (let i = 0; i < order.length; i++) {
          const ia = order[i]!.id, a = at.get(ia)!
          for (let j = i + 1; j < order.length && order[j]!.x0 < a.x + w(ia) / 2 + CLEAR; j++) {
            const ib = order[j]!.id, b = at.get(ib)!
            const ox = (w(ia) + w(ib)) / 2 + CLEAR - Math.abs(a.x - b.x)
            const oy = (h(ia) + h(ib)) / 2 + CLEAR - Math.abs(a.y - b.y)
            if (ox <= 0 || oy <= 0) continue
            any = true
            const mv = ib === root ? ia : ib, other = mv === ib ? a : b, q = at.get(mv)!
            at.set(mv, oy <= ox ? { id: mv, x: q.x, y: q.y + (q.y >= other.y ? oy : -oy) } : { id: mv, x: q.x + (q.x >= other.x ? ox : -ox), y: q.y })
            lanes.delete(mv)
          }
        }
        if (!any) break
      }
    }
    // Each subject's cluster on its own, then packed into rows in their
    // order: each row centred under the widest, each cluster centred in its
    // row's height, the row width chosen so the whole is near the shape asked.
    const trees: Array<{ ids: string[]; minX: number; minY: number; maxX: number; maxY: number }> = []
    for (const r of roots) {
      if (at.has(r)) continue
      const from = placed.length
      placeRoot(r)
      const ids = placed.slice(from)
      organic(r, ids)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const id of ids) {
        const p = at.get(id)!
        minX = Math.min(minX, p.x - w(id) / 2); maxX = Math.max(maxX, p.x + w(id) / 2)
        minY = Math.min(minY, p.y - h(id) / 2); maxY = Math.max(maxY, p.y + h(id) / 2)
      }
      trees.push({ ids, minX, minY, maxX, maxY })
    }
    const tw = (t: typeof trees[number]) => t.maxX - t.minX, th = (t: typeof trees[number]) => t.maxY - t.minY
    const shelves = (limit: number) => {
      const rows: Array<typeof trees> = []
      let row: typeof trees = [], width = 0
      for (const t of trees) {
        if (row.length > 0 && width + TREE_GAP + tw(t) > limit) { rows.push(row); row = []; width = 0 }
        width += (row.length ? TREE_GAP : 0) + tw(t)
        row.push(t)
      }
      if (row.length) rows.push(row)
      const widths = rows.map(r => r.reduce((a, t, i) => a + tw(t) + (i ? TREE_GAP : 0), 0))
      const heights = rows.map(r => Math.max(...r.map(th)))
      return { rows, widths, heights, W: Math.max(...widths), H: heights.reduce((a, b) => a + b, 0) + SHELF_GAP * (rows.length - 1) }
    }
    if (trees.length > 0) {
      const area = trees.reduce((a, t) => a + (tw(t) + TREE_GAP) * (th(t) + SHELF_GAP), 0)
      const widest = Math.max(...trees.map(tw))
      let pick = shelves(Infinity), score = Infinity
      for (let f = 0.5; f <= 2.01; f += 0.1) {
        const s = shelves(Math.max(widest, Math.sqrt(area * ASPECT) * f))
        // Near the shape, with little of the box left empty.
        const sc = Math.abs(Math.log(s.W / Math.max(1, s.H) / ASPECT)) + 0.8 * (1 - area / ((s.W + TREE_GAP) * (s.H + SHELF_GAP)))
        if (sc < score - 1e-9) { score = sc; pick = s }
      }
      let cy = 0
      pick.rows.forEach((row, i) => {
        let cx = (pick.W - pick.widths[i]!) / 2
        for (const t of row) {
          const dx = cx - t.minX, dy = cy + (pick.heights[i]! - th(t)) / 2 - t.minY
          for (const id of t.ids) {
            const p = at.get(id)!
            at.set(id, { id, x: p.x + dx, y: p.y + dy })
            const l = lanes.get(id)
            if (l) lanes.set(id, { trunkX: l.trunkX + dx, laneY: l.laneY + dy, x: l.x + dx, y: l.y + dy })
          }
          cx += tw(t) + TREE_GAP
        }
        cy += pick.heights[i]! + SHELF_GAP
      })
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

  return { at, bounds: boundsOf(at, type), loose, lanes, left }
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
  return { at, bounds: boundsOf(at, new Map(nodes.map(n => [n.id, n.type]))), loose: layout.loose, lanes: layout.lanes, left: layout.left }
}

// ─── The map's depth: what is raised, what comes in first, where subjects sit ──
// Knowledge Map 2.0 draws the same cards, lines and layout as before, with
// depth. Everything here is pure (no DOM, no React), so the page and the
// tests share it.
//
// Depth means something here. A card's thickness says what stands behind it:
// a subject is the thickest, a topic rises with the learner's own estimate
// (weak, developing, solid), and a topic with no session yet is flat and
// dashed: not built yet. Notes, saved pages and tasks are thin sheets. No
// thickness is invented: it is read from what the map already reports.
//
// The entrance is worked out from the tree on record: subjects first, then
// each level of what hangs from them, then the lines between them. It is
// a schedule of delays (CSS animations play it), never a physics run, and
// the map can be used from the first frame.

import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { CARD } from './layout'

// ── A card's slab ───────────────────────────────────────────────────────────

// How thick a card is drawn, in map units.
export function thicknessOf(n: MapNode): number {
  if (n.type === 'subject') return 7
  if (n.type === 'topic') {
    if (n.kind === 'milestone' || n.studied === false) return 3
    if (n.sessions === 0) return 0
    return n.level === 'solid' ? 6 : n.level === 'developing' ? 4 : 2.5
  }
  return 2
}

// The corner radius each card's face is drawn with (card-face.tsx), so its slab matches.
export function radiusOf(n: MapNode): number {
  switch (n.type) {
    case 'subject': return 16
    case 'topic': return n.kind === 'milestone' ? 6 : 14
    case 'task': return 9
    case 'note': return 11
    default: return 6
  }
}

// ── Motion ──────────────────────────────────────────────────────────────────

export type Motion = 'full' | 'reduced'
export type EntranceMode = 'full' | 'brief' | 'none'

// Past this many cards, the entrance is one short fade: a long cascade over
// hundreds of cards shows nothing and costs frames.
export const LARGE_MAP = 260
const NODE_BUDGET = { full: 1250, brief: 160 }   // the last card starts by then
const LEVEL_STEP  = { full: 230, brief: 40 }     // one level deeper starts this much later
const SIBLING_SPREAD = { full: 160, brief: 0 }   // a level's cards spread over this
const EDGE_LAG    = { full: 140, brief: 60 }     // a line starts once both its cards have
export const CARD_MS = { full: 520, brief: 240 }
export const EDGE_MS = { full: 460, brief: 220 }

export function entranceMode(o: { seen: boolean; reduced: boolean; motion: Motion; count: number }): EntranceMode {
  if (o.reduced || o.motion === 'reduced') return 'none'
  if (o.seen || o.count > LARGE_MAP) return 'brief'
  return 'full'
}

export interface Entrance {
  node: Map<string, number>   // ms before each card starts
  edge: Map<string, number>   // ms before each line starts to draw
  total: number               // ms until everything has arrived
}

// The delays for an entrance. `parent` is the tree (layout.ts treeOf); cards
// with no parent drawn are where it starts, taken in reading order.
export function entrancePlan(
  ids: string[],
  parent: ReadonlyMap<string, string>,
  at: ReadonlyMap<string, { x: number; y: number }>,
  edges: ReadonlyArray<{ id: string; from: string; to: string }>,
  mode: Exclude<EntranceMode, 'none'>,
): Entrance {
  const drawn = new Set(ids)
  const depth = new Map<string, number>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    let d = 0
    for (let p = parent.get(id), hops = 0; p && drawn.has(p) && hops < ids.length; p = parent.get(p), hops++) d++
    depth.set(id, d)
    return d
  }
  const reading = (a: string, b: string) => {
    const pa = at.get(a), pb = at.get(b)
    return (pa?.y ?? 0) - (pb?.y ?? 0) || (pa?.x ?? 0) - (pb?.x ?? 0)
  }
  const byLevel = new Map<number, string[]>()
  for (const id of ids) { const d = depthOf(id); const l = byLevel.get(d); if (l) l.push(id); else byLevel.set(d, [id]) }
  const raw = new Map<string, number>()
  for (const [d, list] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort(reading)
    list.forEach((id, i) => raw.set(id, d * LEVEL_STEP[mode] + (list.length > 1 ? (i / (list.length - 1)) * SIBLING_SPREAD[mode] : 0)))
  }
  // Squeezed to the budget, never stretched: a small map arrives sooner.
  const last = Math.max(0, ...raw.values())
  const squeeze = last > NODE_BUDGET[mode] ? NODE_BUDGET[mode] / last : 1
  const node = new Map([...raw].map(([id, ms]) => [id, Math.round(ms * squeeze)]))
  const edge = new Map<string, number>()
  for (const e of edges) {
    const a = node.get(e.from), b = node.get(e.to)
    if (a === undefined || b === undefined) continue
    edge.set(e.id, Math.max(a, b) + EDGE_LAG[mode])
  }
  const total = Math.max(0, ...[...node.values()].map(ms => ms + CARD_MS[mode]), ...[...edge.values()].map(ms => ms + EDGE_MS[mode]))
  return { node, edge, total }
}

// ── Subjects' regions ───────────────────────────────────────────────────────

export interface Region { id: string; x: number; y: number; w: number; h: number }
export const REGION_PAD = 44

// The ground each top-level subject's tree stands on: the box around it and
// everything drawn under it. Drawn as a soft light in the subject's colour.
export function regionsOf(
  nodes: ReadonlyArray<Pick<MapNode, 'id' | 'type'>>,
  parent: ReadonlyMap<string, string>,
  at: ReadonlyMap<string, { x: number; y: number }>,
): Region[] {
  const drawn = new Map(nodes.map(n => [n.id, n]))
  const box = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const n of nodes) {
    let root = n.id
    for (let p = parent.get(root), hops = 0; p && drawn.has(p) && hops < nodes.length; p = parent.get(p), hops++) root = p
    if (drawn.get(root)?.type !== 'subject') continue
    const pos = at.get(n.id)
    if (!pos) continue
    const { w, h } = CARD[n.type]
    const b = box.get(root) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    b.minX = Math.min(b.minX, pos.x - w / 2); b.maxX = Math.max(b.maxX, pos.x + w / 2)
    b.minY = Math.min(b.minY, pos.y - h / 2); b.maxY = Math.max(b.maxY, pos.y + h / 2)
    box.set(root, b)
  }
  // Each region's margin is at most half the gap to its nearest neighbour,
  // so two subjects' ground never overlaps (the layout packs trees closely).
  const boxes = [...box]
  return boxes.map(([id, b]) => {
    let pad = REGION_PAD
    for (const [other, o] of boxes) {
      if (other === id) continue
      const gap = Math.max(o.minX - b.maxX, b.minX - o.maxX, o.minY - b.maxY, b.minY - o.maxY)
      pad = Math.min(pad, gap / 2 - 4)
    }
    pad = Math.max(MIN_PAD, pad)
    return { id, x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 }
  })
}
const MIN_PAD = 8

// ── What the browser remembers ─────────────────────────────────────────────

type Store = Pick<Storage, 'getItem' | 'setItem'>
const MOTION_KEY = 'kivo-map-motion'
const SEEN_KEY = 'kivo-map-entered'

// The learner's own choice of motion on the map (per device). Unset: full.
export function chosenMotion(store: Store | null): Motion {
  try { return store?.getItem(MOTION_KEY) === 'reduced' ? 'reduced' : 'full' } catch { return 'full' }
}
export function chooseMotion(store: Store | null, motion: Motion) {
  try { store?.setItem(MOTION_KEY, motion) } catch { /* private window: this visit only */ }
}

// Whether this map was opened already in this browser session: the full
// entrance plays once, a return gets the brief one.
export function enteredBefore(session: Store | null, where: string): boolean {
  try { return (JSON.parse(session?.getItem(SEEN_KEY) ?? '[]') as string[]).includes(where) } catch { return false }
}
export function markEntered(session: Store | null, where: string) {
  try {
    const list = (JSON.parse(session?.getItem(SEEN_KEY) ?? '[]') as string[]).filter(w => w !== where)
    session?.setItem(SEEN_KEY, JSON.stringify([...list, where].slice(-40)))
  } catch { /* nothing kept: the next visit plays it again */ }
}

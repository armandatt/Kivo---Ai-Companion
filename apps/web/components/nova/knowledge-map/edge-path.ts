// ─── The shape of a line on the Knowledge Map ────────────────────────────────
// One place for how a line between two cards is drawn, so the map
// (knowledge-map.tsx) and the landing page's preview of it draw the same
// lines. Pure: points in, an SVG path out.

type P = { x: number; y: number }
export type Lane = { x: number; y: number; trunkX: number; laneY: number }

// Into a wrapped column (layout.ts lanes): along the gaps, with rounded corners.
export function roundedLane(a: P, lane: { trunkX: number; laneY: number }, b: P): string {
  const r = 14
  const sx1 = Math.sign(lane.trunkX - a.x) || 1, sy1 = Math.sign(lane.laneY - a.y) || 1
  const sx2 = Math.sign(b.x - lane.trunkX) || 1, sy2 = Math.sign(b.y - lane.laneY) || 1
  const r1 = Math.min(r, Math.abs(lane.trunkX - a.x) / 2, Math.abs(lane.laneY - a.y) / 2)
  const r2 = Math.min(r, Math.abs(lane.laneY - a.y) / 2, Math.abs(b.x - lane.trunkX) / 2)
  const r3 = Math.min(r, Math.abs(b.x - lane.trunkX) / 2, Math.abs(b.y - lane.laneY) / 2)
  return [
    `M ${a.x} ${a.y}`, `H ${lane.trunkX - sx1 * r1}`, `Q ${lane.trunkX} ${a.y} ${lane.trunkX} ${a.y + sy1 * r1}`,
    `V ${lane.laneY - sy1 * r2}`, `Q ${lane.trunkX} ${lane.laneY} ${lane.trunkX + sx2 * r2} ${lane.laneY}`,
    `H ${b.x - sx2 * r3}`, `Q ${b.x} ${lane.laneY} ${b.x} ${lane.laneY + sy2 * r3}`, `V ${b.y}`,
  ].join(' ')
}

// A branch of the tree: along a lane when it has one; else it flows out of its
// card and into the next, level at both ends; one card under another (the
// outline), the plain line. laned: whether it went along a lane.
export function treePath(a: P, b: P, lane: Lane | undefined): { d: string; laned: boolean } {
  if (lane && lane.x === b.x && lane.y === b.y) return { d: roundedLane(a, lane, b), laned: true }
  const mx = (a.x + b.x) / 2
  return { d: Math.abs(b.x - a.x) > 60 ? `M ${a.x} ${a.y} C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`, laned: false }
}

// A [[link]]: a quiet curve to one side.
export function linkPath(a: P, b: P): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
  return `M ${a.x} ${a.y} Q ${mx - dy * 0.18} ${my + dx * 0.18} ${b.x} ${b.y}`
}

// The tree's line colour: the subject's, a little toward the map's line colour.
export const TREE_STROKE = 'color-mix(in oklch, var(--sc) 70%, var(--map-line-strong))'

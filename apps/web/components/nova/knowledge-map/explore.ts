// Exploring inside a card: a map of one card and everything inside it. It is
// a view of the same map, never a copy: the cards keep the places they have
// on the whole map, so going in is a zoom into that part of it, and an edit
// made inside is an edit to the one map. Pure, so it is tested on its own.

import type { MapEdge } from '@repo/api/nova/product/knowledge-map.types'
import { TREE_EDGES } from './layout'

type Tree = { children: ReadonlyMap<string, readonly string[]>; parent: ReadonlyMap<string, string> }
export interface View { x: number; y: number; k: number }

// A card can be explored when something hangs from it: a map of a card on
// its own would be empty.
export const canExplore = (tree: Tree, id: string): boolean => (tree.children.get(id)?.length ?? 0) > 0

// The card and everything inside it, at any depth.
export function insideOf(tree: Tree, id: string): Set<string> {
  const out = new Set([id])
  const stack = [id]
  while (stack.length) for (const c of tree.children.get(stack.pop()!) ?? []) if (!out.has(c)) { out.add(c); stack.push(c) }
  return out
}

// The cards it sits inside, from the top of the map down to it.
export function pathTo(tree: Tree, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = tree.parent.get(at)) { seen.add(at); out.unshift(at) }
  return out
}

// A link from a card inside to one outside it (a [[link]], a wait). The link
// is kept as it is, its direction too; the card at the far end is drawn as a
// marker beside the explored map rather than dropped.
export interface CrossLink { edge: MapEdge; inside: string; outside: string }

export function crossLinks(inside: ReadonlySet<string>, edges: readonly MapEdge[]): CrossLink[] {
  const out: CrossLink[] = []
  for (const e of edges) {
    if (TREE_EDGES.has(e.kind)) continue
    const a = inside.has(e.from), b = inside.has(e.to)
    if (a !== b) out.push({ edge: e, inside: a ? e.from : e.to, outside: a ? e.to : e.from })
  }
  return out
}

// Where the markers for cards outside go: one column right of the explored
// map, each level with the first card inside it joins, never two on top of
// each other. In the order of those cards, top to bottom.
export const MARKER_R = 20
const MARKER_GAP = 16

export function placeOutside(
  links: readonly CrossLink[],
  at: ReadonlyMap<string, { x: number; y: number }>,
  right: number,
): Map<string, { x: number; y: number }> {
  const wanted = new Map<string, number>()
  for (const l of links) {
    const p = at.get(l.inside)
    if (!p) continue
    const y = wanted.get(l.outside)
    if (y === undefined || p.y < y) wanted.set(l.outside, p.y)
  }
  const order = [...wanted.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
  const out = new Map<string, { x: number; y: number }>()
  let last = -Infinity
  for (const [id, y] of order) {
    const placed = Math.max(y, last + MARKER_R * 2 + MARKER_GAP)
    out.set(id, { x: right + 140, y: placed })
    last = placed
  }
  return out
}

// ── Where the learner is ─────────────────────────────────────────────────────
// A stack of views: the whole map at the bottom, then each card explored.
// Each keeps the pan and zoom the learner left it with, so going back puts
// them where they were.

export interface Level { focus: string | null; view: View | null }
export const START: readonly Level[] = [{ focus: null, view: null }]

export const current = (stack: readonly Level[]): Level => stack[stack.length - 1]!

// Into a card, remembering the view being left.
export function enter(stack: readonly Level[], focus: string, leaving: View | null): Level[] {
  if (current(stack).focus === focus) return [...stack]
  return [...stack.slice(0, -1), { ...current(stack), view: leaving }, { focus, view: null }]
}

// Back to the view before, as it was left. At the whole map, nothing to go back to.
export const back = (stack: readonly Level[]): Level[] => (stack.length > 1 ? stack.slice(0, -1) : [...stack])

// One level up the tree: to the card the explored one sits inside (the whole
// map when it sits inside nothing explorable). When that is the view below,
// it is the same as going back, so its view is kept.
export function up(stack: readonly Level[], tree: Tree): Level[] {
  const focus = current(stack).focus
  if (focus === null) return [...stack]
  const parent = tree.parent.get(focus) ?? null
  if (stack.length > 1 && stack[stack.length - 2]!.focus === parent) return back(stack)
  return [...stack.slice(0, -1), { focus: parent, view: null }]
}

// To a card named by a breadcrumb, or a card outside the map: the deepest
// view already open that holds it (with the view left there), else the whole map.
export function reach(stack: readonly Level[], tree: Tree, id: string): Level[] {
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i]!.focus
    if (f === null || f === id || insideOf(tree, f).has(id)) return stack.slice(0, i + 1)
  }
  return [stack[0]!]
}

// After the map reloads: a view of a card that is gone (deleted, archived,
// filtered away) is closed, and so is every view inside it.
export function keepLevels(stack: readonly Level[], ids: ReadonlySet<string>, tree: Tree): Level[] {
  const out: Level[] = []
  for (const l of stack) {
    if (l.focus !== null && (!ids.has(l.focus) || !canExplore(tree, l.focus))) break
    out.push(l)
  }
  return out.length === stack.length ? (stack as Level[]) : out.length ? out : [...START]
}

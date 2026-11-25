// Where the map's opening camera ends, and when a map opens with it. Pure.
//
// A map that fits at a readable size ends fitted. A larger one ends closer
// (OPEN_K), on the subject nearest the fitted view's middle, so titles and
// branches are read, not a far-off picture of all of it; the rest is a pan
// or a zoom away. A phone's outline keeps its own fit (top down).
//
// The opening plays when the map is opened at its top level, and (founder
// review #16) when a map that was just imported is opened inside its
// subject: before, that view was only fitted, so a large imported map
// opened at the far-out limit with no entrance. A place the learner has
// been before keeps the view they left there.

import type { View } from './explore'

/** The zoom a map too large to fit at a readable size opens at: titles and every link are seen. */
export const OPEN_K = 0.44

export function openingView(fit: View, frame: { width: number; height: number }, subjects: Array<{ x: number; y: number }>, portrait: boolean): View {
  if (portrait || fit.k >= OPEN_K) return fit
  const cw = frame.width / 2, ch = frame.height / 2
  const mid = { x: (cw - fit.x) / fit.k, y: (ch - fit.y) / fit.k }
  let best = mid, near = Infinity
  for (const p of subjects) {
    const d = Math.hypot(p.x - mid.x, p.y - mid.y)
    if (d < near) { near = d; best = p }
  }
  return { k: OPEN_K, x: Math.round(cw - best.x * OPEN_K), y: Math.round(ch - best.y * OPEN_K) }
}

/** Whether this view opens with the full opening: the top level, or a just-imported map's first view with no remembered view. */
export function opensWithEntrance(o: { top: boolean; first: boolean; arrivedFromImport: boolean; remembered: boolean }): boolean {
  if (o.top) return true
  return o.first && o.arrivedFromImport && !o.remembered
}

/** `?arrive=import`: the import page's "Open the map". Read once, then taken out of the address so a reload is an ordinary visit. */
export const ARRIVE_PARAM = 'arrive'
export const arrivedFromImport = (search: string): boolean => new URLSearchParams(search).get(ARRIVE_PARAM) === 'import'

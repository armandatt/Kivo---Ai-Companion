// ─── The overview: the map from far out, and the minimap ─────────────────────
// Knowledge Map 3.0. Far out, a card is too small to read, so the map reads
// as subjects: each region carries its name and what it holds, at a size the
// eye can read whatever the zoom. The minimap shows the whole map and where
// the view is in it. Pure arithmetic: no DOM, no React.

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface View { x: number; y: number; k: number }

// How much a card says at a zoom: shapes and the overview's labels (0),
// titles (1), titles and facts (2).
export type Detail = 0 | 1 | 2
export const detailAt = (k: number): Detail => (k >= 0.62 ? 2 : k >= 0.36 ? 1 : 0)

// A region's label in screen pixels, so it reads the same at any zoom; the
// map units it takes are those over the zoom.
export const REGION_LABEL_PX = { title: 15, line: 11.5, gap: 6 }
export const regionLabelHeight = (k: number) => (REGION_LABEL_PX.title + REGION_LABEL_PX.gap + REGION_LABEL_PX.line + 10) / Math.max(k, 0.0001)

// ── The minimap ─────────────────────────────────────────────────────────────

export interface Frame { scale: number; ox: number; oy: number; w: number; h: number }

// The map's box drawn into a w×h box, centred, with a margin.
export function minimapFrame(b: Box, w: number, h: number, margin = 6): Frame {
  const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY)
  const scale = Math.min((w - margin * 2) / bw, (h - margin * 2) / bh)
  return { scale, ox: (w - bw * scale) / 2 - b.minX * scale, oy: (h - bh * scale) / 2 - b.minY * scale, w, h }
}

// Where the screen (cw×ch) is on the minimap, clipped to it.
export function viewportOn(f: Frame, v: View, cw: number, ch: number) {
  const x0 = (-v.x / v.k) * f.scale + f.ox, y0 = (-v.y / v.k) * f.scale + f.oy
  const x1 = ((cw - v.x) / v.k) * f.scale + f.ox, y1 = ((ch - v.y) / v.k) * f.scale + f.oy
  const cx0 = Math.max(0, Math.min(f.w, x0)), cy0 = Math.max(0, Math.min(f.h, y0))
  const cx1 = Math.max(0, Math.min(f.w, x1)), cy1 = Math.max(0, Math.min(f.h, y1))
  return { x: cx0, y: cy0, w: Math.max(0, cx1 - cx0), h: Math.max(0, cy1 - cy0), whole: x0 <= 0 && y0 <= 0 && x1 >= f.w && y1 >= f.h }
}

// The view that puts a minimap point at the centre of the screen, at the same zoom.
export function viewCentredOn(f: Frame, px: number, py: number, k: number, cw: number, ch: number): View {
  const mx = (px - f.ox) / f.scale, my = (py - f.oy) / f.scale
  return { k, x: Math.round(cw / 2 - mx * k), y: Math.round(ch / 2 - my * k) }
}

// The view that shows a box (a subject's region) with room around it, never
// zoomed in further than `maxK`.
export function viewOfBox(b: Box, cw: number, ch: number, opts: { maxK?: number; minK?: number; pad?: number; top?: number } = {}): View {
  const pad = opts.pad ?? 48, top = opts.top ?? 0
  const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY)
  const k = Math.max(opts.minK ?? 0.2, Math.min(opts.maxK ?? 1, (cw - pad * 2) / w, (ch - top - pad * 2) / h))
  return { k: Math.round(k * 1000) / 1000, x: Math.round(cw / 2 - ((b.minX + b.maxX) / 2) * k), y: Math.round(top + (ch - top) / 2 - ((b.minY + b.maxY) / 2) * k) }
}

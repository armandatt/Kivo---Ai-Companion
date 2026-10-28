// The PDF reader's arithmetic, apart from React and PDF.js so it is tested on
// its own (pdf-geometry.test.ts): zoom steps and fits, which page is being
// read, a selection as rectangles on its page (fractions of the page, so a
// highlight sits on the same words at any zoom), the size a capture is drawn
// at, and how a passage is quoted into a note.

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 4
// PDF.js measures pages in points (1/72 in); a CSS pixel is 1/96 in, so 100%
// is the page at its printed size.
export const CSS_PER_POINT = 96 / 72
const STEPS = [0.25, 0.33, 0.4, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1))

// The next step up or down from where it is (a fit can sit between steps).
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir === 1) return STEPS.find(s => s > z + 0.001) ?? ZOOM_MAX
  return [...STEPS].reverse().find(s => s < z - 0.001) ?? ZOOM_MIN
}

export type PageSize = { w: number; h: number }   // in points, at 100%

// The zoom at which the widest page fills the width, or the tallest whole
// page fits the height too, leaving the reader's padding.
export function fitZoom(mode: 'width' | 'page', pages: PageSize[], box: { width: number; height: number }, pad = 24): number {
  if (!pages.length || box.width <= 0) return 1
  const w = Math.max(...pages.map(p => p.w)) * CSS_PER_POINT
  const h = Math.max(...pages.map(p => p.h)) * CSS_PER_POINT
  const byWidth = (box.width - pad * 2) / w
  return clampZoom(mode === 'width' ? byWidth : Math.min(byWidth, (box.height - pad * 2) / h))
}

// Where each page starts, from the top of the column, at a zoom; gap between pages.
export function pageTops(pages: PageSize[], zoom: number, gap = 16, top = 16): number[] {
  const out: number[] = []
  let y = top
  for (const p of pages) { out.push(y); y += p.h * CSS_PER_POINT * zoom + gap }
  return out
}

// The page being read: the last one whose top is above the middle of the view.
export function pageAt(tops: number[], scrollTop: number, viewHeight: number): number {
  const line = scrollTop + viewHeight * 0.4
  let n = 0
  for (let i = 0; i < tops.length; i++) if (tops[i]! <= line) n = i
  return n + 1
}

export type Box = { left: number; top: number; width: number; height: number }
export type Rect = { x: number; y: number; w: number; h: number }

// A selection's rectangles on one page, as fractions of the page: tiny ones
// dropped, kept inside the page, and the pieces of one line joined.
export function rectsOnPage(client: Box[], page: Box): Rect[] {
  if (page.width <= 0 || page.height <= 0) return []
  const out: Rect[] = []
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  for (const r of client) {
    if (r.width < 1 || r.height < 1) continue
    const x0 = clamp((r.left - page.left) / page.width), x1 = clamp((r.left + r.width - page.left) / page.width)
    const y0 = clamp((r.top - page.top) / page.height), y1 = clamp((r.top + r.height - page.top) / page.height)
    if (x1 - x0 <= 0.001 || y1 - y0 <= 0.001) continue
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x)
  const merged: Rect[] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    // Same line: overlapping heights, touching or overlapping along it.
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + 0.01) {
      const x1 = Math.max(last.x + last.w, r.x + r.w), y1 = Math.max(last.y + last.h, r.y + r.h)
      last.x = Math.min(last.x, r.x); last.y = Math.min(last.y, r.y); last.w = x1 - last.x; last.h = y1 - last.y
    } else merged.push({ ...r })
  }
  return merged
}

export const inRect = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

// Text selected in a PDF: words broken across lines joined, spaces made one.
export function cleanPassage(raw: string): string {
  return raw.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim()
}

// The scale a capture is drawn at: a whole page about 1600 pixels wide, a
// region enough to read (at least 900 wide, up to 2000), never past 5x.
export function captureScale(page: PageSize, region: Rect | null): number {
  const width = (region ? region.w : 1) * page.w
  const target = region ? Math.min(2000, Math.max(900, width * 3)) : 1600
  return Math.min(5, target / Math.max(width, 1))
}

// A passage quoted into a note: a quote callout naming the document and the
// page, the words as they are, and the address to come back to that page.
// No line starts "Source:", which would make it the note's own source.
export function quoteMarkdown(text: string, doc: { title: string; url: string }, page: number | null): string {
  const where = page ? ` · p. ${page}` : ''
  const lines = text.split('\n').map(l => `> ${l}`.trimEnd())
  const back = `${doc.url.split('#')[0]}${page ? `#page=${page}` : ''}`
  return [`> [!quote] ${doc.title.split('\n').join(' ')}${where}`, ...lines, `> ${back}`].join('\n')
}

export const captureCaption = (doc: { title: string }, page: number, region: boolean) =>
  `${region ? 'Figure' : 'Page'} from ${doc.title.split('\n').join(' ')} · p. ${page}`

// ─── Labels far out: which names are drawn, at what size ─────────────────────
// Founder review #02. Far out (detail 0) a card's own title is too small to
// read, so names are drawn over the map at a fixed size on screen. Before,
// only the top-level subjects had one (a plate that vanished once its region
// was under 70px wide; a name that shrank with the zoom below 0.25), and every
// topic's name went at once at zoom 0.36. Here every subject and topic drawn
// is a candidate, most important first; one is drawn when its box on screen
// overlaps none already placed, so names never pile up and the ones that
// stay are predictable: the same zoom gives the same names.
//
// A card still wide enough on screen (INSIDE_MIN_PX) carries its own name
// inside it, cut to the card's width: cards never overlap, so these never
// collide and are always there. Smaller cards' names (subjects and topics
// only) are placed beside them by the overlap test, as above.
//
// Pure, and run once per resting zoom (not per frame): a pan moves the drawing
// and changes nothing here. A uniform grid keeps the overlap test near O(n).

export interface LabelCandidate {
  id: string
  x: number; y: number          // the card's centre, in map units
  text: string
  kind: 'subject' | 'topic'
  rank: number                   // lower first (subjects by depth, then topics by depth and order)
  card?: { w: number; h: number } // the card's size in map units: its name can sit inside it
  insideOnly?: boolean            // a note, page or task: named only inside its own card
}
export interface PlacedLabel { id: string; x: number; y: number; text: string; kind: 'subject' | 'topic'; px: number; inside: boolean }

// The narrowest a card may be on screen and still hold its name.
export const INSIDE_MIN_PX = 44
export const FAR_INSIDE_MAX = 900
export interface Blocker { minX: number; minY: number; maxX: number; maxY: number }   // screen pixels at the map's origin

// Screen sizes, and the width a character takes at them (Inter-like average).
export const FAR_LABEL_PX = { subject: 13, topic: 11 } as const
const CHAR_W = { subject: 7.4, topic: 6.1 } as const
const MAX_CHARS = { subject: 26, topic: 22 } as const
const PAD = 3
// Above this many, a far-out view is a picture, not a reading list.
export const FAR_LABEL_MAX = 240

const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

export function planFarLabels(candidates: readonly LabelCandidate[], k: number, blockers: readonly Blocker[] = [], max = FAR_LABEL_MAX): PlacedLabel[] {
  if (!(k > 0)) return []
  const cell = 64
  const grid = new Map<string, Blocker[]>()
  const keysOf = (b: Blocker) => {
    const out: string[] = []
    for (let gx = Math.floor(b.minX / cell); gx <= Math.floor(b.maxX / cell); gx++) for (let gy = Math.floor(b.minY / cell); gy <= Math.floor(b.maxY / cell); gy++) out.push(`${gx},${gy}`)
    return out
  }
  const hits = (b: Blocker) => keysOf(b).some(key => (grid.get(key) ?? []).some(o => b.minX < o.maxX && b.maxX > o.minX && b.minY < o.maxY && b.maxY > o.minY))
  const add = (b: Blocker) => { for (const key of keysOf(b)) grid.set(key, [...(grid.get(key) ?? []), b]) }
  for (const b of blockers) add(b)

  const out: PlacedLabel[] = []
  const ordered = [...candidates].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
  let outside = 0, inside = 0
  // Inside their own cards first: they claim the card's box, so no name placed beside a card covers another's.
  for (const c of ordered) {
    if (!c.card || c.card.w * k < INSIDE_MIN_PX || inside >= FAR_INSIDE_MAX) continue
    const px = FAR_LABEL_PX[c.kind]
    const room = Math.floor((c.card.w * k - 10) / CHAR_W[c.kind])
    const text = cut(c.text.trim(), Math.min(MAX_CHARS[c.kind], Math.max(4, room)))
    if (!text) continue
    const sx = c.x * k, sy = c.y * k, hw = (c.card.w * k) / 2, hh = (c.card.h * k) / 2
    const box = { minX: sx - hw, minY: sy - hh, maxX: sx + hw, maxY: sy + hh }
    if (hits(box)) continue        // under a subject's plate
    add(box)
    inside++
    out.push({ id: c.id, x: c.x, y: c.y, text, kind: c.kind, px, inside: true })
  }
  const placedInside = new Set(out.map(l => l.id))
  for (const c of ordered) {
    if (outside >= max) break
    if (placedInside.has(c.id) || c.insideOnly) continue
    const text = cut(c.text.trim(), MAX_CHARS[c.kind])
    if (!text) continue
    const px = FAR_LABEL_PX[c.kind]
    const w = text.length * CHAR_W[c.kind] + PAD * 2, h = px + PAD * 2
    // Centred on the card, on screen.
    const sx = c.x * k, sy = c.y * k
    const box = { minX: sx - w / 2, minY: sy - h / 2, maxX: sx + w / 2, maxY: sy + h / 2 }
    if (hits(box)) continue
    add(box)
    outside++
    out.push({ id: c.id, x: c.x, y: c.y, text, kind: c.kind, px, inside: false })
  }
  return out
}

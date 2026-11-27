// ─── Names over the map's cards (28 Nov 2026) ───────────────────────────────
// What lod.ts decides, drawn: a card's name always INSIDE its own card, cut
// to its width; far out, only subject headers (a subject with no region plate)
// and the names that always show (the selected card, its connections, search
// hits). Nothing is ever placed beside a card: the earlier placement of names
// next to small cards (founder review #02) made the overview a wall of text
// beside empty pills, and is gone.

import { LOD, charsThatFit, type Tier } from './lod'

export interface LabelCandidate {
  id: string
  x: number; y: number          // the card's centre, in map units
  text: string
  kind: 'subject' | 'topic'
  rank: number                   // lower first (subjects by depth, then topics by depth and order)
  card?: { w: number; h: number } // the card's size in map units
  insideOnly?: boolean            // a plated subject (named on its plate), or a note, page or task
}
export interface PlacedLabel { id: string; x: number; y: number; text: string; kind: 'subject' | 'topic'; px: number; inside: boolean }

// Every box drawn keeps its name (owner, 28 Nov): a guard only, above any real map.
export const FAR_INSIDE_MAX = 4000
const MAX_CHARS = { subject: 26, topic: 22 } as const
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

export function planCardLabels(candidates: readonly LabelCandidate[], k: number, tier: Tier, always: ReadonlySet<string> = new Set(), max = FAR_INSIDE_MAX): PlacedLabel[] {
  if (!(k > 0) || tier === 'close') return []
  const out: PlacedLabel[] = []
  const ordered = [...candidates].sort((a, b) => Number(always.has(b.id)) - Number(always.has(a.id)) || a.rank - b.rank || a.id.localeCompare(b.id))
  for (const c of ordered) {
    if (out.length >= max) break
    const named = always.has(c.id)
    if (tier === 'far' && !named) {
      // Far out only a subject's header, at a readable size; a plated subject has its plate.
      if (c.kind !== 'subject' || c.insideOnly) continue
      const text = cut(c.text.trim(), MAX_CHARS.subject)
      if (text) out.push({ id: c.id, x: c.x, y: c.y, text, kind: c.kind, px: LOD.headerPx, inside: false })
      continue
    }
    if (!c.card) continue
    const px = tier === 'mid' ? LOD.midTextPx : LOD.minTextPx
    const room = charsThatFit(c.card.w, k, px)
    if (room < 2) continue
    const text = cut(c.text.trim(), Math.max(2, room))
    if (text) out.push({ id: c.id, x: c.x, y: c.y, text, kind: c.kind, px, inside: true })
  }
  return out
}

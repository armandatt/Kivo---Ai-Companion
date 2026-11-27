// ─── How much a card says, from its size on screen (28 Nov 2026) ────────────
// Three tiers, from a card's on-screen width (its width × the zoom), decided
// once per frame:
//   far    under farBelowPx (a substantial zoom-out): plain coloured pills, no text. Only subject
//          headers carry names (no stats line). A pill's name is its tooltip.
//   mid    room for MID_TEXT_PX text: one line INSIDE the card, cut to the
//          card's width. Subject stats come back.
//   close  CLOSE_FROM_PX and up: the full card (name on two lines, status,
//          counts).
// A name is never drawn beside a card. The selected card, its connections
// and search hits are named (inside their card) at every tier.
// Hysteresis: a tier is entered at its threshold and left at DOWN × it, so a
// zoom resting near a threshold never flickers. Pure.

export const LOD = {
  // On-screen width of a topic card (the reference card) at the thresholds, px.
  // Owner, 28 Nov: a box keeps its text until a substantial zoom-out.
  farBelowPx: 44,
  closeFromPx: 140,
  // A tier is left when the width falls under this fraction of its threshold.
  down: 0.85,
  // Text sizes on screen, px: mid names, and names that always show (selected, connected, found).
  midTextPx: 10,
  minTextPx: 9,
  // Subject headers far out: a readable size whatever the zoom.
  headerPx: 13,
  // An average character's width at 1px of font (Inter-like), for cutting to a card.
  charW: 0.6,
  // Padding inside a card around its name, px on screen.
  padPx: 5,
  // The fade between tiers, ms.
  fadeMs: 120,
  // Reference card width in map units (CARD.topic.w).
  refW: 180,
} as const

export type Tier = 'far' | 'mid' | 'close'
const RANK: Record<Tier, number> = { far: 0, mid: 1, close: 2 }

// The tier for a card `widthPx` wide on screen, given the tier it was in.
export function tierFor(widthPx: number, prev: Tier | null = null, cfg: Pick<typeof LOD, 'farBelowPx' | 'closeFromPx' | 'down'> = LOD): Tier {
  const raw: Tier = widthPx >= cfg.closeFromPx ? 'close' : widthPx >= cfg.farBelowPx ? 'mid' : 'far'
  if (!prev || RANK[raw] >= RANK[prev]) return raw
  // Going down: only once under DOWN × the threshold of the tier being left.
  if (prev === 'close') return widthPx >= cfg.closeFromPx * cfg.down ? 'close' : widthPx >= cfg.farBelowPx * cfg.down ? 'mid' : 'far'
  return widthPx >= cfg.farBelowPx * cfg.down ? 'mid' : 'far'
}

export const tierAtZoom = (k: number, prev: Tier | null = null) => tierFor(LOD.refW * k, prev)

// How many characters fit in a card `cardW` map units wide at zoom k, at `px` text.
export const charsThatFit = (cardW: number, k: number, px: number) => Math.floor((cardW * k - LOD.padPx * 2) / (px * LOD.charW))

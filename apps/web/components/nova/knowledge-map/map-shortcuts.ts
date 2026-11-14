// The map's keyboard shortcuts: one list, read by the key handler and by the
// help panel, so what the panel says is what the keys do. Pure.
//
// Rules: nothing is taken while the learner types (an input, a text area, a
// select, anything editable); a key held with Ctrl, Cmd or Alt is left to the
// browser and the system, except the two combinations listed here; and a
// shortcut whose action is not available says why instead of doing nothing.

export type ShortcutAction =
  | 'search' | 'navigate' | 'open' | 'explore' | 'up' | 'fold' | 'escape'
  | 'zoom_in' | 'zoom_out' | 'actual_size' | 'fit' | 'add' | 'delete' | 'help' | 'pan' | 'lens' | 'next'

export interface Shortcut { action: ShortcutAction; keys: string[]; label: string; group: 'Find and move' | 'View' | 'Edit' }

// `Mod` is ⌘ on a Mac and Ctrl elsewhere.
export const SHORTCUTS: readonly Shortcut[] = [
  { action: 'search',      keys: ['/', 'Mod+K'],          label: 'Find on the map', group: 'Find and move' },
  { action: 'navigate',    keys: ['←', '→', '↑', '↓'],    label: 'Move to the nearest card in that direction, across the whole map (with nothing selected, start from the card in the middle of the view)', group: 'Find and move' },
  { action: 'pan',         keys: ['Shift+←→↑↓'],          label: 'Move the view', group: 'Find and move' },
  { action: 'explore',     keys: ['Enter'],               label: 'Explore inside the selected card (a card with nothing inside shows its details)', group: 'Find and move' },
  { action: 'open',        keys: ['Shift+Enter'],         label: 'Show the selected card’s details', group: 'Find and move' },
  { action: 'up',          keys: ['U'],                   label: 'Up one level, out of an explored card', group: 'Find and move' },
  { action: 'next',        keys: ['G'],                   label: 'Go to the next card the search or lens points at (a gap, a match)', group: 'Find and move' },
  { action: 'escape',      keys: ['Esc'],                 label: 'Close a menu or panel, then clear the selection, then step out of an explored card', group: 'Find and move' },
  { action: 'fold',        keys: ['Space'],               label: 'Fold or show what is inside the selected card', group: 'View' },
  { action: 'zoom_in',     keys: ['+'],                   label: 'Zoom in', group: 'View' },
  { action: 'zoom_out',    keys: ['-'],                   label: 'Zoom out', group: 'View' },
  { action: 'lens',        keys: ['L'],                   label: 'Change the lens: Structure, Learning, Gaps', group: 'View' },
  { action: 'fit',         keys: ['F'],                   label: 'Fit the whole map (or the explored card) on screen', group: 'View' },
  { action: 'actual_size', keys: ['0'],                   label: 'Zoom to 100%, centred on the selected card. Card positions do not change', group: 'View' },
  { action: 'add',         keys: ['N'],                   label: 'Add a card inside or beside the selected one', group: 'Edit' },
  { action: 'delete',      keys: ['Delete', 'Backspace'], label: 'Delete the selected card. You always confirm first', group: 'Edit' },
  { action: 'help',        keys: ['?'],                   label: 'Show these shortcuts', group: 'Edit' },
]

export interface KeyLike {
  key: string
  shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean
}

// What the learner is typing into: never a shortcut.
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean; type?: string; closest?: (s: string) => unknown }
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes((el.type ?? 'text').toLowerCase())
  return typeof el.closest === 'function' && !!el.closest('[contenteditable="true"], [role="textbox"]')
}

export type Arrow = 'left' | 'right' | 'up' | 'down'
const ARROWS: Record<string, Arrow> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

export type KeyResult =
  | { action: Exclude<ShortcutAction, 'navigate' | 'pan'> }
  | { action: 'navigate' | 'pan'; arrow: Arrow }
  // Alt and an arrow: move the focused card itself (Shift for further).
  | { action: 'nudge'; arrow: Arrow; far: boolean }

// The shortcut a key press means, or null to leave it alone.
export function shortcutFor(e: KeyLike): KeyResult | null {
  const mod = !!(e.metaKey || e.ctrlKey)
  const arrow = ARROWS[e.key]
  if (mod) return !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' ? { action: 'search' } : null
  if (e.altKey) return arrow ? { action: 'nudge', arrow, far: !!e.shiftKey } : null
  if (arrow) return { action: e.shiftKey ? 'pan' : 'navigate', arrow }
  switch (e.key) {
    case '/': return { action: 'search' }
    case '?': return { action: 'help' }
    case 'Enter': return { action: e.shiftKey ? 'open' : 'explore' }
    case 'Escape': return { action: 'escape' }
    case ' ': case 'Spacebar': return { action: 'fold' }
    case '+': case '=': return { action: 'zoom_in' }
    case '-': case '_': return { action: 'zoom_out' }
    case '0': return { action: 'actual_size' }
    case 'f': case 'F': return { action: 'fit' }
    case 'n': case 'N': return { action: 'add' }
    case 'u': case 'U': return { action: 'up' }
    case 'l': case 'L': return { action: 'lens' }
    case 'g': case 'G': return { action: 'next' }
    case 'Delete': case 'Backspace': return { action: 'delete' }
    default: return null
  }
}

export const isMacPlatform = (platform: string): boolean => /mac|iphone|ipad|ipod/i.test(platform)

// A key as the learner's keyboard shows it.
export function keyLabel(key: string, mac: boolean): string {
  return key.replace('Mod+', mac ? '⌘' : 'Ctrl+').replace('Shift+', mac ? '⇧' : 'Shift+')
}

// ── Moving between cards with the arrow keys ─────────────────────────────────
// By where the cards are on screen, not by how they are filed: from the
// selected card, the nearest card in that direction, the ones in line with
// it first (straight above, below, to the left or right), then the nearest.
// Any drawn card can be reached, whatever it belongs to, so the arrows cross
// from one subject's branch into the next. The card reached is where the next
// arrow starts. A card mostly off to the side is not "in that direction";
// with nothing there, the selection stays.

export interface NavBox { x: number; y: number; w: number; h: number }
export type NavResult = { to: string } | { to: null; why: string }

const SIDE: Record<Arrow, string> = { left: 'to the left', right: 'to the right', up: 'above', down: 'below' }

export function navigate(from: string, arrow: Arrow, boxes: ReadonlyMap<string, NavBox>): NavResult {
  const a = boxes.get(from)
  if (!a) return { to: null, why: 'That card is not on the map.' }
  const horiz = arrow === 'left' || arrow === 'right'
  const sign = arrow === 'right' || arrow === 'down' ? 1 : -1
  let best: string | null = null, bestScore = Infinity
  for (const [id, b] of boxes) {
    if (id === from) continue
    // How far ahead it is (centre to centre), and the gap between their edges that way.
    const along = (horiz ? b.x - a.x : b.y - a.y) * sign
    if (along <= 1) continue
    const gapAlong = Math.max(0, along - (horiz ? (a.w + b.w) / 2 : (a.h + b.h) / 2))
    // How far off to the side: nothing when the two overlap across the direction.
    const across = horiz ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x)
    const gapAcross = Math.max(0, across - (horiz ? (a.h + b.h) / 2 : (a.w + b.w) / 2))
    // Mostly beside rather than ahead: not in that direction.
    if (gapAcross > 0 && across > along * 2) continue
    const score = gapAlong + gapAcross * 3 + across * 0.12
    if (score < bestScore - 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && best !== null && id < best)) { bestScore = score; best = id }
  }
  return best ? { to: best } : { to: null, why: `No card ${SIDE[arrow]}.` }
}

// The card nearest a point (the middle of the view): where the arrows start
// when nothing is selected.
export function nearestTo(point: { x: number; y: number }, boxes: ReadonlyMap<string, NavBox>): string | null {
  let best: string | null = null, bestD = Infinity
  for (const [id, b] of boxes) { const d = Math.hypot(b.x - point.x, b.y - point.y); if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && best !== null && id < best)) { bestD = d; best = id } }
  return best
}

// ── Enter ────────────────────────────────────────────────────────────────────
// Which card Enter acts on: the one the learner chose last (a click, a search
// result, an arrow key, Tab), recorded the moment they chose it. Keyboard focus
// follows a frame later, so the focused card is only a fallback; a card no
// longer on the map is never acted on.
export function enterTarget(s: { chosen: string | null; focused: string | null; selected: string | null; onMap: ReadonlySet<string> }): string | null {
  for (const id of [s.chosen, s.focused, s.selected]) if (id && s.onMap.has(id)) return id
  return null
}

// What Enter does to it: explore inside it; for a card with nothing inside,
// show its details (no empty map); nothing for the card already explored.
export type EnterAction = 'explore' | 'details' | 'already' | 'none'
export const enterAction = (target: string | null, s: { exploring: string | null; explorable: (id: string) => boolean }): EnterAction =>
  !target ? 'none' : target === s.exploring ? 'already' : s.explorable(target) ? 'explore' : 'details'

// What the map remembers between visits, in this browser only: the pan and
// zoom the learner left it with, and the orientation they chose. A view comes
// back only for the same picture (the same cards drawn); for any other it is
// fitted afresh, so a stale view never opens on an empty corner. Storage can
// be missing or refuse (a private window); the map then just fits itself.

import type { View } from './explore'

export type Orientation = 'tree' | 'outline'

const VIEW_KEY = 'kivo-map-view'
const ORIENTATION_KEY = 'kivo-map-orientation'
const KEEP = 24

// Names a picture: which cards are drawn, in which orientation. Two loads of
// the same data give the same name whatever order the cards arrive in.
export function pictureKey(ids: Iterable<string>, orientation: Orientation): string {
  let h = 5381
  for (const id of [...ids].sort()) for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0
  return `${orientation}:${h.toString(36)}`
}

type Stored = Array<{ where: string; picture: string; view: View }>

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function read(store: Store | null): Stored {
  try {
    const raw = store?.getItem(VIEW_KEY)
    const list = raw ? JSON.parse(raw) as unknown : []
    return Array.isArray(list) ? list.filter((x): x is Stored[number] =>
      !!x && typeof x.where === 'string' && typeof x.picture === 'string' && validView(x.view)) : []
  } catch { return [] }
}

const validView = (v: unknown): v is View => {
  const x = v as View | null
  return !!x && [x.x, x.y, x.k].every(n => typeof n === 'number' && Number.isFinite(n)) && x.k > 0
}

// where: the workspace and the card explored ("all/root", "<id>/topic:…").
export function recallView(store: Store | null, where: string, picture: string): View | null {
  const hit = read(store).find(x => x.where === where)
  return hit && hit.picture === picture ? hit.view : null
}

export function rememberView(store: Store | null, where: string, picture: string, view: View): void {
  try {
    const rest = read(store).filter(x => x.where !== where)
    store?.setItem(VIEW_KEY, JSON.stringify([{ where, picture, view: { x: Math.round(view.x), y: Math.round(view.y), k: Math.round(view.k * 1000) / 1000 } }, ...rest].slice(0, KEEP)))
  } catch { /* a full or blocked store: the map fits itself next time */ }
}

export function forgetViews(store: Store | null): void {
  try { store?.removeItem(VIEW_KEY) } catch { /* nothing to forget */ }
}

// The orientation the learner chose, or null for the device's own: the
// outline on a phone-width screen, the tree from left to right elsewhere.
export function chosenOrientation(store: Store | null): Orientation | null {
  try {
    const v = store?.getItem(ORIENTATION_KEY)
    return v === 'tree' || v === 'outline' ? v : null
  } catch { return null }
}

export function chooseOrientation(store: Store | null, o: Orientation | null): void {
  try { if (o) store?.setItem(ORIENTATION_KEY, o); else store?.removeItem(ORIENTATION_KEY) } catch { /* kept for this visit only */ }
}

// Below this width the device's own orientation is the outline. A width, not
// the frame's shape: opening the details panel or resizing a little never
// turns the map round.
export const OUTLINE_QUERY = '(max-width: 639px)'

export const browserStore = (): Store | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

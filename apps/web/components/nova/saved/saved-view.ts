// How the saved-pages library is laid out. Board (cards with thumbnails) is
// the default; a learner who chose List keeps it. Only an explicit 'list'
// choice is honoured, so a missing, cleared or unknown value opens the board.

export type SavedView = 'grid' | 'list'
export const SAVED_VIEW_KEY = 'kivo-saved-view'
export const DEFAULT_SAVED_VIEW: SavedView = 'grid'

export const savedViewFrom = (stored: string | null | undefined): SavedView => (stored === 'list' ? 'list' : DEFAULT_SAVED_VIEW)

type Store = Pick<Storage, 'getItem' | 'setItem'>
const browserStore = (): Store | null => { try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null } }

export function readSavedView(store: Store | null = browserStore()): SavedView {
  try { return savedViewFrom(store?.getItem(SAVED_VIEW_KEY)) } catch { return DEFAULT_SAVED_VIEW }
}

export function writeSavedView(view: SavedView, store: Store | null = browserStore()): void {
  try { store?.setItem(SAVED_VIEW_KEY, view) } catch { /* storage off: the choice lasts this visit */ }
}

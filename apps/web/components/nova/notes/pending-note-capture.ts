// A capture the extension or the bookmarklet brought to the capture page,
// held while the learner signs in. It arrives in the address's fragment,
// which a redirect to sign-in keeps; the sign-in page parks it here for ten
// minutes so the capture page still has it afterwards. It is the passage,
// the page's address and title: nothing about the account, and it never
// leaves this browser tab's session.

import { readNoteCapture, type NoteCapture } from '@repo/api/nova/product/note-capture'

const KEY = 'kivo-pending-note-capture'
const KEEP_MS = 10 * 60_000

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const session = (): Store | null => { try { return window.sessionStorage } catch { return null } }

// Called on the sign-in page. A Save-to-Saved capture (#save=…) is the
// Saved page's and is left to it.
export function parkNoteCapture(hash: string = window.location.hash, store: Store | null = session(), now = Date.now()): void {
  try {
    if (!hash || hash.includes('save=')) return
    const capture = readNoteCapture(hash)
    if (capture) store?.setItem(KEY, JSON.stringify({ capture, at: now }))
  } catch { /* storage refused: the passage can be pasted instead */ }
}

function readParked(store: Store | null, now: number): NoteCapture | null {
  try {
    const raw = store?.getItem(KEY)
    if (!raw) return null
    const parked = JSON.parse(raw) as { capture?: NoteCapture; at?: unknown }
    if (typeof parked.at === 'number' && now - parked.at < KEEP_MS && parked.capture && typeof parked.capture.text === 'string') return parked.capture
    store?.removeItem(KEY)
  } catch { /* nothing usable parked */ }
  return null
}

export const hasParkedNoteCapture = (store: Store | null = session(), now = Date.now()) => readParked(store, now) !== null

// The capture for this visit, taken once: from the address, else parked.
export function takeNoteCapture(hash: string = window.location.hash, store: Store | null = session(), now = Date.now()): NoteCapture | null {
  const fromAddress = hash ? readNoteCapture(hash) : null
  const parked = readParked(store, now)
  try { store?.removeItem(KEY) } catch { /* nothing to remove */ }
  return fromAddress ?? parked
}

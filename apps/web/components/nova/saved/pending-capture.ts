// A page the bookmarklet brought, on its way to the Save a link box.
// It arrives in the address's fragment. If the learner has to sign in first,
// the sign-in page parks it here for a few minutes so it is still there when
// they reach Saved. It is an address and a title: nothing about the account.

import { readCapture } from '@repo/api/nova/product/resource-link'

const KEY = 'kivo-pending-save'
const KEEP_MS = 10 * 60_000

export type Capture = { url: string; title: string }

// Parks whatever the current address carries. Called on the sign-in page.
export function parkCapture(): void {
  try {
    const capture = readCapture(window.location.hash)
    if (capture) window.sessionStorage.setItem(KEY, JSON.stringify({ ...capture, at: Date.now() }))
  } catch { /* storage refused: the link can be pasted instead */ }
}

// Parks a link the learner was in the middle of saving when their session
// turned out to have ended, so it is waiting for them after they sign in.
export function parkDraft(url: string, title: string): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ url, title, at: Date.now() })) } catch { /* storage refused */ }
}

// Whether a capture is parked and still fresh. Sign-in does not always land
// on Saved (Google sign-in returns to Home), so the dashboard asks this and
// sends the learner on to Saved, where the capture is waiting to be reviewed.
export function hasParkedCapture(): boolean {
  try {
    const parked = window.sessionStorage.getItem(KEY)
    if (!parked) return false
    const saved = JSON.parse(parked) as { url?: unknown; at?: unknown }
    if (typeof saved.at === 'number' && Date.now() - saved.at < KEEP_MS && typeof saved.url === 'string') return true
    window.sessionStorage.removeItem(KEY)
  } catch { /* nothing parked */ }
  return false
}

// The capture for this visit, taken once: from the address, or parked.
export function takeCapture(): Capture | null {
  let capture: Capture | null = null
  try {
    capture = readCapture(window.location.hash)
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch { /* leave the address as it is */ }
  try {
    const parked = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    if (!capture && parked) {
      const saved = JSON.parse(parked) as { url?: unknown; title?: unknown; at?: unknown }
      if (typeof saved.at === 'number' && Date.now() - saved.at < KEEP_MS && typeof saved.url === 'string') {
        capture = readCapture(`#save=${encodeURIComponent(saved.url)}&title=${encodeURIComponent(typeof saved.title === 'string' ? saved.title : '')}`)
      }
    }
  } catch { /* nothing parked */ }
  return capture
}

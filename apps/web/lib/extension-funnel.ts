// The extension install funnel, as events in Vercel Web Analytics (already on
// every page through <Analytics /> in app/layout.tsx; no other provider).
// Page views of /saved are counted by Analytics itself. Each event carries
// only where it happened: no name, email, account id, address or code.
// A failure to record never affects the page.

import { track } from '@vercel/analytics'

export type FunnelEvent =
  | 'Extension store opened'     // an Add Kivo to Chrome button
  | 'Extension sign-up opened'   // the landing page's button, before the store link is set
  | 'Extension code requested'   // Connect a browser
  | 'Extension connected'        // a browser redeemed the code shown

export type FunnelPlace = 'saved-intro' | 'saved-steps' | 'saved-faq' | 'saved-connected' | 'landing' | 'guide' | 'saved-panel'

export function recordFunnel(event: FunnelEvent, from: FunnelPlace): void {
  try { track(event, { from }) } catch { /* analytics is never in the way */ }
}

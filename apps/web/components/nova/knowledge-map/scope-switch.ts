// ─── Switching what the map shows: one workspace, or everything ─────────────
// The map page keeps the map it has while the next one loads (so nothing
// flashes empty), which used to mean that choosing "Everything" on a slow or
// failing request left the previous workspace on screen with no sign that
// anything was asked: the request's failure was swallowed. This says what the
// page is showing against what was asked, so it can say "Loading…" or
// "Couldn't load…" with Retry. Pure.

// requested: null for the default (the workspace worked on last), "all", or a workspace id.
// shown: the workspace the map on screen is of (null: everything).
export type ScopeState =
  | { kind: 'showing' }
  | { kind: 'switching'; to: string }
  | { kind: 'failed'; to: string }

export function scopeState(o: { requested: string | null; shown: string | null | undefined; hasView: boolean; refreshing: boolean; error: boolean; label: (id: string) => string }): ScopeState {
  if (!o.hasView || o.requested === null) return { kind: 'showing' }
  const matches = o.requested === 'all' ? o.shown === null : o.shown === o.requested
  if (matches) return { kind: 'showing' }
  const to = o.requested === 'all' ? 'Everything' : o.label(o.requested)
  // Asked for, not shown, and nothing in flight: the request failed.
  if (o.error && !o.refreshing) return { kind: 'failed', to }
  return { kind: 'switching', to }
}

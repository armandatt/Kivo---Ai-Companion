// What the Knowledge Map page shows (P0, 28 Nov), decided only from the
// server's answer for this load, never from onboarding, sessionStorage or
// which pages were visited. Every visit reads the map again (no-store), so
// leaving and coming back, a reload, or a new sign-in all land here the same.
//
//   loading     the first read is on its way: no empty state yet, so a map
//               that exists never flashes "start your map"
//   error       no answer: say so with Retry; never taken for "empty"
//   empty       no map to draw: Import a Knowledge Map / Build with Nova
//               (a new account whose Nova space isn't set up has no map either)
//   scope-empty one map is chosen and it is empty, other maps exist
//   populated   the map

export interface MapViewLike {
  status: string
  nodes?: unknown[]
  workspaceId?: string | null
  workspaces?: Array<{ id: string }>
}

export type MapPageState = 'loading' | 'error' | 'empty' | 'scope-empty' | 'populated'

export function mapPageState(view: MapViewLike | null, loading: boolean): MapPageState {
  if (loading && !view) return 'loading'
  if (!view) return 'error'
  // not_connected / onboarding_incomplete: no Nova space yet, so no map.
  if (view.status !== 'ready') return 'empty'
  if ((view.nodes?.length ?? 0) > 0) return 'populated'
  const others = (view.workspaces ?? []).filter(w => w.id !== view.workspaceId)
  return view.workspaceId && others.length > 0 ? 'scope-empty' : 'empty'
}

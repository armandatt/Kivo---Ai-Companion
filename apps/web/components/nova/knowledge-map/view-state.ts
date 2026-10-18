// What the map keeps across a reload of its data. The page reloads the map
// every minute, when the tab comes back and after an edit; none of those is
// a reason to move the learner's view or drop what they selected. Pure.

import type { MapNodeType } from '@repo/api/nova/product/knowledge-map.types'

export interface FitInputs {
  shown:      Record<MapNodeType, boolean>
  subject:    string
  scope:      string | null
  showLinks:  boolean
  portrait:   boolean
  // Bumped when saved positions arrive or are reset.
  generation: number
}

// The map is fitted to the screen when this changes: when the learner asks
// for a different picture (a filter, a subject, a scope, links shown or not),
// the frame changes shape, or the saved layout arrives or is reset. New data
// for the same picture changes nothing here, so a reload keeps the view.
// The Fit button and the 0 key fit whenever they are used.
export function fitKey(f: FitInputs): string {
  return JSON.stringify([f.shown.subject, f.shown.topic, f.shown.note, f.shown.resource, f.subject, f.scope, f.showLinks, f.portrait, f.generation])
}

// After a reload: what the learner selected, scoped to or is hovering over is
// kept while the item is still on the map, and dropped once it is not
// (deleted elsewhere, or archived). Used as a state update, so an id that is
// still valid comes back as itself and nothing re-renders for it.
export const keepValid = (id: string | null, nodeIds: ReadonlySet<string>): string | null =>
  id !== null && nodeIds.has(id) ? id : null

// The item a ?focus= link names, applied on the map's first view only (the
// caller marks it applied then, found or not): a reload does not take the
// learner back to it, and an item that appears later does not pull them away.
export function focusToApply(param: string | null, nodeIds: ReadonlySet<string>, applied: boolean): string | null {
  if (applied || !param || !nodeIds.has(param)) return null
  return param
}

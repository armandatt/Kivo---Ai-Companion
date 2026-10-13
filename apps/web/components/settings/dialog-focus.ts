// Where Tab goes inside an open modal, so it never leaves it. Given the
// dialog's tab stops in order and the element that has focus, this answers
// the element to focus instead, or null when the browser's own next stop is
// already inside the dialog.

export function trappedTabTarget<T>(stops: readonly T[], active: T | null, shift: boolean, dialog: T): T | null {
  const first = stops[0]
  const last  = stops[stops.length - 1]
  // Nothing can take focus (every control is disabled): the dialog keeps it.
  if (first === undefined || last === undefined) return dialog
  const at = active === null ? -1 : stops.indexOf(active)
  // Focus is on the dialog itself, or has got outside it: bring it in.
  if (at === -1) return shift ? last : first
  if (shift && at === 0) return last
  if (!shift && at === stops.length - 1) return first
  return null
}

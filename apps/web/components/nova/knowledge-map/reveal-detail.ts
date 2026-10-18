// Bringing the selected item's details into view on a narrow screen. Below
// the `lg` breakpoint the panel sits under the canvas, and the canvas keeps
// touch for dragging, so a selection there would otherwise show nothing.
// Beside the canvas (lg and wider) it is already in view and nothing moves.
// Only an explicit selection calls this: a drag, a press on the background
// or a link that opens the map on an item never scrolls the page.

// Tailwind's `lg`: the width from which the panel sits beside the canvas.
export const PANEL_BESIDE_QUERY = '(min-width: 1024px)'

type Scrollable = Pick<HTMLElement, 'scrollIntoView'>
type Media = { matchMedia: (query: string) => { matches: boolean } }

// true: the panel was scrolled into view.
export function revealDetail(panel: Scrollable | null, win: Media): boolean {
  if (!panel || win.matchMedia(PANEL_BESIDE_QUERY).matches) return false
  const still = win.matchMedia('(prefers-reduced-motion: reduce)').matches
  // "nearest": the least movement that shows the panel, so the canvas above
  // it, with the selected card, stays on screen where it fits.
  panel.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  return true
}

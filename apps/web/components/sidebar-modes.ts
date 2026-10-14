// What the sidebar does in each of its two modes, as plain data, so the rules
// can be tested without a browser. Run with `npm test`.
//
// Docked (every page but Creature): beside the page from 1024px up; below
// that, a drawer opened by the sidebar's own menu button.
// Overlay (Creature): floats over the world at every width, opened and closed
// by the shell, which draws the only button for it.

export type SidebarState = {
  overlay:      boolean
  /** The shell's state: whether the sidebar is shown at all */
  open:         boolean
  /** The docked drawer, below 1024px */
  isMobileOpen: boolean
  /** The window is 1024px or wider, where a docked sidebar sits beside the page */
  docked:       boolean
}

export type SidebarModes = {
  /** The sidebar draws its own menu button. Never on Creature: the shell's is the only one */
  ownToggle:   boolean
  /** It covers the page: a modal, focus moves in, Escape closes it, Tab stays inside */
  covering:    boolean
  /** Where the backdrop shows: under a small-screen drawer, or over the world at every width */
  backdrop:    'none' | 'small_screens' | 'every_width'
  /** The page behind stays still. Not on Creature, which never scrolls */
  lockScroll:  boolean
  /** The desktop icon rail. Not on Creature, where the sidebar is a passing overlay */
  collapsible: boolean
  /** A close button inside the sidebar, for the overlay that has no toggle of its own */
  closeButton: boolean
  /** Not shown, so it takes no focus and is not read out, from the moment it
   *  starts closing: the slide out is only how it looks */
  inert:       boolean
}

export function sidebarModes({ overlay, open, isMobileOpen, docked }: SidebarState): SidebarModes {
  const covering = overlay ? open : open && isMobileOpen
  const shown    = overlay ? open : open && (docked || isMobileOpen)
  return {
    inert:       !shown,
    ownToggle:   !overlay,
    covering,
    backdrop:    !covering ? 'none' : overlay ? 'every_width' : 'small_screens',
    lockScroll:  covering && !overlay,
    collapsible: !overlay,
    closeButton: overlay,
  }
}

'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  BookOpen,
  Bookmark,
  Waypoints,
  Calendar,
  CalendarDays,
  Compass,
  Dna,
  Globe,
  Home,
  LogOut,
  Map,
  Settings,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Zap,
  Menu,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react'
import { NOVA_ROUTES, type Companion } from '@repo/api/nova/product/companion'
import { cn } from '@/lib/utils'
import { ThemePicker } from '@/components/theme/kivo-theme'
import { KivoTile, KivoWordmark } from '@/components/brand/kivo-brand'
import { trappedTabTarget } from '@/components/settings/dialog-focus'
import { sidebarModes } from './sidebar-modes'

interface SidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, sidebar always floats as an overlay (never inline-pushes content) */
  overlay?: boolean
  /** Which companion the account uses: decides the branding and the pages listed */
  companion: Companion
}

const navItems = [
  { href: '/home',     label: 'Home',     icon: Home },
  { href: '/planner',  label: 'Planner',  icon: Calendar },
  { href: '/coach',    label: 'Coach',    icon: Zap },
  { href: '/journey',  label: 'Journey',  icon: Compass },
  { href: '/progress', label: 'Progress', icon: BarChart3 },
  { href: '/goals',    label: 'Goals',    icon: Target },
  { href: '/creature', label: 'Creature', icon: Map },
  { href: '/guide',    label: 'Guide',    icon: BookOpen },
]

// Nova's pages, from the one list that also decides route access.
const NOVA_ICONS: Record<string, typeof Home> = { '/home': Home, '/build': Sparkles, '/planner': Calendar, '/calendar': CalendarDays, '/focus': Timer, '/knowledge': BookOpen, '/map': Waypoints, '/notes': NotebookPen, '/saved': Bookmark, '/progress': TrendingUp, '/learning-dna': Dna, '/creature': Map, '/guide': Compass }
const novaNavItems = NOVA_ROUTES.map(r => ({ href: r.path, label: r.label, icon: NOVA_ICONS[r.path] ?? Home }))

type NavItem = typeof navItems[number]

// Nova's pages grouped by what they are for. A page not named here (a new one
// in NOVA_ROUTES) is listed after the groups, so none is ever dropped.
const NOVA_GROUPS: ReadonlyArray<{ label: string; paths: readonly string[] }> = [
  { label: 'Plan',      paths: ['/home', '/build', '/planner', '/calendar', '/focus'] },
  { label: 'Knowledge', paths: ['/knowledge', '/map', '/notes', '/saved'] },
  { label: 'Growth',    paths: ['/progress', '/learning-dna', '/creature'] },
]

function groupsOf(items: NavItem[], isNova: boolean): Array<{ label: string | null; items: NavItem[] }> {
  if (!isNova) return [{ label: null, items }]
  const grouped = NOVA_GROUPS.map(g => ({ label: g.label, items: items.filter(i => g.paths.includes(i.href)) }))
  const rest = items.filter(i => !NOVA_GROUPS.some(g => g.paths.includes(i.href)))
  return [...grouped, { label: null, items: rest }].filter(g => g.items.length > 0)
}

// The shell's Creature button points at the sidebar by this id too.
export const SIDEBAR_ID = 'kivo-sidebar'
const TAB_STOPS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// Tailwind's lg: from here up the docked sidebar sits beside the page.
const DOCKED = '(min-width: 1024px)'
const subscribeDocked = (onChange: () => void) => {
  const query = window.matchMedia(DOCKED)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const isDocked = () => window.matchMedia(DOCKED).matches
// The server cannot know the width, so it draws the desktop sidebar, where
// nothing is inert. A closed small-screen drawer is already hidden by CSS.
const dockedOnServer = () => true

// The companion's own colour marks whose dashboard this is (the dot under the
// wordmark). The current page is Kivo's selected state, teal, for both: a soft
// wash, a bar and the icon, with the text left in the theme's foreground so it
// reads in light and dark alike.
const ACCENT = {
  nova: { dot: 'bg-nova' },
  rex:  { dot: 'bg-green-500' },
}
const CURRENT = 'bg-action-soft text-sidebar-foreground [&_svg]:text-action-ink'

export function Sidebar({ open, onOpenChange, overlay = false, companion }: SidebarProps) {
  const pathname = usePathname()
  const isNova   = companion === 'nova'
  const items    = isNova ? novaNavItems : navItems
  const accent   = ACCENT[isNova ? 'nova' : 'rex']
  const docked   = useSyncExternalStore(subscribeDocked, isDocked, dockedOnServer)
  // The drawer remembers the page it was opened on: going to any other page
  // closes it, and so does widening the window until the sidebar sits beside
  // the page (React's adjust-state-while-rendering, so no effect is needed).
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  if (openedOn !== null && (openedOn !== pathname || docked)) setOpenedOn(null)
  const isMobileOpen = openedOn !== null && openedOn === pathname && !docked
  const setIsMobileOpen = (next: boolean) => setOpenedOn(next ? pathname : null)
  const [collapsed, setCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const mode = sidebarModes({ overlay, open, isMobileOpen, docked })
  // The icon rail is desktop only; a small-screen drawer always shows labels.
  const rail = collapsed && mode.collapsible

  // A full page load, so nothing of the signed-in dashboard stays mounted.
  const signOut = async () => {
    setSigningOut(true)
    try {
      await fetch('/api/logout', { method: 'POST' })
    } finally {
      window.location.href = '/'
    }
  }

  // While the menu covers the page, focus moves into it and Tab and Shift+Tab
  // stay inside. Escape closes it and puts the keyboard back on the button
  // that opened it: the menu button here, or on Creature the shell's own.
  useEffect(() => {
    if (!mode.covering) return
    const drawer = drawerRef.current
    // The menu button stays the same element while the drawer is open.
    const toggle = toggleRef.current
    drawer?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (overlay) { onOpenChange(false); return }
        setOpenedOn(null)
        toggleRef.current?.focus()
        return
      }
      if (e.key !== 'Tab' || !drawer) return
      // The menu button shows X while the drawer is open, so it is part of
      // the drawer. Controls hidden at this width are not stops.
      const inside = Array.from(drawer.querySelectorAll<HTMLElement>(TAB_STOPS))
      const stops  = [...(toggleRef.current ? [toggleRef.current] : []), ...inside].filter(el => el.getClientRects().length > 0)
      // Between the ends the rule leaves the move to the browser, but a browser
      // may skip links (Safari's Tab reaches only form fields by default) and
      // land on the page behind. So every step is taken here.
      const active = document.activeElement as HTMLElement | null
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, drawer)
        ?? stops[stops.indexOf(active as HTMLElement) + (e.shiftKey ? -1 : 1)]
      if (target) { e.preventDefault(); target.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Closed by choosing a page, or by the page changing under it: if the
      // keyboard was in the drawer (or was dropped when it went inert), it
      // goes back to the menu button. On Creature the shell does this.
      const active = document.activeElement
      if (!overlay && (!active || active === document.body || drawer?.contains(active))) toggle?.focus()
    }
  }, [mode.covering, overlay, onOpenChange])

  // A drawer over the page keeps the page behind it still.
  useEffect(() => {
    if (!mode.lockScroll) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mode.lockScroll])

  // A page and the pages under it (a note inside Notes) light the same entry.
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // Choosing a page closes whatever covered it.
  const close = () => { setIsMobileOpen(false); if (overlay) onOpenChange(false) }
  // Closing from the backdrop: the keyboard goes back where it came from.
  const dismiss = () => {
    if (overlay) { onOpenChange(false); return }
    setIsMobileOpen(false)
    toggleRef.current?.focus()
  }

  // Off screen is also out of the tab order and hidden from screen readers:
  // inert from the moment it closes, invisible once it has slid out.
  // Visibility is animated only on the way out. Opening, it must be visible
  // at once: an element that is still invisible cannot take focus.
  const hidden = 'invisible -translate-x-full transition-[transform,width,visibility]'
  const shown  = 'translate-x-0 transition-[transform,width]'
  const position = overlay
    ? (open ? shown : hidden)
    : !open ? hidden
    : isMobileOpen ? shown
    : `${hidden} lg:visible lg:translate-x-0`

  const row = cn('flex items-center gap-3 rounded-lg px-4 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', rail && 'lg:justify-center lg:px-0 lg:py-2.5')
  const label = cn('font-medium', rail && 'lg:sr-only')

  return (
    <>
      {/* Mobile Toggle. Not on Creature, where the shell draws the only one */}
      {mode.ownToggle && (
        <button
          type="button"
          ref={toggleRef}
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileOpen}
          aria-controls={SIDEBAR_ID}
          className="fixed top-4 left-4 z-50 lg:hidden p-2 hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          {isMobileOpen ? (
            <X aria-hidden className="w-6 h-6" />
          ) : (
            <Menu aria-hidden className="w-6 h-6" />
          )}
        </button>
      )}

      {/* Sidebar */}
      {/* One element in both states, so the slide and focus survive opening
          and closing. A div, because ARIA-in-HTML does not allow role="dialog"
          on an aside; beside the page it keeps the aside's own role. */}
      <div
        ref={drawerRef}
        id={SIDEBAR_ID}
        tabIndex={-1}
        inert={mode.inert}
        role={mode.covering ? 'dialog' : 'complementary'}
        aria-modal={mode.covering ? true : undefined}
        aria-label={mode.covering ? 'Navigation' : undefined}
        className={cn(
          'left-0 top-0 z-40 flex h-screen w-70 shrink-0 flex-col border-r border-sidebar-border bg-sidebar outline-none duration-300 ease-in-out',
          overlay ? 'fixed' : 'fixed lg:relative',
          rail && 'lg:w-[72px]',
          position,
        )}
      >
        {/* Logo Area. Below 1024px the menu button sits over its left edge */}
        <div className={cn(
          'flex items-center justify-between gap-2 border-b border-sidebar-border p-6',
          mode.ownToggle && 'pl-16 lg:pl-6',
          rail && 'lg:flex-col lg:px-2 lg:py-4',
        )}>
          {/* Kivo's mark, and the companion this account works with under it */}
          <Link href="/home" onClick={close} title={rail ? `${isNova ? 'Nova' : 'Rex'} home` : undefined} className="flex min-w-0 items-center gap-3">
            <KivoTile size={36} className="shrink-0" />
            <span className={cn('flex min-w-0 flex-col gap-1.5', rail && 'lg:sr-only')}>
              <KivoWordmark height={17} className="text-sidebar-foreground" />
              <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium leading-none text-sidebar-foreground/60">
                <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', accent.dot)} />
                {isNova ? 'Nova · Learning mentor' : 'Rex · AI coach'}
              </span>
            </span>
          </Link>
          {mode.closeButton && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close navigation"
              className="rounded-lg p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <X aria-hidden className="w-5 h-5" />
            </button>
          )}
          {mode.collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-lg p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:inline-flex"
            >
              {collapsed ? <PanelLeftOpen aria-hidden className="w-5 h-5" /> : <PanelLeftClose aria-hidden className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Main" className={cn('flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5', rail && 'lg:space-y-2 lg:px-2')}>
          {groupsOf(items, isNova).map((group, g) => (
            <div key={group.label ?? 'more'} role="group" aria-label={group.label ?? 'More'}
              className={cn('space-y-0.5', rail && g > 0 && 'lg:border-t lg:border-sidebar-border lg:pt-2')}>
              {group.label && (
                <p aria-hidden className={cn('px-4 pb-1 text-[11px] font-semibold text-sidebar-foreground/50', rail && 'lg:hidden')}>{group.label}</p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    title={rail ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      row, 'relative',
                      active ? CURRENT : 'text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                  >
                    {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-action" />}
                    <Icon aria-hidden className="w-[18px] h-[18px] shrink-0" />
                    <span className={label}>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Settings */}
        <div className={cn('space-y-1 border-t border-sidebar-border p-4', rail && 'lg:px-2')}>
          <Link
            href="/settings"
            onClick={close}
            title={rail ? 'Settings' : undefined}
            aria-current={isActive('/settings') ? 'page' : undefined}
            className={cn(row, isActive('/settings') ? CURRENT : 'text-sidebar-foreground hover:bg-sidebar-accent')}
          >
            <Settings aria-hidden className="w-5 h-5 shrink-0" />
            <span className={label}>Settings</span>
          </Link>
          <Link
            href="/"
            title={rail ? 'Kivo home page' : undefined}
            className={cn(row, 'text-sidebar-foreground hover:bg-sidebar-accent')}
          >
            <Globe aria-hidden className="w-5 h-5 shrink-0" />
            <span className={label}>Kivo home page</span>
          </Link>
          {/* In the rail the three theme choices stand in a column */}
          <div className={cn(
            'flex items-center justify-between gap-3 px-4 py-2',
            rail && 'lg:flex-col lg:px-0 lg:[&_[role=radiogroup]]:flex-col',
          )}>
            <span className={cn('text-xs font-medium text-sidebar-foreground/55', rail && 'lg:sr-only')}>Theme</span>
            <ThemePicker compact />
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            title={rail ? 'Sign out' : undefined}
            className={cn(row, 'w-full text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-60')}
          >
            <LogOut aria-hidden className="w-5 h-5 shrink-0" />
            <span className={label}>{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </div>

      {/* Backdrop: under a small-screen drawer, or over the Creature world at
          every width. Clicking it closes what it sits under. */}
      <div
        aria-hidden
        onClick={dismiss}
        className={cn(
          'fixed inset-0 z-30 bg-black/50 transition-opacity duration-300',
          mode.backdrop === 'none' ? 'pointer-events-none opacity-0' : 'opacity-100',
          mode.backdrop === 'small_screens' && 'lg:hidden',
        )}
      />
    </>
  )
}

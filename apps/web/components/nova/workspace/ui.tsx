import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// The dashboard's few shared pieces of style. Written against the theme
// tokens (foreground, card, white/N), so they work in light and dark.
// Surfaces are used sparingly: most sections are a heading and a list,
// separated by space and hairlines, not boxes.

// A section's title: sentence case, with the section's icon.
export function SectionHeading({ id, icon: Icon, children, aside, className }: {
  id?: string; icon?: LucideIcon; children: ReactNode; aside?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1', className)}>
      <h2 id={id} className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground/90">
        {Icon && <Icon aria-hidden className="size-4 text-foreground/45" />}
        {children}
      </h2>
      {aside && <div className="flex items-center gap-3 text-xs text-foreground/60">{aside}</div>}
    </div>
  )
}

// A quiet text link beside a heading or under a list.
export const TEXT_LINK = 'inline-flex items-center gap-1 rounded text-xs font-medium text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// Buttons: one primary action per region, the rest quiet. The primary is
// Kivo's action colour: the landing page's teal (globals.css --action).
export const BUTTON_PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-action px-4 text-sm font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] transition-[background-color,transform] hover:bg-action-hover active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'
export const BUTTON_QUIET = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-foreground/75 transition-colors hover:border-white/25 hover:bg-white/4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50'

// A raised surface, for the one thing a region is about (the block to do
// now, a popover). Not for every group of content.
export const SURFACE = 'rounded-xl border border-white/8 bg-card/70'

// The one surface that floats above the page (the next action, the board's
// details): opaque, larger radius, a deep shadow. One per region.
export const SURFACE_RAISED = 'rounded-2xl border border-white/10 bg-card shadow-float'

// A list row that can be hovered and focused.
export const ROW = 'transition-colors hover:bg-white/3 focus-within:bg-white/3'

// Loading placeholders.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-white/5', className)} />
}

// A part of the page that did not load: says so, and offers to try again.
export function LoadFailed({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <p role="status" className={cn('text-sm text-foreground/60', className)}>
      {what} didn&apos;t load. Nothing is lost.{' '}
      <button type="button" onClick={onRetry} className="font-medium text-foreground/80 underline decoration-white/25 underline-offset-4 hover:text-foreground">Try again</button>
    </p>
  )
}

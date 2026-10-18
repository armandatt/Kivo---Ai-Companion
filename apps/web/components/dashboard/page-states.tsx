import type { ReactNode } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KivoMark } from '@/components/brand/kivo-brand'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'

// The states every dashboard page shares: its frame, its title, and what it
// shows while loading, when the server did not answer, when there is a reason
// it cannot show anything, and when there is nothing yet. Written against the
// theme tokens, so each works on ink and on paper.

const WIDTH = {
  narrow:  'max-w-3xl pt-10 lg:pt-4',
  default: 'max-w-6xl pt-10 lg:pt-4',
  wide:    'max-w-7xl pt-12 lg:pt-2',
} as const
export type PageWidth = keyof typeof WIDTH

export function PageFrame({ width = 'default', className, children }: { width?: PageWidth; className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full pb-20', WIDTH[width], className)}>{children}</div>
}

// A page's title: the editorial serif, with an optional line above and the
// page's own actions beside it.
export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <p className="mb-2 text-xs font-medium text-subtle">{eyebrow}</p>}
        <h1 className="font-display text-[2.25rem] leading-[1.05] tracking-[-0.01em] text-foreground sm:text-[2.6rem]">{title}</h1>
        {description && <p className="mt-2.5 text-[15px] leading-relaxed text-foreground/65">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

// Kivo's mark with its node breathing, and what is loading, in words.
export function LoadingMark({ label, className }: { label: string; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2.5 text-sm text-subtle', className)}>
      <KivoMark size={20} className="text-foreground/80" nodeClassName="kivo-node-pulse" />
      {label}…
    </p>
  )
}

// While a page loads: the mark and a sentence, over the page's own skeleton.
export function PageLoading({ label, width, children }: { label: string; width?: PageWidth; children?: ReactNode }) {
  return (
    <PageFrame width={width}>
      <div aria-busy="true" aria-label={label}>
        <LoadingMark label={label} className="mb-6" />
        {children ?? (
          <div aria-hidden className="space-y-3">
            <div className="h-24 animate-pulse rounded-2xl bg-white/4" />
            <div className="h-48 animate-pulse rounded-2xl bg-white/3" />
          </div>
        )}
      </div>
    </PageFrame>
  )
}

// A page that cannot show its content: the server did not answer (error, read
// out at once), or there is a reason to explain. One card, a serif title, and
// what to do next.
export function PageNotice({ eyebrow, title, children, action, tone = 'info', className }: {
  eyebrow?: ReactNode; title: ReactNode; children: ReactNode; action?: ReactNode; tone?: 'info' | 'error'; className?: string
}) {
  return (
    <section role={tone === 'error' ? 'alert' : undefined} className={cn('max-w-2xl rounded-2xl border border-white/8 bg-card p-6 shadow-soft sm:p-8', className)}>
      <KivoMark size={22} className="text-foreground/80" />
      {eyebrow && <p className="mt-5 text-xs font-medium text-subtle">{eyebrow}</p>}
      <h1 className={cn(eyebrow ? 'mt-2' : 'mt-5', 'font-display text-[1.85rem] leading-[1.1] text-foreground')}>{title}</h1>
      <div className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">{children}</div>
      {action && <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div>}
    </section>
  )
}

// Nothing here yet: what will appear, and the one way to start it.
export function EmptyState({ icon: Icon, title, children, action, className }: {
  icon?: LucideIcon; title: ReactNode; children: ReactNode; action?: ReactNode; className?: string
}) {
  return (
    <section className={cn('flex flex-col items-start rounded-2xl border border-dashed border-white/12 p-6 sm:p-8', className)}>
      {Icon && (
        <span aria-hidden className="mb-4 grid size-10 place-items-center rounded-xl bg-white/5 text-foreground/70">
          <Icon className="size-5" />
        </span>
      )}
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">{children}</div>
      {action && <div className="mt-5 flex flex-wrap items-center gap-3">{action}</div>}
    </section>
  )
}

// The one thing to do from a notice or an empty state.
export function PageAction({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className={BUTTON_PRIMARY}>{children}</Link>
}

// Asking the server again. Says so while it does.
export function RetryButton({ onRetry, busy }: { onRetry: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onRetry} disabled={busy} className={cn(BUTTON_QUIET, 'h-10 px-4 text-sm')}>
      {busy ? 'Trying…' : 'Try again'}
    </button>
  )
}

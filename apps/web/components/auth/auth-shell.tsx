import type { ReactNode } from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { KivoTile, KivoWordmark } from '@/components/brand/kivo-brand'

// Sign-in, sign-up and password recovery share one look: Kivo ink, the dot
// grid the knowledge canvas uses, the lockup above the card, and the landing page's
// teal for the one action that moves the person forward.

export const authInputClass =
  'h-11 rounded-lg border-ink-700 bg-ink-950 text-paper-50 placeholder:text-ink-300 focus-visible:border-keppel-400 focus-visible:ring-keppel-400/30'

export const authPrimaryButtonClass =
  'h-11 w-full rounded-lg bg-keppel-400 font-semibold text-keppel-950 transition-colors duration-200 hover:bg-keppel-300 disabled:opacity-60'

export const authLabelClass = 'mb-2 block text-sm font-medium text-ink-200'

export const authLinkClass = 'font-medium text-keppel-300 transition-colors hover:text-keppel-200'

/** The page and card every sign-in, sign-up and recovery step is shown in. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-ink-950 px-4 py-12 text-paper-50">
      <div aria-hidden className="kivo-dot-grid pointer-events-none absolute inset-0" />

      <div className="relative z-10 w-full max-w-md">
        <Link href="/" aria-label="Kivo home page" className="mb-8 inline-flex items-center gap-2.5 text-paper-100">
          <KivoTile size={32} />
          <KivoWordmark height={18} />
        </Link>

        <Card className="border-ink-700 bg-ink-900/95 text-paper-50 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)]">
          <div className="p-8 sm:p-9">
            <div className="mb-8">
              <h1 className="font-display text-[2.6rem] leading-[1.02] tracking-[-0.01em] text-paper-50">{title}</h1>
              {subtitle && <p className="mt-3 text-ink-300">{subtitle}</p>}
            </div>
            {children}
          </div>
        </Card>
      </div>
    </div>
  )
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-coral-500/35 bg-coral-500/10 px-3 py-2 text-sm text-coral-300">
      {children}
    </p>
  )
}

export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-lg border border-keppel-400/30 bg-keppel-400/10 px-3 py-2 text-sm text-keppel-200">
      {children}
    </p>
  )
}

/** The two ways in, shown before any form: email, or Google. */
export function AuthMethodChoice({ onEmail }: { onEmail: () => void }) {
  return (
    <div className="space-y-3">
      <Button type="button" onClick={onEmail} className={authPrimaryButtonClass}>
        <Mail className="w-5 h-5 mr-2" />
        Continue with email
      </Button>
      <GoogleButton />
    </div>
  )
}

export function GoogleButton() {
  return (
    <Button
      asChild
      variant="outline"
      className="h-11 w-full rounded-lg border-ink-700 bg-ink-900 text-paper-50 transition-colors duration-200 hover:bg-ink-800 hover:text-paper-50"
    >
      <a href="/api/auth/google">
        <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </a>
    </Button>
  )
}

export function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 block w-full text-center text-sm text-ink-300 transition-colors hover:text-paper-50"
    >
      {children}
    </button>
  )
}

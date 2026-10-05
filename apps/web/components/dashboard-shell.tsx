'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Menu } from 'lucide-react'
import { routeAccess, type Companion } from '@repo/api/nova/product/companion'
import { Sidebar } from '@/components/sidebar'
import { NovaUnavailable } from '@/components/nova/nova-unavailable'

type Props = {
  children:  React.ReactNode
  // Which companion this account uses, resolved on the server. null when the
  // server could not tell (database unreachable): the shell then asks the API
  // and shows no companion-specific page until it has an answer.
  companion: Companion | null
}

function useCompanion(fromServer: Companion | null) {
  const [companion, setCompanion] = useState<Companion | null>(fromServer)
  const [failed, setFailed]       = useState(false)

  const ask = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/nova/companion', { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/signin'; return }
      const data = await res.json() as { companion?: Companion }
      if (data.companion === 'nova' || data.companion === 'rex') setCompanion(data.companion)
      else setFailed(true)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => { if (fromServer === null) void ask() }, [fromServer, ask])

  return { companion, failed, retry: ask }
}

export function DashboardShell({ children, companion: fromServer }: Props) {
  const pathname    = usePathname()
  const router      = useRouter()
  const isCreature  = pathname === '/creature'
  const [sidebarOpen, setSidebarOpen] = useState(!isCreature)
  const { companion, failed, retry } = useCompanion(fromServer)

  // Each companion sees its own pages only. Decided before anything renders,
  // so a Rex page never mounts (or fetches) for a Nova learner.
  const access = companion ? routeAccess(companion, pathname) : null

  // Auto-collapse when entering creature page, restore when leaving
  useEffect(() => {
    setSidebarOpen(!isCreature)
  }, [isCreature])

  useEffect(() => {
    if (access === 'not_for_rex') router.replace('/home')
  }, [access, router])

  if (companion === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6" aria-busy={!failed}>
        {failed ? (
          <div role="alert" className="max-w-sm text-center">
            <p className="text-base font-medium text-foreground">Couldn&apos;t load your account</p>
            <p className="mt-2 text-sm text-foreground/60">The server didn&apos;t answer. Nothing is lost.</p>
            <button
              type="button"
              onClick={() => void retry()}
              className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-white/12 px-5 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="h-8 w-40 animate-pulse rounded-lg bg-white/5" aria-label="Loading" />
        )}
      </div>
    )
  }

  if (isCreature && access === 'render') {
    return (
      <div className="flex h-screen overflow-hidden bg-black">
        {/* Sidebar in overlay mode — always fixed, never pushes the world */}
        <Sidebar open={sidebarOpen} onOpenChange={setSidebarOpen} companion={companion} overlay />

        {/* Full-bleed world — no padding, no overflow */}
        <main className="w-full h-screen overflow-hidden">
          {children}
        </main>

        {/* Floating three-line button — visible only when sidebar is closed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 hover:bg-black/60 transition-all"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5 text-white/70" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar open={access === 'render' ? sidebarOpen : true} onOpenChange={setSidebarOpen} companion={companion} />
      <main className="flex-1 overflow-auto">
        <div className="relative h-full p-6">
          {access === 'render' ? children
            : access === 'nova_unavailable' ? <NovaUnavailable pathname={pathname} />
            : null /* a Rex account on a Nova-only page: being sent to Home */}
        </div>
      </main>
    </div>
  )
}

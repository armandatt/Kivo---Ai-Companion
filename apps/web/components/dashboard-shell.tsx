'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Sidebar } from '@/components/sidebar'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname    = usePathname()
  const isCreature  = pathname === '/creature'
  const [sidebarOpen, setSidebarOpen] = useState(!isCreature)

  // Auto-collapse when entering creature page, restore when leaving
  useEffect(() => {
    setSidebarOpen(!isCreature)
  }, [isCreature])

  if (isCreature) {
    return (
      <div className="flex h-screen overflow-hidden bg-black">
        {/* Sidebar in overlay mode — always fixed, never pushes the world */}
        <Sidebar open={sidebarOpen} onOpenChange={setSidebarOpen} overlay />

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
      <Sidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
      <main className="flex-1 overflow-auto">
        <div className="relative h-full p-6">
          {children}
        </div>
      </main>
    </div>
  )
}

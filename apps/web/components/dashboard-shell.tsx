'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/sidebar'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

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

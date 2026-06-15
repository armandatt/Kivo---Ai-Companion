'use client'

import { Bell } from 'lucide-react'
import { Card } from '@/components/ui/card'

export function CustomReminders() {
  return (
    <Card className="border-white/5 bg-white/2 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-white/20" />
        <p className="text-[11px] font-semibold text-white/20 uppercase tracking-wider">Reminders</p>
      </div>
      <p className="text-sm text-white/20 text-center py-4">Coming soon</p>
    </Card>
  )
}

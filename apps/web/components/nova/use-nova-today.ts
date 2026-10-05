'use client'

import type { NovaTodayView } from '@repo/api/nova/product/today.types'
import { useNovaView } from './use-nova-view'

// GET /api/nova/today
export function useNovaToday(availableMinutes: number | null) {
  return useNovaView<NovaTodayView>(`/api/nova/today${availableMinutes ? `?minutes=${availableMinutes}` : ''}`)
}

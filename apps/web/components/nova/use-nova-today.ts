'use client'

import type { NovaTodayView } from '@repo/api/nova/product/today.types'
import { useNovaView } from './use-nova-view'
import { planQuery } from './today-focus'

// GET /api/nova/today, for the time available and the subject chosen today.
export function useNovaToday(availableMinutes: number | null, subject: string | null = null) {
  return useNovaView<NovaTodayView>(`/api/nova/today${planQuery(availableMinutes, subject)}`)
}

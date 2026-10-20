'use client'

import type { NovaPlannerView } from '@repo/api/nova/product/planner.types'
import { useNovaView } from './use-nova-view'
import { planQuery } from './today-focus'

// GET /api/nova/planner. Changing the time available, or the subject chosen
// for today on Today, asks Nova for a new plan; nothing is refitted in the
// browser.
export function useNovaPlanner(availableMinutes: number | null, subject: string | null = null) {
  return useNovaView<NovaPlannerView>(`/api/nova/planner${planQuery(availableMinutes, subject)}`)
}

'use client'

import type { NovaPlannerView } from '@repo/api/nova/product/planner.types'
import { useNovaView } from './use-nova-view'

// GET /api/nova/planner. Changing the time available asks Nova for a new
// plan; nothing is refitted in the browser.
export function useNovaPlanner(availableMinutes: number | null) {
  return useNovaView<NovaPlannerView>(`/api/nova/planner${availableMinutes ? `?minutes=${availableMinutes}` : ''}`)
}

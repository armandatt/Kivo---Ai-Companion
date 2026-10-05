'use client'

import type { NovaProgressView } from '@repo/api/nova/product/progress.types'
import { useNovaView } from './use-nova-view'

// GET /api/nova/progress. Read-only: every number and sentence on the page
// comes from this response.
export function useNovaProgress() {
  return useNovaView<NovaProgressView>('/api/nova/progress')
}

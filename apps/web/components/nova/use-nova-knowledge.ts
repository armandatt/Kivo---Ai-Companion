'use client'

import type { NovaKnowledgeView } from '@repo/api/nova/product/knowledge.types'
import { useNovaView } from './use-nova-view'

// GET /api/nova/knowledge. Read-only: the page changes nothing here. A topic
// changes when a session on it ends, and the next load shows it.
export function useNovaKnowledge() {
  return useNovaView<NovaKnowledgeView>('/api/nova/knowledge')
}

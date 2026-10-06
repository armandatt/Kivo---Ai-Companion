'use client'

import { useEffect, useRef } from 'react'
import type { NovaLearningDnaView } from '@repo/api/nova/product/learning-dna.types'
import { useNovaView } from './use-nova-view'

// GET /api/nova/learning-dna. Read-only: every belief on the page is the
// server's. The one thing this device contributes is its timezone, and only
// while Nova has none: without it Nova makes no claim about time of day.
export function useNovaLearningDna() {
  const state = useNovaView<NovaLearningDnaView>('/api/nova/learning-dna')
  const reported = useRef(false)
  const { view, refresh } = state

  useEffect(() => {
    if (reported.current || view?.status !== 'ready' || view.timezone !== null) return
    reported.current = true
    let timezone: string
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return }
    if (!timezone) return
    void fetch('/api/nova/timezone', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone }),
    }).then(res => { if (res.ok) void refresh() }).catch(() => {})
  }, [view, refresh])

  return state
}

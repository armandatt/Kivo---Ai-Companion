'use client'

// The plan Nova prepared for today (bug batch 28 Nov, item 12), at the
// learner's check-in time or quietly when Today opens after it. Never their
// plan until they say so: Propose a plan opens it at once in the studio as
// Nova's proposal (keep or skip items, Apply, or change it in words with
// Nova); the Propose button says when it is ready.

import { useEffect, useState } from 'react'
import type { PendingChange } from '@repo/api/nova/product/day-flow.types'

export interface PreparedPlan { day: string; reply: string; preparedAt: string; trigger: 'check_in' | 'first_open'; pending: PendingChange }

// Read once per visit, once the flow has loaded (preparing it may take a model call).
export function usePreparedPlan(ready: boolean) {
  const [plan, setPlan] = useState<PreparedPlan | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!ready) return
    let live = true
    void fetch('/api/nova/day/prepared', { cache: 'no-store' }).then(r => r.json()).then((b: { ok?: boolean; prepared?: PreparedPlan | null }) => { if (live) setPlan(b.ok ? b.prepared ?? null : null) })
      .catch(() => { if (live) setPlan(null) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [ready])
  // Propose a plan with nothing prepared yet: prepare it now.
  const prepareNow = async (): Promise<PreparedPlan | null> => {
    try {
      const b = await (await fetch('/api/nova/day/prepared?now=1', { cache: 'no-store' })).json() as { ok?: boolean; prepared?: PreparedPlan | null }
      const got = b.ok ? b.prepared ?? null : null
      setPlan(got); return got
    } catch { return null }
  }
  const close = async (status: 'taken' | 'dismissed') => {
    const day = plan?.day
    setPlan(null)
    if (day) await fetch('/api/nova/day/prepared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, status }) }).catch(() => {})
  }
  return { plan, loading, close, prepareNow }
}

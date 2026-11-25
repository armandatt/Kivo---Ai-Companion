'use client'

// What needs time, what was missed, and when each task could go
// (POST /api/nova/calendar/plan, product/calendar-planner.ts). Reads only:
// a proposal becomes a block when the page creates the event. The learner's
// working hours and daily focus are kept in this browser (they shape
// proposals only; nothing is stored for them on the server yet).

import { useCallback, useEffect, useState } from 'react'
import type { CalendarPlanView, DayLoad, MissedBlock, PlanTaskView, ProposalView } from '@repo/api/nova/product/calendar-plan.types'

export type { DayLoad, MissedBlock, PlanTaskView, ProposalView }
export interface PlanPrefs { dayStart: number; dayEnd: number; focusPerDay: number }
export const DEFAULT_PREFS: PlanPrefs = { dayStart: 9 * 60, dayEnd: 21 * 60, focusPerDay: 4 * 60 }
const KEY = 'kivo-calendar-plan-prefs'

export function readPrefs(): PlanPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<PlanPrefs> | null
    if (!v) return DEFAULT_PREFS
    const ok = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi
    const p = { dayStart: ok(v.dayStart, 0, 22 * 60) ? v.dayStart! : DEFAULT_PREFS.dayStart, dayEnd: ok(v.dayEnd, 60, 24 * 60) ? v.dayEnd! : DEFAULT_PREFS.dayEnd, focusPerDay: ok(v.focusPerDay, 30, 720) ? v.focusPerDay! : DEFAULT_PREFS.focusPerDay }
    return p.dayEnd > p.dayStart ? p : DEFAULT_PREFS
  } catch { return DEFAULT_PREFS }
}

export function useCalendarPlan(version: unknown) {
  const [prefs, setPrefsState] = useState<PlanPrefs>(DEFAULT_PREFS)
  const [plan, setPlan] = useState<CalendarPlanView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => { setPrefsState(readPrefs()) }, [])

  const load = useCallback(async (taskIds?: string[], p: PlanPrefs = prefs) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/nova/calendar/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ ...(taskIds ? { taskIds } : {}), settings: p }) })
      const body = await res.json() as CalendarPlanView | { ok: false; message: string }
      if (body.ok) setPlan(body); else setError(body.message)
      return body.ok ? body : null
    } catch { setError('Kivo couldn’t be reached. Check your connection and try again.'); return null }
    finally { setLoading(false) }
  }, [prefs])

  // Read again whenever the calendar changes (a block added, a task done).
  useEffect(() => { void load() }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPrefs = (p: PlanPrefs) => { setPrefsState(p); try { window.localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } ; void load(undefined, p) }
  return { plan, workload: plan?.workload ?? [], error, loading, prefs, setPrefs, load }
}
export type CalendarPlanState = ReturnType<typeof useCalendarPlan>

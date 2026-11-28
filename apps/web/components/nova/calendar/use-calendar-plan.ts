'use client'

// Plan your time (calendar-planner.ts, plan-runs.ts). What needs time, what
// was missed, Kivo's proposal; nothing is written until the learner applies
// a proposal, and every apply is a run that can be undone. Settings are the
// learner's own, stored on the server.

import { useCallback, useEffect, useState } from 'react'
import type { CalendarPlanView, DayLoad, MissedBlock, PlanTaskView, ProposalView } from '@repo/api/nova/product/calendar-plan.types'

export type { DayLoad, MissedBlock, PlanTaskView, ProposalView }
export interface PlanPrefs { dayStart: number; dayEnd: number; focusPerDay: number; bufferMinutes: number; avoidDays: number[] }
export const DEFAULT_PREFS: PlanPrefs = { dayStart: 9 * 60, dayEnd: 21 * 60, focusPerDay: 4 * 60, bufferMinutes: 10, avoidDays: [] }
export interface PlanRun { id: string; createdAt: string; scope: string; placed: number; remaining: number; undoneAt: string | null }
// A proposal on screen: the blocks it would add (ghosts on the calendar) and what didn't fit.
export interface Draft { scope: 'all' | 'one'; placed: ProposalView[]; unplaced: ProposalView[] }
export type Removal = { ok: true; already?: boolean; removed: string[]; kept: number; started: number } | { ok: false; message: string }

async function post(path: string, body: unknown): Promise<Record<string, unknown> & { ok: boolean; message?: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body) })
    return await res.json() as Record<string, unknown> & { ok: boolean }
  } catch { return { ok: false, message: 'Kivo couldn’t be reached. Check your connection and try again.' } }
}

export function useCalendarPlan(version: unknown) {
  const [prefs, setPrefsState] = useState<PlanPrefs>(DEFAULT_PREFS)
  const [runs, setRuns] = useState<PlanRun[]>([])
  const [plan, setPlan] = useState<CalendarPlanView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/nova/calendar/plan/runs', { cache: 'no-store' })
      const body = await res.json() as { ok: boolean; settings?: PlanPrefs; runs?: PlanRun[] }
      if (body.ok) { if (body.settings) setPrefsState({ ...DEFAULT_PREFS, ...body.settings }); setRuns(body.runs ?? []) }
    } catch { /* the panel still works with what it has */ }
  }, [])

  const load = useCallback(async (taskIds?: string[]) => {
    setLoading(true); setError(null)
    const body = await post('/api/nova/calendar/plan', taskIds ? { taskIds } : {}) as unknown as CalendarPlanView | { ok: false; message: string }
    setLoading(false)
    if (body.ok) setPlan(body); else setError(body.message)
    return body.ok ? body : null
  }, [])

  // Read again whenever the calendar changes (a block added, a task done).
  useEffect(() => { void load(); void loadRuns() }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  // A proposal for all of Needs time, or one task: drawn, nothing written.
  const propose = async (taskIds: string[] | null) => {
    const p = await load(taskIds ?? undefined)
    if (!p) return
    const mine = taskIds ? p.proposals.filter(x => taskIds.includes(x.taskId)) : p.proposals
    setDraft({ scope: taskIds && taskIds.length === 1 ? 'one' : 'all', placed: mine.filter(x => x.day && x.startAt), unplaced: mine.filter(x => !x.day) })
  }
  const dropFromDraft = (taskId: string) => setDraft(d => (d ? { ...d, placed: d.placed.filter(x => x.taskId !== taskId) } : d))
  const cancel = () => setDraft(null)

  const apply = async (): Promise<{ ok: true; runId: string; placed: number; days: number; skipped: Array<{ taskId: string; reason: string }> } | { ok: false; message: string }> => {
    if (!draft || draft.placed.length === 0) return { ok: false, message: 'Nothing to apply.' }
    const r = await post('/api/nova/calendar/plan/runs', {
      action: 'apply', scope: draft.scope,
      blocks: draft.placed.map(x => ({ taskId: x.taskId, startAt: x.startAt, endAt: x.endAt })),
      unplaced: draft.unplaced.map(x => ({ taskId: x.taskId, title: x.title, reason: x.reason })),
    })
    if (!r.ok) return { ok: false, message: r.message ?? 'That didn’t apply.' }
    setDraft(null); void loadRuns()
    return r as unknown as { ok: true; runId: string; placed: number; days: number; skipped: Array<{ taskId: string; reason: string }> }
  }

  const removal = async (body: unknown): Promise<Removal> => {
    const r = await post('/api/nova/calendar/plan/runs', body)
    void loadRuns()
    return r.ok ? r as unknown as Removal : { ok: false, message: r.message ?? 'That didn’t work.' }
  }
  const undo = (runId: string) => removal({ action: 'undo', runId })
  const clear = (range: 'week' | 'ahead', preview: boolean) => removal({ action: 'clear', range, preview })
  const unschedule = (eventId: string) => removal({ action: 'unschedule', eventId })

  const setPrefs = async (p: PlanPrefs) => {
    setPrefsState(p)
    await post('/api/nova/calendar/plan/runs', { action: 'settings', settings: p })
    setDraft(null); void load()
  }
  return { plan, workload: plan?.workload ?? [], error, loading, prefs, setPrefs, load, runs, draft, propose, dropFromDraft, cancel, apply, undo, clear, unschedule, loadRuns }
}
export type CalendarPlanState = ReturnType<typeof useCalendarPlan>

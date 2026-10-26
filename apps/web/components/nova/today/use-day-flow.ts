'use client'

// Today's flow as the server has it. Every change is sent with the version
// the page last read, one at a time; what the page shows is what the server
// answered, never a change it only assumed. A change refused as stale (made
// elsewhere a moment ago) shows the flow as it now stands.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayFlowResponse, FlowOp, NovaDayView } from '@repo/api/nova/product/day-flow.types'
import { fetchDay, sendDay } from './day-api'

export type FlowNotice = { text: string; tone: 'done' | 'error' | 'info'; undo: boolean; at: number }

export function useDayFlow() {
  const [flow, setFlowState] = useState<NovaDayView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<FlowNotice | null>(null)
  const [touched, setTouched] = useState<string[]>([])
  const flowRef = useRef<NovaDayView | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const setFlow = useCallback((f: NovaDayView) => { flowRef.current = f; setFlowState(f) }, [])

  const load = useCallback(async () => {
    const res = await fetchDay()
    if (res && 'status' in res && res.status === 'ready') { setFlow(res); setLoadError(null) }
    else setLoadError('message' in res && res.message ? res.message : 'Today’s flow didn’t load.')
  }, [setFlow])
  useEffect(() => { void load() }, [load])

  // One change at a time, each against the version the last answer gave.
  const act = useCallback((body: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<DayFlowResponse & { started?: boolean }> => {
    const run = queue.current.then(async () => {
      setBusy(true)
      const res = await sendDay({ ...body, version: flowRef.current?.version ?? 0 }) as DayFlowResponse & { started?: boolean; touched?: string[] }
      setBusy(false)
      if (res.ok) {
        setFlow(res.flow)
        if (res.message && !opts.quiet) setNotice({ text: res.message, tone: 'done', undo: res.flow.canUndo && body.action !== 'undo', at: Date.now() })
        setTouched(res.touched ?? [])
      } else {
        if (res.flow) setFlow(res.flow)
        setNotice({ text: res.message, tone: 'error', undo: false, at: Date.now() })
      }
      return res
    })
    queue.current = run.catch(() => {})
    return run
  }, [setFlow])

  const ops = useCallback((list: FlowOp[], opts?: { quiet?: boolean }) => act({ action: 'ops', ops: list }, opts), [act])
  const undo = useCallback(() => act({ action: 'undo' }), [act])
  // From the copilot: its answer already holds the flow as written.
  const adopt = useCallback((f: NovaDayView, changed: string[], ids: string[]) => {
    setFlow(f); setTouched(ids)
    if (changed.length) setNotice({ text: changed.join(' '), tone: 'done', undo: f.canUndo, at: Date.now() })
  }, [setFlow])

  useEffect(() => { if (!touched.length) return; const t = window.setTimeout(() => setTouched([]), 2800); return () => window.clearTimeout(t) }, [touched])
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), notice.undo ? 12_000 : 6_000); return () => window.clearTimeout(t) }, [notice])

  return { flow, loadError, busy, notice, setNotice, touched, load, act, ops, undo, adopt }
}

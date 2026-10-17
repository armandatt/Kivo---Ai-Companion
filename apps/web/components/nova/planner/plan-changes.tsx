'use client'

// The learner's changes to today's plan: skip a block, bring it back, add a
// topic, put the blocks in their own order. Each is one request to
// POST /api/nova/planner/today; the server decides the day and checks the
// topic is theirs (product/plan-overrides.ts), and the plan is read again
// afterwards, so what is shown is always what the engine now plans.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, RotateCcw } from 'lucide-react'
import type { PlanOverrideResponse } from '@repo/api/nova/product/plan-overrides.types'
import type { TodayPlanChangesView } from '@repo/api/nova/product/today.types'
import type { NovaKnowledgeView } from '@repo/api/nova/product/knowledge.types'

export type PlanChange =
  | { action: 'skip' | 'pin'; topicId: string }
  | { action: 'clear'; kind: 'skip' | 'pin'; topicId: string }
  | { action: 'order'; topicIds: string[] }
  | { action: 'clear_order' }

// Sends one change, then lets the page read the plan again.
export function usePlanChange(onChanged: () => void) {
  const [busy, setBusy]   = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const change = useCallback(async (body: PlanChange, key: string): Promise<boolean> => {
    setBusy(key); setError(null)
    let result: PlanOverrideResponse
    try {
      const res = await fetch('/api/nova/planner/today', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/signin'; return false }
      result = await res.json() as PlanOverrideResponse
    } catch {
      result = { ok: false, error: 'failed', message: "Couldn't reach the server. Today's plan wasn't changed." }
    }
    setBusy(null)
    if (!result.ok) { setError(result.message); return false }
    onChanged()
    return true
  }, [onChanged])
  return { change, busy, error }
}

const SMALL = 'inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs text-foreground/70 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40'

// What the learner changed about today, each with its way back.
export function ChangedToday({ changes, change, busy }: {
  changes: TodayPlanChangesView | undefined
  change:  ReturnType<typeof usePlanChange>['change']
  busy:    string | null
}) {
  if (!changes || (changes.skipped.length === 0 && changes.added.length === 0 && !changes.ordered)) return null
  return (
    <section aria-labelledby="changed-today" className="rounded-2xl border border-white/8 bg-card/50 p-4" data-changed-today>
      <h3 id="changed-today" className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">You changed today</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {changes.skipped.map(s => (
          <li key={`s:${s.topicId}`} className="flex flex-wrap items-center justify-between gap-2" data-skipped={s.topicName}>
            <span className="text-foreground/75">Skipped: {s.topicName}</span>
            <button type="button" className={SMALL} disabled={busy !== null} onClick={() => void change({ action: 'clear', kind: 'skip', topicId: s.topicId }, `back:${s.topicId}`)}>
              <RotateCcw className="size-3.5" /> Bring back
            </button>
          </li>
        ))}
        {changes.added.map(a => (
          <li key={`a:${a.topicId}`} className="flex flex-wrap items-center justify-between gap-2" data-added={a.topicName}>
            <span className="text-foreground/75">Added: {a.topicName}</span>
            <button type="button" className={SMALL} disabled={busy !== null} onClick={() => void change({ action: 'clear', kind: 'pin', topicId: a.topicId }, `unpin:${a.topicId}`)}>
              <RotateCcw className="size-3.5" /> Take out
            </button>
          </li>
        ))}
        {changes.ordered && (
          <li className="flex flex-wrap items-center justify-between gap-2" data-ordered>
            <span className="text-foreground/75">The blocks are in your order.</span>
            <button type="button" className={SMALL} disabled={busy !== null} onClick={() => void change({ action: 'clear_order' }, 'clear-order')}>
              <RotateCcw className="size-3.5" /> Use Nova&apos;s order
            </button>
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-foreground/40">For today only. Nothing about your topics or history changes.</p>
    </section>
  )
}

// Add any of the learner's topics to today. It goes first, inside the day's
// time; if it does not fit, the plan says so.
export function AddToToday({ change, busy, planned }: {
  change:  ReturnType<typeof usePlanChange>['change']
  busy:    string | null
  planned: string[]                  // topic ids already on today's plan
}) {
  const [open, setOpen] = useState(false)
  const [topics, setTopics] = useState<Array<{ id: string; label: string }> | null>(null)
  const [chosen, setChosen] = useState('')
  useEffect(() => {
    if (!open || topics !== null) return
    fetch('/api/nova/knowledge', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() as Promise<NovaKnowledgeView> : null))
      .then(v => setTopics(v?.status === 'ready' ? v.subjects.flatMap(s => s.topics.map(t => ({ id: t.id, label: `${t.topicName} (${s.subjectName})` }))) : []))
      .catch(() => setTopics([]))
  }, [open, topics])

  if (!open) {
    return <button type="button" className={SMALL} onClick={() => setOpen(true)} data-add-to-today><Plus className="size-3.5" /> Add a topic to today</button>
  }
  const choices = (topics ?? []).filter(t => !planned.includes(t.id))
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async e => { e.preventDefault(); if (chosen && await change({ action: 'pin', topicId: chosen }, 'pin')) { setChosen(''); setOpen(false) } }}>
      <label className="sr-only" htmlFor="add-to-today">Topic to add to today</label>
      <select id="add-to-today" value={chosen} onChange={e => setChosen(e.target.value)} disabled={topics === null}
        className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-background px-2.5 text-sm text-foreground">
        <option value="">{topics === null ? 'Loading your topics…' : choices.length ? 'Choose a topic' : 'Everything is already on today'}</option>
        {choices.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <button type="submit" disabled={!chosen || busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-keppel-400 px-3.5 text-sm font-semibold text-keppel-950 hover:bg-keppel-300 disabled:opacity-50">
        {busy === 'pin' ? <Loader2 className="size-3.5 animate-spin" /> : null} Add
      </button>
      <button type="button" className={SMALL} onClick={() => setOpen(false)}>Cancel</button>
    </form>
  )
}

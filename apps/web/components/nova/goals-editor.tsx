'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Target, X } from 'lucide-react'
import { GOALS_MAX, GOAL_TEXT_MAX, type GoalsResponse, type NovaGoalsView } from '@repo/api/nova/product/goals.types'

// What the learner says they are working toward: up to three lines of their
// own. The page collects and shows; the server validates and saves
// (PUT /api/nova/goals). Nothing counts as saved until the server says so,
// and saving an empty list is how goals are cleared.

const FIELD = 'h-11 w-full rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none'
const tidy  = (rows: string[]) => rows.map(r => r.trim()).filter(Boolean)
const same  = (a: string[], b: string[]) => a.length === b.length && a.every((g, i) => g === b[i])

export function GoalsEditor() {
  // null: not loaded yet. What the server last confirmed.
  const [stored, setStored] = useState<string[] | null>(null)
  const [state, setState]   = useState<'loading' | 'ready' | 'failed' | 'unavailable'>('loading')
  const [rows, setRows]     = useState<string[]>([''])
  const [saving, setSaving] = useState(false)
  const [note, setNote]     = useState<{ ok: boolean; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/nova/goals', { cache: 'no-store' })
      .then(async r => {
        if (r.status === 401) { window.location.href = '/signin'; return null }
        if (!r.ok) throw new Error(String(r.status))
        return await r.json() as NovaGoalsView
      })
      .then(view => {
        if (!live || !view) return
        if (view.status !== 'ready') { setState('unavailable'); return }
        setStored(view.goals)
        setRows(view.goals.length > 0 ? view.goals : [''])
        setState('ready')
      })
      .catch(() => { if (live) setState('failed') })
    return () => { live = false }
  }, [])

  const save = async (goals: string[]) => {
    setSaving(true)
    setNote(null)
    try {
      const res  = await fetch('/api/nova/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals }) })
      const data = await res.json().catch(() => null) as GoalsResponse | null
      if (res.ok && data?.ok) {
        setStored(data.goals)
        setRows(data.goals.length > 0 ? data.goals : [''])
        setNote({ ok: true, text: data.goals.length > 0 ? 'Saved.' : 'Cleared. Nova has no goal on record for you now.' })
      } else {
        setNote({ ok: false, text: data && !data.ok ? data.message : "That didn't go through. Nothing was changed; try again." })
      }
    } catch {
      setNote({ ok: false, text: 'Network error. Nothing was changed; check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  if (state === 'unavailable') return null
  if (state === 'failed') {
    return (
      <section role="alert" id="goals" className="rounded-3xl border border-white/8 bg-card/70 p-6">
        <p className="text-sm text-foreground/65">Couldn&apos;t load your goals. Reload the page to try again.</p>
      </section>
    )
  }
  if (state === 'loading' || stored === null) {
    return <div id="goals" aria-busy="true" aria-label="Loading your goals" className="h-44 animate-pulse rounded-3xl border border-white/5 bg-white/3" />
  }

  const draft   = tidy(rows)
  const changed = !same(draft, stored)
  const setRow  = (i: number, value: string) => { setNote(null); setRows(r => r.map((x, k) => (k === i ? value : x))) }
  const remove  = (i: number) => { setNote(null); setRows(r => (r.length > 1 ? r.filter((_, k) => k !== i) : [''])) }

  return (
    <section id="goals" aria-labelledby="goals-heading" className="scroll-mt-24 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-section="goals-editor">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/4">
          <Target className="size-5 text-keppel-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="goals-heading" className="text-lg font-semibold tracking-tight text-foreground">What you&apos;re working toward</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
            In your own words, up to {GOALS_MAX}. Nova shows these on Today, the Planner and Progress and keeps them in mind when you talk. It doesn&apos;t track how far along they are, and they don&apos;t change your plan.
          </p>

          <form className="mt-5" onSubmit={e => { e.preventDefault(); if (changed && !saving) void save(draft) }}>
            <ul className="space-y-2">
              {rows.map((row, i) => (
                <li key={i} className="flex gap-2">
                  <label htmlFor={`goal-${i}`} className="sr-only">Goal {i + 1}</label>
                  <input
                    id={`goal-${i}`} value={row} maxLength={GOAL_TEXT_MAX} disabled={saving}
                    onChange={e => setRow(i, e.target.value)}
                    placeholder={i === 0 ? 'e.g. Pass my Operating Systems exam, or ship my portfolio project' : 'Another goal'}
                    className={FIELD}
                  />
                  <button type="button" onClick={() => remove(i)} disabled={saving || (rows.length === 1 && !row)} aria-label={`Remove goal ${i + 1}`}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-30">
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>

            {rows.length < GOALS_MAX && (
              <button type="button" onClick={() => setRows(r => [...r, ''])} disabled={saving}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-40">
                <Plus className="size-4" /> Add a goal
              </button>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving || !changed}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50">
                {saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Save goals'}
              </button>
              {stored.length > 0 && (confirming ? (
                <span className="flex items-center gap-3 text-sm">
                  <span className="text-foreground/65">Clear every goal?</span>
                  <button type="button" disabled={saving} onClick={() => { setConfirming(false); void save([]) }} className="font-medium text-red-300 hover:text-red-200 disabled:opacity-50" data-clear-goals>Clear</button>
                  <button type="button" disabled={saving} onClick={() => setConfirming(false)} className="text-foreground/55 hover:text-foreground">Keep</button>
                </span>
              ) : (
                <button type="button" disabled={saving} onClick={() => { setNote(null); setConfirming(true) }}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-4 text-sm text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-50">
                  Clear all
                </button>
              ))}
              {note && (
                <p role={note.ok ? 'status' : 'alert'} className={`flex items-center gap-1.5 text-sm ${note.ok ? 'text-foreground/75' : 'text-red-300'}`}>
                  {note.ok && <Check className="size-4 text-keppel-300" />}{note.text}
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

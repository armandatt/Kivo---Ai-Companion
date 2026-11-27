'use client'

// The plan Nova prepared for today (bug batch 28 Nov, item 12), at the
// learner's check-in time or on their first visit after it. A suggestion,
// never their plan until they say so:
//   - each item can be kept or skipped with a tap, with the total against
//     today's time;
//   - Start my day with this applies only what they kept (the same approve
//     every proposal goes through);
//   - Tweak with Nova opens it in Nova's panel as the open proposal, to change
//     in words;
//   - Not today sets it aside (Plan with Nova / Propose a plan stay).
// When they already have a plan, it folds into one line they can open.

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react'
import type { NovaDayView, PendingChange } from '@repo/api/nova/product/day-flow.types'
import { cn } from '@/lib/utils'

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
  const close = async (status: 'taken' | 'dismissed') => {
    const day = plan?.day
    setPlan(null)
    if (day) await fetch('/api/nova/day/prepared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, status }) }).catch(() => {})
  }
  return { plan, loading, close }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function PreparedPlanCard({ plan, flow, onTake, onTweak, onDismiss }: {
  plan: PreparedPlan; flow: NovaDayView
  onTake: (pending: PendingChange, keep: number[] | null) => Promise<{ ok: boolean; message?: string }>
  onTweak: (plan: PreparedPlan) => void
  onDismiss: () => void
}) {
  const added = useMemo(() => plan.pending.items.filter(i => i.change === 'added'), [plan])
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasOwn = flow.saved && flow.items.some(i => i.status === 'planned' || i.status === 'active')
  const [open, setOpen] = useState(!hasOwn)
  const kept = added.filter((_, i) => !skip.has(i))
  const minutes = kept.reduce((s, i) => s + (i.minutes ?? 0), 0)
  const budget = plan.pending.budgetMinutes
  const toggle = (i: number) => setSkip(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })
  const take = async () => {
    setBusy(true); setError(null)
    const keep = skip.size ? added.map((_, i) => i).filter(i => !skip.has(i)) : null
    const r = await onTake(plan.pending, keep)
    setBusy(false)
    if (!r.ok) setError(r.message ?? 'That didn’t apply. Your day is as it was.')
  }
  const when = plan.trigger === 'check_in' ? `Ready since ${time(plan.preparedAt)}, your check-in` : `Prepared at ${time(plan.preparedAt)}`

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mb-4 flex w-full items-center gap-2 rounded-2xl border border-nova/25 bg-nova/[0.05] px-4 py-2.5 text-left text-sm text-foreground/80 hover:bg-nova/10" data-prepared-folded>
        <Sparkles aria-hidden className="size-4 text-nova-ink" /> Nova also prepared a plan today ({added.length} item{added.length === 1 ? '' : 's'}) <span className="ml-auto inline-flex items-center gap-1 text-xs text-foreground/55">Compare <ChevronDown aria-hidden className="size-3.5" /></span>
      </button>
    )
  }

  return (
    <section aria-labelledby="prepared-title" className="nova-rise mb-5 overflow-hidden rounded-[1.5rem] border border-nova/30 bg-gradient-to-br from-nova/[0.08] via-card/60 to-card/40" data-prepared-plan>
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-nova/15 text-nova-ink"><Sparkles aria-hidden className="size-4.5" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="prepared-title" className="text-base font-semibold text-foreground">Nova prepared your day</h2>
          <p className="text-xs text-foreground/55">{when} · from your deadlines, reviews, map and goals. Yours to take, change or skip.</p>
        </div>
        <button type="button" onClick={() => (hasOwn ? setOpen(false) : onDismiss())} aria-label={hasOwn ? 'Fold' : 'Not today'} className="rounded-lg p-1.5 text-foreground/45 hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
      </div>
      {plan.reply && <p className="mx-5 mt-3 border-l-2 border-nova/40 pl-3 text-sm leading-relaxed text-foreground/80" data-prepared-why>{plan.reply}</p>}
      <ol className="mt-4 space-y-1.5 px-5" aria-label="The plan, tap an item to keep or skip it">
        {added.map((it, i) => {
          const off = skip.has(i)
          return (
            <li key={it.id}>
              <button type="button" onClick={() => toggle(i)} aria-pressed={!off}
                className={cn('flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-200',
                  off ? 'border-dashed border-white/10 bg-transparent opacity-55' : 'border-white/10 bg-background/50 hover:border-nova/40')} data-prepared-item={it.kind}>
                <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors', off ? 'border border-white/20 text-foreground/40' : 'bg-nova text-background')}>
                  {off ? i + 1 : <Check aria-hidden className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-medium', off ? 'text-foreground/50 line-through' : 'text-foreground')}>{it.title}</span>
                  <span className="block truncate text-[11px] text-foreground/50">{[it.subjectName, it.kind === 'task' ? 'Task' : it.kind === 'topic' ? 'Topic' : 'Just for today'].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-foreground/60">{it.minutes ? `${it.minutes} min` : ''}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="mt-3 px-5">
        <div className="flex items-center justify-between text-[11px] text-foreground/55">
          <span>{kept.length} of {added.length} kept · {minutes} min{budget ? ` of today’s ${budget}` : ''}</span>
          {skip.size > 0 && <button type="button" onClick={() => setSkip(new Set())} className="underline-offset-2 hover:text-foreground hover:underline">Keep all</button>}
        </div>
        {budget ? <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden><div className={cn('h-full rounded-full transition-[width] duration-300', minutes > budget ? 'bg-amber-400' : 'bg-nova')} style={{ width: `${Math.min(100, (minutes / budget) * 100)}%` }} /></div> : null}
      </div>
      {error && <p role="alert" className="mx-5 mt-2 text-xs text-amber-300">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 bg-background/20 px-5 py-3.5">
        <button type="button" disabled={busy || kept.length === 0} onClick={() => void take()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3.5 text-sm font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-50" data-prepared-take>
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />} {hasOwn ? 'Add these to my day' : 'Start my day with this'}
        </button>
        <button type="button" onClick={() => onTweak(plan)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-sm text-foreground/85 hover:bg-white/5" data-prepared-tweak>
          <MessageSquareText aria-hidden className="size-4" /> Tweak with Nova
        </button>
        <button type="button" onClick={onDismiss} className="ml-auto text-xs text-foreground/55 underline-offset-2 hover:text-foreground hover:underline" data-prepared-dismiss>Not today, I’ll plan my own way</button>
      </div>
    </section>
  )
}

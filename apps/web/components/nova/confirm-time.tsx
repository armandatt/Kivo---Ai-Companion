'use client'

// A session that ran more than two hours past its plan is kept, but its time
// waits for the learner's word before it counts (PR #113 B.1): all of it, or
// trimmed to what they really studied.

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { sendSessionCommand } from './nova-api'
import { minutesLabel } from './format'
import { cn } from '@/lib/utils'

export function ConfirmTime({ sessionId, recorded, dark = false, onDone }: { sessionId: string; recorded: number; dark?: boolean; onDone?: (minutes: number) => void }) {
  const [value, setValue] = useState(String(recorded))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const n = Math.round(Number(value))
  const ok = Number.isFinite(n) && n >= 0 && n <= recorded
  const send = async (minutes: number) => {
    setBusy(true); setError(null)
    const res = await sendSessionCommand({ action: 'confirm_time', sessionId, minutes })
    setBusy(false)
    if (res.ok) { setDone(minutes); onDone?.(minutes) } else setError(res.message)
  }
  if (done !== null) return <p className={cn('text-sm', dark ? 'text-white/75' : 'text-foreground/75')} data-time-confirmed><Check aria-hidden className="mr-1 inline size-4 text-emerald-400" />Counted as {minutesLabel(done)}.</p>
  return (
    <div className={cn('rounded-2xl border p-3 text-left text-sm', dark ? 'border-white/15 bg-white/[0.06] text-white/85' : 'border-amber-400/30 bg-amber-400/[0.06] text-foreground/85')} data-confirm-time>
      <p>This ran {minutesLabel(recorded)}, well past its plan, so it isn’t counted yet. How long did you actually study?</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void send(recorded)} className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold', dark ? 'bg-white/15 hover:bg-white/25' : 'bg-action text-action-foreground hover:bg-action-hover')} data-confirm-all>Count all {minutesLabel(recorded)}</button>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Minutes studied</span>
          <input inputMode="numeric" value={value} onChange={e => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className={cn('h-8 w-16 rounded-lg border bg-transparent px-2 text-sm', dark ? 'border-white/20' : 'border-white/15')} data-confirm-minutes />
          <span className="text-xs opacity-70">min</span>
        </label>
        <button type="button" disabled={busy || !ok || n === recorded} onClick={() => void send(n)} className={cn('rounded-lg border px-3 py-1.5 text-sm', dark ? 'border-white/20 hover:bg-white/10' : 'border-white/15 hover:bg-white/5')} data-confirm-trim>
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : 'Count that'}
        </button>
      </div>
      {!ok && value !== '' && <p className="mt-1 text-xs text-amber-300">Between 0 and {recorded} minutes.</p>}
      {error && <p role="alert" className="mt-1 text-xs text-amber-300">{error}</p>}
    </div>
  )
}

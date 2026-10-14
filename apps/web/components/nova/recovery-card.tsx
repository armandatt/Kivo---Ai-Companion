'use client'

// "Getting back on track", as the server worked it out (product/recovery.ts).
// The page decides nothing: it shows where the learner is, what Nova changed
// by itself (only today's plan, nothing saved), and the proposal that waits
// for them. Nothing moves until they press Move them; Not now writes nothing
// and only hides this proposal in this browser; Undo puts back exactly what
// was moved, if nothing changed since.

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type {
  NovaRecoveryReady, NovaRecoveryView, RecoveryActionResponse, RecoveryMoveInput,
} from '@repo/api/nova/product/recovery.types'
import { deadlineDate } from './format'

const HIDDEN_KEY = 'kivo-recovery-hidden'

function hiddenId(): string | null {
  try { return window.localStorage.getItem(HIDDEN_KEY) } catch { return null }
}
function hide(id: string | null) {
  try { if (id) window.localStorage.setItem(HIDDEN_KEY, id); else window.localStorage.removeItem(HIDDEN_KEY) } catch { /* private window */ }
}

async function post(body: unknown): Promise<RecoveryActionResponse> {
  try {
    const res = await fetch('/api/nova/recovery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'unauthenticated', message: 'Sign in again.' } }
    return await res.json() as RecoveryActionResponse
  } catch {
    return { ok: false, error: 'failed', message: 'Could not reach the server. Nothing was changed.' }
  }
}

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-colors disabled:opacity-50'
// A due day is a calendar day: noon UTC reads as that day in any zone.
const dayLabel = (day: string) => deadlineDate(`${day}T12:00:00.000Z`, 'UTC')

export function RecoveryCard({ onChanged }: { onChanged?: () => void }) {
  const [view, setView]       = useState<NovaRecoveryReady | null>(null)
  const [hidden, setHidden]   = useState<string | null>(null)
  const [busy, setBusy]       = useState<'accept' | 'undo' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [undo, setUndo]       = useState<RecoveryMoveInput[] | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/nova/recovery', { cache: 'no-store' })
      if (!res.ok) return
      const v = await res.json() as NovaRecoveryView
      if (v.status === 'ready') setView(v)
    } catch { /* the card is optional: Today works without it */ }
  }, [])
  useEffect(() => { setHidden(hiddenId()); void load() }, [load])

  async function accept() {
    if (!view?.proposal) return
    setBusy('accept'); setMessage(null)
    const res = await post({ action: 'accept', proposalId: view.proposal.id, moves: view.proposal.moves.map(({ taskId, from, to }) => ({ taskId, from, to })) })
    setBusy(null)
    if (res.ok) {
      setView(res.view); setUndo(res.undo.length > 0 ? res.undo : null)
      setMessage(res.outcome === 'applied' ? `Moved ${res.undo.length} task${res.undo.length === 1 ? '' : 's'}.` : 'That was already done.')
      onChanged?.()
    } else {
      if (res.view) setView(res.view)
      setMessage(res.message)
    }
  }

  async function undoMoves() {
    if (!undo) return
    setBusy('undo'); setMessage(null)
    const res = await post({ action: 'undo', moves: undo })
    setBusy(null)
    if (res.ok) { setView(res.view); setUndo(null); setMessage('Put back where they were.'); onChanged?.() }
    else { if (res.view) setView(res.view); setMessage(res.message) }
  }

  if (!view) return null
  const showsSituation = view.situation === 'missed_one' || view.situation === 'missed_several' || view.situation === 'returning'
  const proposal = view.proposal && view.proposal.id !== hidden ? view.proposal : null
  if (!showsSituation && !proposal && !undo && !message) return null

  return (
    <section aria-labelledby="recovery-heading" data-section="recovery" className="rounded-2xl border border-white/10 bg-card/60 p-5">
      <h3 id="recovery-heading" className="text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/90">Getting back on track</h3>
      <p className="mt-3 text-sm leading-relaxed text-foreground/85" data-recovery-headline>{view.headline}</p>
      {view.reentryDay && (
        <p className="mt-2 text-xs leading-relaxed text-foreground/55">Nova shortened today&apos;s plan by itself. Nothing was saved, and it goes back to your usual day after your next session.</p>
      )}

      {proposal && (proposal.moves.length > 0 || proposal.unplaced.length > 0) && (
        <div className="mt-4" data-recovery-proposal={proposal.id}>
          <p className="text-xs font-medium text-foreground/60">Waiting for your yes: nothing has moved</p>
          {proposal.moves.length > 0 && (
            <ul className="mt-2 space-y-2">
              {proposal.moves.map(m => (
                <li key={m.taskId} className="text-sm leading-relaxed" data-move={m.taskId}>
                  <span className="font-medium text-foreground">{m.title}</span>
                  <span className="text-foreground/60">: {dayLabel(m.from)} → {dayLabel(m.to)}</span>
                  <p className="text-xs text-foreground/45">{m.reason}</p>
                </li>
              ))}
            </ul>
          )}
          {proposal.unplaced.length > 0 && (
            <ul className="mt-3 space-y-2">
              {proposal.unplaced.map(u => (
                <li key={u.taskId} className="text-sm leading-relaxed" data-unplaced={u.why}>
                  <span className="font-medium text-foreground">{u.title}</span>
                  <span className="text-foreground/60">: left on {dayLabel(u.from)}.</span>
                  <p className="text-xs text-amber-200/80">{u.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3 text-xs text-foreground/45">
            <summary className="cursor-pointer">What this assumes</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">{proposal.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            {proposal.moves.length > 0 && (
              <button type="button" disabled={busy !== null} onClick={() => void accept()} className={`${btn} bg-keppel-400 text-keppel-950 hover:bg-keppel-300`}>
                {busy === 'accept' && <Loader2 className="size-3.5 animate-spin" />} Move {proposal.moves.length === 1 ? 'it' : 'them'}
              </button>
            )}
            <button type="button" disabled={busy !== null} onClick={() => { hide(proposal.id); setHidden(proposal.id) }} className={`${btn} border border-white/12 text-foreground/75 hover:text-foreground`}>
              Not now
            </button>
          </div>
        </div>
      )}

      {undo && (
        <button type="button" disabled={busy !== null} onClick={() => void undoMoves()} className={`${btn} mt-4 border border-white/12 text-foreground/75 hover:text-foreground`}>
          {busy === 'undo' && <Loader2 className="size-3.5 animate-spin" />} Undo
        </button>
      )}
      {message && <p role="status" className="mt-3 text-sm text-foreground/70">{message}</p>}
    </section>
  )
}

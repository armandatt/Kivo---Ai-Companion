'use client'

// Approving changes an assistant proposed through Kivo Connect. Nothing has
// changed yet. Each change is shown by name and place (never an internal
// id): what it is, where it is now, what it becomes. Approve applies it here
// and then when Kivo kept the plan's changes (no note text in them); the
// learner goes back to the conversation and the assistant reads the result.
// Decline is recorded and the plan can never run.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AuthError, AuthNotice, AuthShell, authPrimaryButtonClass } from '@/components/auth/auth-shell'

type Item = { action: string; kind: string; name: string; where: string | null; to: string | null; detail: string | null; destructive: boolean; text: string }
type Plan = {
  planId: string; summary: string[]; items: Item[] | null; expiresAt: string; client: string
  approvedAt: string | null; declinedAt: string | null; appliesOnApproval: boolean
  applied: { status: string | null; counts: Record<string, number> } | null; expired: boolean
}
type Outcome = 'applied' | 'approved' | 'declined' | null

const VERB: Record<string, string> = {
  add: 'Add', describe: 'Explain', rename: 'Rename', move: 'Move', delete: 'Delete',
  create: 'Create', append: 'Add to', file: 'Move', link: 'Link',
  replace: 'Replace the text of', edit: 'Edit', restore: 'Restore',
}

function ItemRow({ item }: { item: Item }) {
  const arrow = item.action === 'rename' ? 'to' : item.action === 'link' ? 'to' : item.action === 'move' || item.action === 'file' ? 'to' : item.action === 'add' || item.action === 'create' ? 'in' : null
  return (
    <li className={`rounded-lg border px-3 py-2 ${item.destructive ? 'border-coral-400/40 bg-coral-400/5' : 'border-white/10'}`}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={`text-xs font-semibold uppercase tracking-wide ${item.destructive ? 'text-coral-300' : 'text-ink-300'}`}>{VERB[item.action] ?? item.action} {item.kind}</span>
        <span className="font-medium text-ink-50">{item.name}</span>
      </div>
      {item.where && <p className="mt-0.5 text-ink-300">{item.action === 'move' || item.action === 'file' ? 'Now in' : 'In'} {item.where}</p>}
      {item.to && arrow && <p className="mt-0.5 text-ink-200">{arrow === 'to' ? (item.action === 'rename' ? 'New name: ' : 'To: ') : 'In: '}<span className="font-medium text-ink-50">{item.to}</span></p>}
      {item.detail && <p className="mt-0.5 text-ink-300">{item.detail}</p>}
    </li>
  )
}

function Approve() {
  const id = useSearchParams().get('plan') ?? ''
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [result, setResult] = useState<Plan['applied']>(null)

  useEffect(() => {
    fetch(`/api/connect/plans/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async r => {
        if (r.status === 401) { window.location.href = `/signin?from=${encodeURIComponent(`/connect/approve?plan=${id}`)}`; return }
        const b = await r.json()
        if (b.ok) setPlan(b.plan); else setError(b.message ?? 'There is no such plan.')
      })
      .catch(() => setError("Couldn't reach Kivo. Reload to try again."))
  }, [id])

  async function send(action: 'approve' | 'decline') {
    setBusy(action); setError('')
    const r = await fetch(`/api/connect/plans/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null)
    const b = r ? await r.json().catch(() => null) : null
    if (b?.ok) { setOutcome(b.status); if (b.result) setResult(b.result) }
    else setError(b?.message ?? (action === 'approve' ? "Couldn't approve. Nothing was changed." : "Couldn't record that. Nothing was changed."))
    setBusy(null)
  }

  if (error && !plan) return <AuthShell title="Review changes"><AuthError>{error}</AuthError></AuthShell>
  if (!plan) return <AuthShell title="Review changes"><p className="text-sm text-ink-300">Loading the plan…</p></AuthShell>

  const items: Item[] = plan.items ?? plan.summary.map(s => ({ action: '', kind: '', name: s, where: null, to: null, detail: null, destructive: s.startsWith('DELETE') || s.startsWith('Delete'), text: s }))
  const destructive = items.some(i => i.destructive)
  const done: Outcome = outcome ?? (plan.applied ? 'applied' : plan.declinedAt ? 'declined' : plan.approvedAt ? 'approved' : null)
  const applied = result ?? plan.applied
  const n = items.length

  return (
    <AuthShell title={`${plan.client} wants to change your Kivo`} subtitle={done ? undefined : `${n} change${n === 1 ? '' : 's'}. Nothing has changed yet.`}>
      <div className="space-y-4 text-sm text-ink-200">
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {items.map((it, i) => <ItemRow key={i} item={it.action ? it : { ...it, action: '', kind: '' }} />)}
        </ul>
        {done === 'applied' ? (
          <AuthNotice>
            Done{applied?.status === 'completed_with_warnings' ? ', with warnings' : ''}. Go back to {plan.client}: it can read the result, so you don&rsquo;t need to ask again.
          </AuthNotice>
        ) : done === 'approved' ? (
          <AuthNotice>Approved. Go back to {plan.client} and tell it to go ahead; it will apply exactly these changes once.</AuthNotice>
        ) : done === 'declined' ? (
          <AuthNotice>Declined. Nothing was changed, and {plan.client} can&rsquo;t apply this plan.</AuthNotice>
        ) : plan.expired ? (
          <AuthError>This plan has expired. Ask {plan.client} to preview the changes again.</AuthError>
        ) : (
          <>
            {destructive && <AuthError>This deletes something. Deleted notes can&rsquo;t be restored from here.</AuthError>}
            {error && <AuthError>{error}</AuthError>}
            <div className="flex gap-2">
              <button type="button" disabled={busy !== null} onClick={() => send('approve')} className={`${authPrimaryButtonClass} flex-1`}>
                {busy === 'approve' ? 'Applying…' : plan.appliesOnApproval ? (destructive ? 'Approve and delete' : 'Approve and apply') : 'Approve'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => send('decline')} className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 font-medium text-ink-100 hover:bg-white/5 disabled:opacity-50">
                {busy === 'decline' ? 'Declining…' : 'Decline'}
              </button>
            </div>
            <p className="text-ink-300">Expires {new Date(plan.expiresAt).toLocaleTimeString()}.</p>
          </>
        )}
      </div>
    </AuthShell>
  )
}

export default function Page() {
  return <Suspense><Approve /></Suspense>
}

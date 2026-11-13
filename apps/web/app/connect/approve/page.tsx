'use client'

// Approving changes an assistant proposed. The plan was previewed through
// Kivo Connect; nothing has changed yet. Approving lets the assistant apply
// exactly these changes once, before the plan expires.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AuthError, AuthNotice, AuthShell, authPrimaryButtonClass } from '@/components/auth/auth-shell'

type Plan = { planId: string; summary: string[]; expiresAt: string; client: string; approvedAt: string | null; expired: boolean }

function Approve() {
  const id = useSearchParams().get('plan') ?? ''
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`/api/connect/plans/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async r => {
        if (r.status === 401) { window.location.href = `/signin?from=${encodeURIComponent(`/connect/approve?plan=${id}`)}`; return }
        const b = await r.json()
        if (b.ok) setPlan(b.plan); else setError(b.message ?? 'There is no such plan.')
      })
      .catch(() => setError("Couldn't reach Kivo. Reload to try again."))
  }, [id])

  async function approve() {
    setBusy(true); setError('')
    const r = await fetch(`/api/connect/plans/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
    const b = r ? await r.json().catch(() => null) : null
    if (b?.ok) setDone(true); else setError(b?.message ?? "Couldn't approve. Nothing was changed.")
    setBusy(false)
  }

  if (error && !plan) return <AuthShell title="Review changes"><AuthError>{error}</AuthError></AuthShell>
  if (!plan) return <AuthShell title="Review changes"><p className="text-sm text-ink-300">Loading the plan…</p></AuthShell>
  const destructive = plan.summary.some(s => s.startsWith('DELETE'))
  return (
    <AuthShell title={`Changes proposed by ${plan.client}`} subtitle="Nothing has changed yet.">
      <div className="space-y-4 text-sm text-ink-200">
        <ol className="max-h-80 list-decimal space-y-1.5 overflow-y-auto pl-5">
          {plan.summary.map((s, i) => <li key={i} className={s.startsWith('DELETE') ? 'text-coral-300' : ''}>{s}</li>)}
        </ol>
        {destructive && <AuthError>This plan deletes something. Deleted notes can't be restored from here.</AuthError>}
        {done || plan.approvedAt ? (
          <AuthNotice>Approved. Go back to {plan.client} and tell it to go ahead; it will apply exactly these changes once.</AuthNotice>
        ) : plan.expired ? (
          <AuthError>This plan has expired. Ask {plan.client} to preview the changes again.</AuthError>
        ) : (
          <>
            {error && <AuthError>{error}</AuthError>}
            <button type="button" disabled={busy} onClick={approve} className={authPrimaryButtonClass}>Approve these changes</button>
            <p className="text-ink-300">If you don&rsquo;t want them, just close this page. Expires {new Date(plan.expiresAt).toLocaleTimeString()}.</p>
          </>
        )}
      </div>
    </AuthShell>
  )
}

export default function Page() {
  return <Suspense><Approve /></Suspense>
}

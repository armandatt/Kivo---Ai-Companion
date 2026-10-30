'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, CreditCard, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { PLANS, formatPrice, intervalLabel, type PlanKey } from '@repo/api/billing/plans'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'

// The account's plan: what it has, until when, how much of today's Nova it
// has used, and the ways to change it. Everything shown comes from
// /api/billing, which reads the server's records; this page never decides
// that someone has Pro. After checkout it waits for the provider's own word.

type View = {
  ok: true
  plan: 'free' | 'pro'
  source: 'subscription' | 'grace' | 'trial' | 'free'
  planKey: PlanKey | null
  until: string | null
  subscription: { planKey: PlanKey; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; canceledAt: string | null } | null
  trial: { startedAt: string; endsAt: string; active: boolean } | null
  trialEligible: boolean
  trialDays: number
  usage: { today: number; limit: number }
  purchasable: PlanKey[]
  providerReady: boolean
}

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
const CARD = 'rounded-3xl border border-white/8 bg-card/70 p-6'

async function post(path: string, body: unknown = {}): Promise<{ ok: boolean; url?: string; message?: string; endsAt?: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.status === 401) { window.location.href = '/signin?from=/settings/billing'; return { ok: false } }
    return await res.json()
  } catch {
    return { ok: false, message: 'Could not reach Kivo. Check your connection and try again.' }
  }
}

// One plain sentence for where the account stands.
function standing(v: View): { title: string; detail: string; tone: 'good' | 'warn' | 'plain' } {
  const s = v.subscription
  if (v.source === 'grace') return { title: 'Pro, payment due', detail: `Your last payment didn't go through. Pro stays on until ${day(v.until)} while you update your card.`, tone: 'warn' }
  if (v.source === 'subscription' && s) {
    if (s.cancelAtPeriodEnd || s.status === 'canceled') return { title: `${PLANS[s.planKey]?.name ?? 'Pro'}, ending`, detail: `You cancelled. Pro stays on until ${day(s.currentPeriodEnd)}, then you're on Free. Nothing you made is lost.`, tone: 'warn' }
    return { title: PLANS[s.planKey]?.name ?? 'Pro', detail: s.currentPeriodEnd ? `Renews on ${day(s.currentPeriodEnd)}.` : 'Active.', tone: 'good' }
  }
  if (v.source === 'trial' && v.trial) return { title: 'Pro trial', detail: `Your free trial ends on ${day(v.trial.endsAt)}. No card on file, so nothing is charged; you move to Free unless you upgrade.`, tone: 'good' }
  if (v.trial && !v.trial.active) return { title: 'Free', detail: `Your Pro trial ended on ${day(v.trial.endsAt)}. Everything you made is still here.`, tone: 'plain' }
  if (s && (s.status === 'revoked' || s.status === 'canceled')) return { title: 'Free', detail: 'Your Pro subscription has ended. Everything you made is still here.', tone: 'plain' }
  return { title: 'Free', detail: 'Plan, study, keep notes and talk to Nova, within a daily allowance.', tone: 'plain' }
}

export function BillingPage() {
  const params = useSearchParams()
  const returned = params.get('checkout') === 'success'
  const wanted = params.get('plan') as PlanKey | null
  const [view, setView] = useState<View | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(returned)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing', { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/signin?from=/settings/billing'; return null }
      const data = await res.json() as View | { ok: false }
      if (!data.ok) { setFailed(true); return null }
      setView(data); setFailed(false)
      return data
    } catch { setFailed(true); return null }
  }, [])

  useEffect(() => { void load() }, [load])

  // Back from checkout: Pro arrives with the provider's webhook, usually
  // within seconds. Ask again until it has, for up to a minute.
  useEffect(() => {
    if (!returned) return
    let tries = 0, stop = false
    const tick = async () => {
      if (stop) return
      const v = await load()
      if (v && v.source === 'subscription') { setWaiting(false); return }
      if (++tries >= 20) { setWaiting(false); return }
      window.setTimeout(() => void tick(), 3000)
    }
    void tick()
    return () => { stop = true }
  }, [returned, load])

  const go = async (key: string, path: string, body?: unknown) => {
    setBusy(key); setError(null)
    const res = await post(path, body)
    if (res.ok && res.url) { window.location.href = res.url; return }
    if (res.ok) { await load(); setBusy(null); return }
    setError(res.message ?? 'That did not work. Try again.')
    setBusy(null)
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-foreground/55 transition-colors hover:text-foreground"><ArrowLeft className="size-4" /> Settings</Link>
      <h1 className="mt-4 text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.4rem]">Plan and billing</h1>
      <p className="mt-2 text-sm text-foreground/60">Your plan, today&apos;s use of Nova, and how to change either.</p>
      <div className="mt-8 space-y-6">{children}</div>
    </div>
  )

  if (failed && !view) {
    return shell(
      <div className={CARD} role="alert">
        <p className="text-base font-semibold text-foreground">Couldn&apos;t load your plan</p>
        <p className="mt-1 text-sm text-foreground/60">Your plan and everything you made are safe. Try again in a moment.</p>
        <button type="button" onClick={() => void load()} className={cn(BUTTON_QUIET, 'mt-4')}>Try again</button>
      </div>,
    )
  }
  if (!view) {
    return shell(<div aria-busy="true" aria-label="Loading your plan" className="space-y-4"><div className="h-36 animate-pulse rounded-3xl bg-white/5" /><div className="h-56 animate-pulse rounded-3xl bg-white/4" /></div>)
  }

  const now = standing(view)
  const pct = Math.min(100, Math.round((view.usage.today / Math.max(1, view.usage.limit)) * 100))
  const subscribed = view.source === 'subscription' || view.source === 'grace'
  const offers = (['pro_monthly', 'pro_annual'] as const).filter(k => k === 'pro_monthly' || view.purchasable.includes(k))

  return shell(
    <>
      {waiting && (
        <p role="status" className="flex items-center gap-2 rounded-2xl border border-keppel-400/30 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/80">
          <Loader2 className="size-4 animate-spin text-keppel-300" /> Confirming your payment with Polar. This usually takes a few seconds.
        </p>
      )}
      {returned && !waiting && view.source !== 'subscription' && (
        <p role="status" className="rounded-2xl border border-amber-300/30 bg-amber-300/8 px-4 py-3 text-sm text-foreground/80">
          We haven&apos;t heard from Polar yet. If you paid, Pro turns on as soon as it confirms; there&apos;s no need to pay again. Refresh this page in a minute.
        </p>
      )}

      <section aria-labelledby="your-plan" className={cn(CARD, 'relative overflow-hidden')}>
        {view.plan === 'pro' && <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-keppel-400/15 blur-3xl" />}
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">Your plan</p>
            <h2 id="your-plan" className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
              {view.plan === 'pro' && <Sparkles className="size-5 text-keppel-300" />}{now.title}
            </h2>
            <p className={cn('mt-1.5 max-w-prose text-sm leading-relaxed', now.tone === 'warn' ? 'text-amber-200' : 'text-foreground/65')}>{now.detail}</p>
          </div>
          {view.subscription && (
            <button type="button" onClick={() => void go('portal', '/api/billing/portal')} disabled={busy !== null || !view.providerReady} className={BUTTON_QUIET}>
              {busy === 'portal' ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />} Manage subscription <ExternalLink className="size-3 opacity-60" />
            </button>
          )}
        </div>

        <div className="relative mt-6">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-foreground/75">Nova today</span>
            <span className="tabular-nums text-foreground/55">{view.usage.today} of {view.usage.limit} requests</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuemin={0} aria-valuemax={view.usage.limit} aria-valuenow={view.usage.today} aria-label="Nova requests used today">
            <div className={cn('h-full rounded-full transition-[width] duration-700', pct >= 90 ? 'bg-amber-300' : 'bg-keppel-400')} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-foreground/45">Every message Nova reads, on the web or Telegram, and every note or page you ask it about. Resets at midnight UTC.</p>
        </div>
      </section>

      {error && <p role="alert" className="rounded-2xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}

      {!subscribed && view.trialEligible && view.trialDays > 0 && (
        <section className={cn(CARD, 'flex flex-wrap items-center justify-between gap-4 border-keppel-400/25')}>
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground">Try Pro free for {view.trialDays} days</p>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-foreground/60">No card needed and nothing is charged. When it ends you&apos;re back on Free, with everything you made still here.</p>
          </div>
          <button type="button" onClick={() => void go('trial', '/api/billing/trial')} disabled={busy !== null} className={cn(BUTTON_PRIMARY, 'shrink-0')} data-start-trial>
            {busy === 'trial' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Start free trial
          </button>
        </section>
      )}

      {!subscribed && (
        <section aria-labelledby="upgrade" className="space-y-3">
          <h2 id="upgrade" className="text-sm font-semibold text-foreground/85">Upgrade</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {offers.map(key => {
              const plan = PLANS[key]
              const can = view.purchasable.includes(key)
              return (
                <div key={key} className={cn(CARD, 'flex flex-col', wanted === key && 'border-keppel-400/50 ring-1 ring-keppel-400/30')}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-base font-semibold text-foreground">{plan.name}</p>
                    <p className="text-xl font-semibold text-foreground">{formatPrice(plan)}<span className="text-sm font-normal text-foreground/50">{intervalLabel(plan)}</span></p>
                  </div>
                  <p className="mt-1 text-sm text-foreground/60">{plan.tagline}</p>
                  <ul className="mt-4 flex-1 space-y-2">
                    {plan.features.map(f => <li key={f} className="flex gap-2.5 text-sm text-foreground/75"><Check className="mt-0.5 size-4 shrink-0 text-keppel-300" /> {f}</li>)}
                  </ul>
                  <button type="button" onClick={() => void go(`checkout:${key}`, '/api/billing/checkout', { plan: key })} disabled={!can || busy !== null}
                    className={cn(BUTTON_PRIMARY, 'mt-5 w-full')}>
                    {busy === `checkout:${key}` ? <><Loader2 className="size-4 animate-spin" /> Opening checkout…</> : can ? `Upgrade to ${plan.name}` : view.providerReady ? 'Not available yet' : 'Payments open soon'}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-xs leading-relaxed text-foreground/45">Payments are handled by Polar, Kivo&apos;s merchant of record; Kivo never sees your card. Prices are in US dollars. Cancel any time from Manage subscription; Pro stays on until the end of the period you paid for.</p>
        </section>
      )}
    </>,
  )
}

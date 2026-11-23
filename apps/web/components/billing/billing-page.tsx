'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CreditCard, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { PLANS, formatPrice, intervalLabel, type PlanKey } from '@repo/api/billing/plans'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { compareLines, usageRows, type Allowances, type TierAllowance, type UsageRow } from './usage-model'

// The account's plan: what it has, until when, what it has used, and the
// ways to change it. There is no free trial: paid plans come only from a
// verified payment. Everything shown comes from
// /api/billing, which reads the server's records; this page never decides
// that someone has Pro. After checkout it waits for the provider's own word.

type View = {
  ok: true
  plan: 'free' | 'pro'
  tier?: 'free' | 'plus' | 'pro'
  source: 'subscription' | 'grace' | 'free'
  planKey: PlanKey | null
  until: string | null
  subscription: { planKey: PlanKey; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; canceledAt: string | null } | null
  trial: { startedAt: string; endsAt: string; active: boolean } | null
  trialEligible: boolean
  trialDays: number
  usage: { today: number; limit: number }
  allowances?: Allowances | null
  purchasable: PlanKey[]
  providerReady: boolean
  catalog?: Record<'free' | 'plus' | 'pro', TierAllowance>
  nextOffer?: { plan: PlanKey; tier: 'free' | 'plus' | 'pro'; name: string; price: string; interval: string | null; allowance: TierAllowance } | null
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
  const paid = s ? (PLANS[s.planKey]?.name ?? 'Pro') : 'Pro'
  if (v.source === 'grace') return { title: `${paid}, payment due`, detail: `Your last payment didn't go through. ${paid} stays on until ${day(v.until)} while you update your payment method.`, tone: 'warn' }
  if (v.source === 'subscription' && s) {
    if (s.cancelAtPeriodEnd || s.status === 'canceled') return { title: `${paid}, ending`, detail: `You cancelled. ${paid} stays on until ${day(s.currentPeriodEnd)}, then you're on Free. Nothing you made is lost.`, tone: 'warn' }
    return { title: PLANS[s.planKey]?.name ?? 'Pro', detail: s.currentPeriodEnd ? `Renews on ${day(s.currentPeriodEnd)}.` : 'Active.', tone: 'good' }
  }
  if (s && (s.status === 'revoked' || s.status === 'canceled')) return { title: 'Free', detail: `Your ${paid} subscription has ended. Everything you made is still here.`, tone: 'plain' }
  return { title: 'Free', detail: v.allowances?.mode === 'enforce' ? 'Plan, study, keep notes and talk to Nova, within a monthly allowance.' : 'Plan, study, keep notes and talk to Nova, within a daily allowance.', tone: 'plain' }
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
  const [readAt, setReadAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing', { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/signin?from=/settings/billing'; return null }
      const data = await res.json() as View | { ok: false }
      if (!data.ok) { setFailed(true); return null }
      setView(data); setFailed(false); setReadAt(new Date())
      return data
    } catch { setFailed(true); return null }
  }, [])

  useEffect(() => { void load() }, [load])

  // Usage moves while the page is away: read it again when the tab comes back.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [load])

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
      <h1 className="mt-4 text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.4rem]">Plan and usage</h1>
      <p className="mt-2 text-sm text-foreground/60">Your plan, what it includes, what you&apos;ve used and when it renews.</p>
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
        {(view.tier ?? view.plan) !== 'free' && <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-keppel-400/15 blur-3xl" />}
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">Your plan</p>
            <h2 id="your-plan" className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
              {(view.tier ?? view.plan) !== 'free' && <Sparkles className="size-5 text-keppel-300" />}{now.title}
            </h2>
            <p className={cn('mt-1.5 max-w-prose text-sm leading-relaxed', now.tone === 'warn' ? 'text-amber-200' : 'text-foreground/65')}>{now.detail}</p>
          </div>
          {view.subscription && (
            <button type="button" onClick={() => void go('portal', '/api/billing/portal')} disabled={busy !== null || !view.providerReady} className={BUTTON_QUIET}>
              {busy === 'portal' ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />} Manage subscription <ExternalLink className="size-3 opacity-60" />
            </button>
          )}
        </div>

        {view.allowances ? <UsageTable a={view.allowances} readAt={readAt} onRefresh={() => void load()} /> : (
          <div className="relative mt-6">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-foreground/75">Nova today</span>
              <span className="tabular-nums text-foreground/55">{view.usage.today} of {view.usage.limit} requests</span>
            </div>
            <Bar used={view.usage.today} limit={view.usage.limit} label="Nova requests used today" />
            <p className="mt-1.5 text-[11px] text-foreground/45">Every message Nova reads, on the web or Telegram, and every note or page you ask it about. Resets at midnight UTC.</p>
          </div>
        )}
      </section>

      {error && <p role="alert" className="rounded-2xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}


      {view.catalog && (view.nextOffer || view.tier !== 'pro') && (
        <Upgrade view={view} wanted={wanted} busy={busy} onCheckout={key => void go(`checkout:${key}`, '/api/billing/checkout', { plan: key })} />
      )}
    </>,
  )
}

function Bar({ used, limit, label, pct: given }: { used: number; limit: number; label: string; pct?: number }) {
  const pct = given ?? Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width] duration-700', pct >= 90 ? 'bg-amber-300' : 'bg-keppel-400')} style={{ width: `${pct}%` }} />
    </div>
  )
}

const STATE_LABEL: Partial<Record<UsageRow['state'], { text: string; tone: string }>> = {
  low:       { text: 'Running low', tone: 'border-amber-300/30 bg-amber-300/10 text-amber-200' },
  used_up:   { text: 'Used up', tone: 'border-amber-300/40 bg-amber-300/15 text-amber-100' },
  read_only: { text: 'Read-only', tone: 'border-white/15 bg-white/5 text-foreground/70' },
  fair_use:  { text: 'Fair use', tone: 'border-white/12 bg-white/4 text-foreground/55' },
}

// The four allowances, each on its own row: they never share a balance.
// Every figure is the server's (usage-model.ts only words it).
function UsageTable({ a, readAt, onRefresh }: { a: Allowances; readAt: Date | null; onRefresh: () => void }) {
  const rows = usageRows(a)
  return (
    <div className="relative mt-6" aria-label="What you've used">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">This period</p>
        <button type="button" onClick={onRefresh} className="text-[11px] text-foreground/45 underline-offset-2 hover:text-foreground/70 hover:underline">
          {readAt ? `Updated ${readAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · Refresh` : 'Refresh'}
        </button>
      </div>
      <ul className="mt-3 divide-y divide-white/6 border-y border-white/6">
        {rows.map(r => {
          const tag = STATE_LABEL[r.state]
          return (
            <li key={r.key} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground/85">
                  {r.name}
                  {tag && <span className={cn('rounded-full border px-2 py-px text-[10px] font-medium', tag.tone)}>{tag.text}</span>}
                </span>
                <span className="text-sm tabular-nums text-foreground/70">{r.figure}{r.left ? <span className="text-foreground/45"> · {r.left}</span> : null}</span>
              </div>
              {r.pct !== null && r.limit !== null && <Bar used={Math.min(r.used, r.limit)} limit={r.limit} label={`${r.name} used`} pct={r.pct} />}
              {r.extra && (
                <div className="mt-3 pl-3 border-l border-white/10">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="text-foreground/70">{r.extra.label}</span>
                    <span className="tabular-nums text-foreground/60">{r.extra.figure}</span>
                  </div>
                  {r.extra.pct !== null && <Bar used={r.extra.pct} limit={100} label={r.extra.label} pct={r.extra.pct} />}
                  {r.extra.renews && <p className="mt-1 text-[11px] text-foreground/45">{r.extra.renews}</p>}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-foreground/50">{r.renews}</p>
              <details className="group mt-1.5">
                <summary className="cursor-pointer list-none text-[11px] text-foreground/45 hover:text-foreground/70 [&::-webkit-details-marker]:hidden">
                  <span className="underline-offset-2 group-open:underline">What counts, and what happens at the limit</span>
                </summary>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground/60">{r.what}</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/60">{r.atLimit}</p>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// What the next plan on sale changes, side by side with what this account has
// now (both from the server's table). Only a plan that can be bought now has a
// button; Plus shows as coming while it is not on sale.
function Upgrade({ view, wanted, busy, onCheckout }: { view: View; wanted: PlanKey | null; busy: string | null; onCheckout: (key: PlanKey) => void }) {
  const tier = view.tier ?? (view.plan === 'pro' ? 'pro' : 'free')
  const offer = view.nextOffer ?? null
  const catalog = view.catalog!
  const plusSoon = tier === 'free' && !view.purchasable.includes('plus_monthly')
  const subscribed = view.source === 'subscription' || view.source === 'grace'
  if (!offer && !plusSoon) return null
  return (
    <section aria-labelledby="upgrade" className={CARD}>
      <h2 id="upgrade" className="text-base font-semibold text-foreground">{offer ? `What ${offer.name} changes` : 'More plans'}</h2>
      {offer ? (
        <>
          <p className="mt-1 text-sm text-foreground/60">{PLANS[offer.plan].tagline} {offer.price}{intervalLabel(PLANS[offer.plan])}.</p>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-foreground/45">
                <th className="pb-2 font-medium" scope="col"><span className="sr-only">Allowance</span></th>
                <th className="pb-2 font-medium" scope="col">Now</th>
                <th className="pb-2 font-medium" scope="col">{offer.name}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {compareLines(catalog[tier], offer.allowance).map(l => (
                <tr key={l.name}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground/65">{l.name}</th>
                  <td className="py-2 pr-3 tabular-nums text-foreground/60">{l.now}</td>
                  <td className="py-2 tabular-nums font-medium text-foreground">{l.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {subscribed ? (
            <p className="mt-4 text-xs text-foreground/55">To change plan, use Manage subscription above. Your new allowances apply once Polar confirms the change.</p>
          ) : (
            <button type="button" onClick={() => onCheckout(offer.plan)} disabled={busy !== null}
              className={cn(BUTTON_PRIMARY, 'mt-5 w-full sm:w-auto', wanted === offer.plan && 'ring-2 ring-keppel-400/40')}>
              {busy === `checkout:${offer.plan}` ? <><Loader2 className="size-4 animate-spin" /> Opening checkout…</> : `Upgrade to ${offer.name}`}
            </button>
          )}
        </>
      ) : null}
      {plusSoon && (
        <p className={cn('text-sm text-foreground/60', offer && 'mt-4 border-t border-white/6 pt-4')}>
          <span className="font-medium text-foreground/80">Plus</span> ({formatPrice(PLANS.plus_monthly)} a month, {catalog.plus.novaCredits.toLocaleString('en-US')} Nova credits) is coming soon. It isn&apos;t on sale yet{wanted === 'plus_monthly' ? ', so there is nothing to pay for now' : ''}.
        </p>
      )}
      <p className="mt-4 text-xs leading-relaxed text-foreground/45">Progress and Learning DNA are included in full on every plan: your learning history is never behind a paid plan. Payments are handled by Polar, Kivo&apos;s merchant of record; Kivo never sees your card. Plus is charged in Indian rupees and Pro in US dollars. A paid plan starts only when Polar confirms the payment. Cancel any time; nothing you made is ever deleted when a plan ends.</p>
    </section>
  )
}

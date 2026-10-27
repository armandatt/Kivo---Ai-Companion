'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CheckinSettings } from '@/components/nova/checkin-settings'
import { HelpPreferences } from '@/components/nova/help-preferences'
import { TelegramSettings } from '@/components/nova/telegram-connect'
import { DeleteAccountSection } from '@/components/settings/delete-account-section'
import { ThemePicker } from '@/components/theme/kio-theme'
import { PageHeader } from '@/components/dashboard/page-states'

// Settings: appearance, study setup, the daily check-in, the Telegram connection
// and deleting the account.
export default function SettingsPage() {
  // Which companion this account talks to, so the page can name it.
  const [companion, setCompanion] = useState<'Nova' | 'Rex' | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/nova/companion', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { companion?: string } | null) => { if (live) setCompanion(d?.companion === 'rex' ? 'Rex' : 'Nova') })
      .catch(() => { if (live) setCompanion('Nova') })
    return () => { live = false }
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <PageHeader title="Settings" description={<>Where you reach {companion ?? 'your companion'}, and how.</>} />

      <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Plan</p>
      <Link href="/settings/billing" className="group mt-3 flex items-center justify-between gap-4 rounded-3xl border border-white/8 bg-card/70 p-6 transition-colors hover:border-keppel-400/40" data-billing-link>
        <span>
          <span className="block text-base font-semibold text-foreground">Plan and billing</span>
          <span className="mt-1 block text-sm text-foreground/55">Your plan, today&apos;s use of Nova, the free trial and upgrading.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-foreground/40 transition-transform group-hover:translate-x-0.5" />
      </Link>

      <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Appearance</p>
      <section className="mt-3 rounded-3xl border border-white/8 bg-card/70 p-6">
        <h2 className="text-base font-semibold text-foreground">Theme</h2>
        <p className="mt-1 text-sm text-foreground/55">Applies everywhere in the app on this device. The Creature world keeps its own sky.</p>
        <div className="mt-4"><ThemePicker /></div>
      </section>

      {companion === 'Nova' && (
        <>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Learning</p>
          <Link href="/settings/study" className="mt-3 flex items-center justify-between gap-4 rounded-3xl border border-white/8 bg-card/70 p-6 transition-colors hover:border-white/16">
            <span>
              <span className="block text-base font-semibold text-foreground">What you&apos;re learning, your goals and dates</span>
              <span className="mt-1 block text-sm text-foreground/55">Say what you are learning for, add to it, move or remove a date, or start from a template.</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-foreground/45" />
          </Link>
        </>
      )}

      {companion === 'Nova' && (
        <>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">How Nova helps you</p>
          <div className="mt-3"><HelpPreferences /></div>
        </>
      )}

      {companion === 'Nova' && (
        <>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Check-ins</p>
          <div className="mt-3"><CheckinSettings /></div>
        </>
      )}

      <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Connections</p>
      <div className="mt-3">
        {companion === null
          ? <div aria-busy="true" aria-label="Loading settings" className="h-40 animate-pulse rounded-3xl border border-white/5 bg-white/3" />
          : <TelegramSettings companion={companion} />}
      </div>

      {/* For every account, whichever companion it uses. */}
      <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Account</p>
      <div className="mt-3"><DeleteAccountSection /></div>
    </div>
  )
}

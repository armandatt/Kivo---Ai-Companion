'use client'

import { useEffect, useState } from 'react'
import { TelegramSettings } from '@/components/nova/telegram-connect'

// Settings. One section so far: the Telegram connection.
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-sm text-foreground/55">Where you reach {companion ?? 'your companion'}, and how.</p>
      </header>

      <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Connections</p>
      <div className="mt-3">
        {companion === null
          ? <div aria-busy="true" aria-label="Loading settings" className="h-40 animate-pulse rounded-3xl border border-white/5 bg-white/3" />
          : <TelegramSettings companion={companion} />}
      </div>
    </div>
  )
}

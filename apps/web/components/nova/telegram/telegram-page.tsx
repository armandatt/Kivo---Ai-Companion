'use client'

// Telegram: what Nova will send there, what happened to what it sent, and the
// same controls the chat has. Changes made in the chat show here on the next
// read: on focus, and every 30 seconds while the tab is visible.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, BellOff, CalendarClock, Check, Loader2, Send } from 'lucide-react'
import type { NovaTelegramPage, TelegramPageAction, TelegramUpcoming } from '@repo/api/nova/product/telegram-page.types'
import { cn } from '@/lib/utils'
import { ConnectAction } from '@/components/nova/telegram-connect'
import { useTelegramLink } from '@/components/nova/use-telegram-link'
import { changeTelegram, loadTelegramPage } from './telegram-page-api'

const REFRESH_MS = 30_000
const ghost = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/12 px-3 text-sm text-foreground/85 transition-colors hover:bg-white/5 disabled:opacity-50'
const primary = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-keppel-400 px-3 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50'

const SOURCE: Record<TelegramUpcoming['source'], string> = { day_plan: 'Day plan', personal: 'Personal reminders', mentor_checkin: 'Mentor check-in' }

function when(iso: string, zone: string | null): string {
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(zone ? { timeZone: zone } : {}) }).format(d)
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(zone ? { timeZone: zone } : {}) }).format(new Date())
  return `${day === today ? 'Today' : day}, ${new Intl.DateTimeFormat('en-US', opts).format(d)}`
}

export function TelegramPage() {
  const [page, setPage] = useState<NovaTelegramPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const link = useTelegramLink()

  const refresh = useCallback(async () => {
    const r = await loadTelegramPage()
    if ('error' in r) setError(r.error); else { setPage(r); setError(null) }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    const t = setInterval(onFocus, REFRESH_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [refresh])
  // Connected just now from this page: read it again.
  useEffect(() => { if (link.connection?.connected && page && !page.connected) void refresh() }, [link.connection, page, refresh])

  const act = async (key: string, action: TelegramPageAction, said: string) => {
    setBusy(key); setNote(null)
    const r = await changeTelegram(action)
    setBusy(null)
    setNote(r.ok ? said : r.message)
    await refresh()
  }

  if (error && !page) return <p role="alert" className="text-sm text-red-300">{error}</p>
  if (!page) return <div aria-busy="true" aria-label="Loading Telegram" className="h-40 animate-pulse rounded-3xl bg-white/4" />
  const zone = page.timezone
  const groups = (['day_plan', 'personal', 'mentor_checkin'] as const).map(s => ({ source: s, items: page.upcoming.filter(u => u.source === s) }))

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/4"><Send className="size-5 text-keppel-300" /></div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Telegram</h1>
              <p className="mt-1 text-sm text-foreground/65">
                {page.connected ? (page.undeliverableSince ? 'Connected, but Telegram is refusing messages (the bot may be blocked).' : 'Connected.') : 'Not connected.'}
                {' '}Timezone: {zone ?? 'not set yet, so Nova won’t message first'}.
              </p>
              <p className="mt-1 text-sm text-foreground/65">
                Next: {page.nextDelivery ? <>{page.nextDelivery.title} · {when(page.nextDelivery.at, zone)}</> : 'nothing scheduled.'}
              </p>
            </div>
          </div>
          {page.connected
            ? link.connection?.botUrl && <a href={link.connection.botUrl} target="_blank" rel="noopener noreferrer" className={ghost}>Open Telegram <ArrowRight className="size-4" /></a>
            : <ConnectAction link={link} />}
        </div>
        {page.undeliverableSince && (
          <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="size-4" /> Undeliverable since {when(page.undeliverableSince, zone)}. Open the chat and press Start to receive messages again.
          </p>
        )}
        {!page.sendsOn && <p className="mt-4 text-sm text-foreground/55">Automatic messages are switched off for everyone right now. Chat and buttons still work.</p>}
      </header>

      <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8" aria-labelledby="tg-controls">
        <h2 id="tg-controls" className="text-base font-semibold">What Nova sends</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {page.planFeature && (
            <button type="button" disabled={!page.connected || busy !== null} className={page.planNotifications ? ghost : primary}
              onClick={() => void act('plan', { action: 'plan_notifications', enabled: !page.planNotifications }, page.planNotifications ? 'Plan notifications off.' : 'Plan notifications on. Only an applied plan is sent.')}>
              {page.planNotifications ? 'Plan notifications: on · Turn off' : 'Turn on plan notifications'}
            </button>
          )}
          <button type="button" disabled={busy !== null} className={ghost}
            onClick={() => void act('nudges', { action: 'nudges', enabled: !page.nudgesOn }, page.nudgesOn ? 'Nudges off.' : 'Nudges on.')}>
            {page.nudgesOn ? 'Nudges: on · Turn off' : 'Turn nudges on'}
          </button>
          {page.pause ? (
            <button type="button" disabled={busy !== null} className={primary} onClick={() => void act('resume', { action: 'resume' }, 'Resumed.')}>Resume</button>
          ) : (
            <>
              <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act('pause-plan', { action: 'pause', scope: 'plan' }, 'Plan prompts and nudges paused until midnight.')}><BellOff className="size-4" /> Pause plan nudges today</button>
              <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act('pause-all', { action: 'pause', scope: 'all' }, 'Everything paused until midnight.')}><BellOff className="size-4" /> Pause all today</button>
            </>
          )}
        </div>
        {page.pause && (
          <p className="mt-3 text-sm text-foreground/65">
            Paused: {page.pause.scope === 'all' ? 'everything' : page.pause.scope === 'plan' ? 'plan prompts and nudges (your reminders still come)' : 'nudges'} until {when(page.pause.until, zone)}.
          </p>
        )}
        <p className="mt-3 text-xs text-foreground/45">At most two nudges a day, never 11pm to 7am unless you chose that time. Times you set are always kept.</p>
        {note && <p role="status" className="mt-3 text-sm text-keppel-200">{note}</p>}
      </section>

      <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8" aria-labelledby="tg-upcoming">
        <h2 id="tg-upcoming" className="text-base font-semibold">Upcoming</h2>
        <div className="mt-4 space-y-5">
          {groups.map(g => (
            <div key={g.source}>
              <h3 className="text-xs font-medium uppercase tracking-wider text-foreground/45">{SOURCE[g.source]}</h3>
              {g.items.length === 0 ? (
                <p className="mt-2 text-sm text-foreground/50">
                  {g.source === 'day_plan' ? (page.planNotifications ? 'Nothing scheduled. Apply a plan with times on Today.' : 'Plan notifications are off.')
                    : g.source === 'personal' ? <>None. <a href="/calendar" className="text-keppel-300 underline-offset-2 hover:underline">Add one on the Calendar</a>.</>
                    : 'No daily check-in time chosen.'}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-white/6">
                  {g.items.map(u => (
                    <li key={`${u.source}:${u.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{u.title}</p>
                        <p className="text-xs text-foreground/50">
                          {u.at ? when(u.at, zone) : 'Daily'}{u.state === 'snoozed' ? ' · snoozed' : u.state === 'failed' ? ' · retrying' : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {u.canSnooze && <>
                          <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act(`s15:${u.id}`, { action: 'snooze', id: u.id, minutes: 15 }, 'Snoozed 15 minutes.')}>+15 min</button>
                          <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act(`s60:${u.id}`, { action: 'snooze', id: u.id, minutes: 60 }, 'Snoozed 1 hour.')}>+1 hour</button>
                        </>}
                        {u.canCancel && <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act(`k:${u.id}`, { action: 'skip', id: u.id }, 'Skipped for today. The block stays on your plan.')}>Skip</button>}
                        {u.source === 'personal' && <a href="/calendar" className={ghost}><CalendarClock className="size-4" /> Edit</a>}
                        {busy?.endsWith(u.id) && <Loader2 className="size-4 animate-spin self-center" />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8" aria-labelledby="tg-recent">
        <h2 id="tg-recent" className="text-base font-semibold">Recent</h2>
        {page.recent.length === 0 ? <p className="mt-3 text-sm text-foreground/50">Nothing sent in the last three days.</p> : (
          <ul className="mt-3 divide-y divide-white/6">
            {page.recent.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="truncate text-sm">{r.title}</p><p className="text-xs text-foreground/50">{when(r.at, zone)}</p></div>
                <span className={cn('shrink-0 text-xs', r.status === 'started' ? 'text-keppel-300' : r.status === 'undeliverable' || r.status === 'failed' ? 'text-amber-300' : 'text-foreground/55')}>
                  {r.status === 'started' && <Check className="mr-1 inline size-3" />}{r.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {page.credits && (
        <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8" aria-labelledby="tg-usage">
          <h2 id="tg-usage" className="text-base font-semibold">Nova usage</h2>
          <p className="mt-1 text-sm text-foreground/65">Ask Nova · 1 credit per successful AI interaction. Buttons, reminders and commands use none.</p>
          {page.credits.limit !== null && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuemin={0} aria-valuemax={page.credits.limit} aria-valuenow={page.credits.used}>
                <div className="h-full rounded-full bg-keppel-400" style={{ width: `${Math.min(100, (page.credits.used / Math.max(1, page.credits.limit)) * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-foreground/55">
                {page.credits.used} of {page.credits.limit} this month{page.credits.resetsAt ? ` · renews ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(page.credits.resetsAt))}` : ''}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

'use client'

// Telegram: what Nova will send there, what happened to what it sent, and the
// same controls the chat has. Changes made in the chat show here on the next
// read: on focus, and every 30 seconds while the tab is visible.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, BellRing, CalendarClock, Check, Clock, Loader2, MessageCircle, Pause, Play, Send, Sparkles } from 'lucide-react'
import type { NovaTelegramPage, TelegramPageAction, TelegramUpcoming } from '@repo/api/nova/product/telegram-page.types'
import { cn } from '@/lib/utils'
import { ConnectAction } from '@/components/nova/telegram-connect'
import { useTelegramLink } from '@/components/nova/use-telegram-link'
import { changeTelegram, loadTelegramPage } from './telegram-page-api'

const REFRESH_MS = 30_000
const card = 'rounded-3xl border border-border/70 bg-card/80 shadow-sm'
const chip = 'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-foreground/70'
const ghost = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border/80 px-3 text-sm text-foreground/80 transition-colors hover:bg-foreground/5 disabled:opacity-50'

const SOURCE: Record<TelegramUpcoming['source'], { label: string; dot: string }> = {
  day_plan:       { label: 'Day plan',          dot: 'bg-keppel-400' },
  personal:       { label: 'Your reminder',     dot: 'bg-amber-400' },
  mentor_checkin: { label: 'Check-in',          dot: 'bg-violet-400' },
}

const fmt = (iso: string, zone: string | null, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso))
const time = (iso: string, zone: string | null) => fmt(iso, zone, { hour: 'numeric', minute: '2-digit' })
function day(iso: string, zone: string | null): string {
  const d = fmt(iso, zone, { weekday: 'short', month: 'short', day: 'numeric' })
  return d === fmt(new Date().toISOString(), zone, { weekday: 'short', month: 'short', day: 'numeric' }) ? 'Today' : d
}

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40', on ? 'bg-keppel-400' : 'bg-foreground/15')}>
      <span className={cn('inline-block size-5 rounded-full bg-[#ffffff] shadow transition-transform motion-reduce:transition-none', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

// A Telegram chat, drawn with what Nova would really send next (or an example,
// said to be one): the reason the page exists.
function PhonePreview({ page }: { page: NovaTelegramPage }) {
  const next = page.upcoming.find(u => u.source === 'day_plan' && u.at)
  const example = !next
  const at = next ? time(next.at, page.timezone) : '6:00 PM'
  const title = next?.title ?? 'Operating Systems'
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <div aria-hidden className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-keppel-400/25 via-transparent to-violet-400/20 blur-2xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-border/80 bg-[#17212b] p-3 shadow-xl">
        <div className="flex items-center gap-2 border-b border-[#ffffff14] px-2 pb-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-keppel-400 text-xs font-bold text-keppel-950">N</div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-[#ffffff]">Nova · Kivo</p>
            <p className="text-[11px] text-keppel-300">bot</p>
          </div>
        </div>
        <div className="space-y-2 px-1 pb-1 pt-3" aria-label={example ? 'Example message' : 'Your next plan message'}>
          <div className="w-[88%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[13px] leading-snug text-[#e9eef3] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
            {at} · Your plan: {title}. Ready to start?
            <span className="mt-1 block text-right text-[10px] text-[#8a9aab]">{at}</span>
          </div>
          <div className="grid w-[88%] grid-cols-1 gap-1 motion-safe:animate-in motion-safe:fade-in motion-safe:delay-200 motion-safe:duration-700 motion-safe:fill-mode-both">
            {['Start 25 min', 'Remind me later', 'Skip this block'].map(b => (
              <span key={b} className="rounded-lg bg-[#2b5278]/70 py-1.5 text-center text-[12px] font-medium text-[#ffffff]">{b}</span>
            ))}
          </div>
          <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-[#2b5278] px-3 py-2 text-[13px] text-[#ffffff] motion-safe:animate-in motion-safe:fade-in motion-safe:delay-500 motion-safe:duration-700 motion-safe:fill-mode-both">
            Started · Running: {title}
          </div>
        </div>
      </div>
      {example && <p className="relative mt-3 text-center text-xs text-foreground/45">Example · apply a plan with times on Today to see yours</p>}
    </div>
  )
}

function Tile({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <div className={cn(card, 'flex flex-col gap-3 p-5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-keppel-400/12 text-keppel-500 dark:text-keppel-300">{icon}</div>
        {children}
      </div>
      <div>
        <p className="font-semibold tracking-tight">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground/60">{body}</p>
      </div>
    </div>
  )
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

  if (error && !page) return <p role="alert" className="text-sm text-red-500">{error}</p>
  if (!page) return <div aria-busy="true" aria-label="Loading Telegram" className="h-72 animate-pulse rounded-3xl bg-foreground/5" />
  const zone = page.timezone
  const timeline = page.upcoming.filter(u => u.at)
  const daily = page.upcoming.filter(u => !u.at)

  return (
    <div className="space-y-6">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className={cn(card, 'relative overflow-hidden p-6 sm:p-10')}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-keppel-400/10 blur-3xl" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-keppel-600 dark:text-keppel-300"><Send className="size-4" /> Nova on Telegram</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Your plan, where you already are.</h1>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-foreground/65">
              Each block of your plan arrives at its time with one tap to start. Snooze it, skip it or pause the day. Your Focus timer, plan and progress stay in sync with Kivo.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className={chip}>
                <span className={cn('size-2 rounded-full', page.connected ? (page.undeliverableSince ? 'bg-amber-400' : 'bg-keppel-400') : 'bg-foreground/30')} />
                {page.connected ? (page.undeliverableSince ? 'Not receiving' : 'Connected') : 'Not connected'}
              </span>
              <span className={chip}><Clock className="size-3.5" /> {zone ?? 'Timezone not set'}</span>
              {page.nextDelivery && <span className={chip}><BellRing className="size-3.5" /> Next: {day(page.nextDelivery.at, zone)}, {time(page.nextDelivery.at, zone)}</span>}
            </div>
            <div className="mt-7">
              {page.connected
                ? link.connection?.botUrl && (
                  <a href={link.connection.botUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
                    Open Telegram <ArrowRight className="size-4" />
                  </a>)
                : <ConnectAction link={link} />}
            </div>
            {page.undeliverableSince && (
              <p className="mt-5 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Telegram has refused messages since {day(page.undeliverableSince, zone)}. The bot may be blocked. Open the chat and press Start.
              </p>
            )}
            {!page.sendsOn && <p className="mt-4 text-sm text-foreground/55">Automatic messages are paused for everyone right now. Chat and buttons still work.</p>}
          </div>
          <PhonePreview page={page} />
        </div>
      </section>

      {/* ── What Nova sends ──────────────────────────────────────────────── */}
      <section aria-labelledby="tg-sends" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="tg-sends" className="text-lg font-semibold tracking-tight">What Nova sends</h2>
          {page.pause ? (
            <button type="button" disabled={busy !== null} onClick={() => void act('resume', { action: 'resume' }, 'Resumed.')}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 hover:bg-keppel-300 disabled:opacity-50">
              <Play className="size-4" /> Resume
            </button>
          ) : (
            <div className="inline-flex rounded-xl border border-border/80 p-1">
              <button type="button" disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-foreground/75 hover:bg-foreground/5" onClick={() => void act('pause-plan', { action: 'pause', scope: 'plan' }, 'Plan prompts and nudges paused until midnight.')}><Pause className="size-3.5" /> Pause plan today</button>
              <button type="button" disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-foreground/75 hover:bg-foreground/5" onClick={() => void act('pause-all', { action: 'pause', scope: 'all' }, 'Everything paused until midnight.')}><Pause className="size-3.5" /> Pause all today</button>
            </div>
          )}
        </div>
        {page.pause && (
          <p className="rounded-2xl border border-keppel-400/30 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/75">
            Paused: {page.pause.scope === 'all' ? 'everything' : page.pause.scope === 'plan' ? 'plan prompts and nudges (your reminders still come)' : 'nudges'} until {time(page.pause.until, zone)}.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          {page.planFeature && (
            <Tile icon={<Sparkles className="size-5" />} title="Plan notifications"
              body={page.connected ? 'Each block of a plan you applied, at its time. Untimed blocks come at your check-in. Drafts send nothing.' : 'Connect Telegram to turn these on.'}>
              <Switch on={page.planNotifications} disabled={!page.connected || busy !== null} label="Plan notifications"
                onChange={() => void act('plan', { action: 'plan_notifications', enabled: !page.planNotifications }, page.planNotifications ? 'Plan notifications off.' : 'Plan notifications on.')} />
            </Tile>
          )}
          <Tile icon={<MessageCircle className="size-5" />} title="Nudges"
            body="At most two a day, when something is due. Never 11pm to 7am unless you chose that time.">
            <Switch on={page.nudgesOn} disabled={busy !== null} label="Nudges"
              onChange={() => void act('nudges', { action: 'nudges', enabled: !page.nudgesOn }, page.nudgesOn ? 'Nudges off.' : 'Nudges on.')} />
          </Tile>
          <Tile icon={<CalendarClock className="size-5" />} title="Your reminders"
            body="Send /remind in the chat, or add one on the Calendar. They come at the exact time you set.">
            <a href="/calendar" className={ghost}>Calendar</a>
          </Tile>
        </div>
        {note && <p role="status" className="text-sm text-keppel-600 dark:text-keppel-300">{note}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Upcoming ─────────────────────────────────────────────────────── */}
        <section className={cn(card, 'p-6')} aria-labelledby="tg-upcoming">
          <h2 id="tg-upcoming" className="text-lg font-semibold tracking-tight">Coming up</h2>
          {timeline.length === 0 ? (
            <p className="mt-4 text-sm text-foreground/55">
              {page.planNotifications ? 'Nothing scheduled. Apply a plan with times on Today and each block appears here.' : 'Nothing scheduled. Turn on plan notifications, or add a reminder.'}
            </p>
          ) : (
            <ol className="relative mt-5 space-y-4 border-l border-border/80 pl-5">
              {timeline.map(u => (
                <li key={`${u.source}:${u.id}`} className="relative">
                  <span className={cn('absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-card', SOURCE[u.source].dot)} />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-foreground/50">{day(u.at, zone)} · {time(u.at, zone)} · {SOURCE[u.source].label}{u.state === 'snoozed' ? ' · snoozed' : u.state === 'failed' ? ' · retrying' : ''}</p>
                      <p className="mt-0.5 truncate font-medium">{u.title}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {u.canSnooze && <>
                        <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act(`s15:${u.id}`, { action: 'snooze', id: u.id, minutes: 15 }, 'Snoozed 15 minutes.')}>+15m</button>
                        <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act(`s60:${u.id}`, { action: 'snooze', id: u.id, minutes: 60 }, 'Snoozed 1 hour.')}>+1h</button>
                      </>}
                      {u.canCancel && <button type="button" disabled={busy !== null} className={ghost} onClick={() => void act(`k:${u.id}`, { action: 'skip', id: u.id }, 'Skipped for today. The block stays on your plan.')}>Skip</button>}
                      {u.source === 'personal' && <a href="/calendar" className={ghost}>Edit</a>}
                      {busy?.endsWith(u.id) && <Loader2 className="size-4 animate-spin" />}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {daily.map(d => (
            <p key={d.id} className="mt-5 flex items-center gap-2 text-sm text-foreground/60"><span className={cn('size-2 rounded-full', SOURCE[d.source].dot)} /> {d.title}</p>
          ))}
        </section>

        <div className="space-y-6">
          {/* ── Recent ───────────────────────────────────────────────────── */}
          <section className={cn(card, 'p-6')} aria-labelledby="tg-recent">
            <h2 id="tg-recent" className="text-lg font-semibold tracking-tight">Recent</h2>
            {page.recent.length === 0 ? <p className="mt-4 text-sm text-foreground/55">Nothing sent in the last three days.</p> : (
              <ul className="mt-4 space-y-3">
                {page.recent.map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{r.title}</p><p className="text-xs text-foreground/50">{day(r.at, zone)} · {time(r.at, zone)}</p></div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                      r.status === 'started' ? 'bg-keppel-400/15 text-keppel-700 dark:text-keppel-200'
                        : r.status === 'undeliverable' || r.status === 'failed' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                        : 'bg-foreground/8 text-foreground/60')}>
                      {r.status === 'started' && <Check className="mr-1 inline size-3" />}{r.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Usage ────────────────────────────────────────────────────── */}
          {page.credits && (
            <section className={cn(card, 'p-6')} aria-labelledby="tg-usage">
              <h2 id="tg-usage" className="text-lg font-semibold tracking-tight">Nova usage</h2>
              <p className="mt-1 text-sm text-foreground/60">Ask Nova · 1 credit per successful AI interaction. Buttons, reminders and commands are free.</p>
              {page.credits.limit !== null && (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-foreground/8" role="progressbar" aria-label="Nova credits used" aria-valuemin={0} aria-valuemax={page.credits.limit} aria-valuenow={page.credits.used}>
                    <div className="h-full rounded-full bg-gradient-to-r from-keppel-400 to-keppel-300 transition-[width] duration-700" style={{ width: `${Math.min(100, (page.credits.used / Math.max(1, page.credits.limit)) * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-foreground/55">
                    {page.credits.used} of {page.credits.limit} this month{page.credits.resetsAt ? ` · renews ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(page.credits.resetsAt))}` : ''}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

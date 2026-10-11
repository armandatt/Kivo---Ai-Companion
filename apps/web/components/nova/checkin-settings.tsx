'use client'

import { useEffect, useState } from 'react'
import { BellRing, Check } from 'lucide-react'

type Style = 'soft' | 'hard'
type Loaded = { checkInTime: string | null; accountabilityStyle: string | null; telegram: boolean }

const STYLES: Array<{ value: Style; label: string; body: string }> = [
  { value: 'soft', label: 'Gentle Nudges', body: 'Calm and supportive. Smaller steps, no pressure after a missed day.' },
  { value: 'hard', label: 'No Mercy',      body: 'Direct and brief. Points at the next thing to do and expects it done.' },
]

// The two things onboarding asked that shape how Nova messages first on
// Telegram: when the daily check-in comes, and how firmly Nova speaks. Both
// are stored on the account; Nova reads them from there. Neither changes what
// Nova recommends, only when it speaks first and in what manner.
export function CheckinSettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [time, setTime]     = useState('')
  const [style, setStyle]   = useState<Style | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote]     = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { checkInTime?: string | null; accountabilityStyle?: string | null; platforms?: { telegram?: { connected?: boolean } } }) => {
        if (!live) return
        const now: Loaded = { checkInTime: d.checkInTime ?? null, accountabilityStyle: d.accountabilityStyle ?? null, telegram: d.platforms?.telegram?.connected === true }
        setLoaded(now)
        setTime(now.checkInTime ?? '')
        setStyle(now.accountabilityStyle === 'hard' ? 'hard' : now.accountabilityStyle === 'soft' ? 'soft' : null)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  async function save(next: { checkInTime?: string | null; accountabilityStyle?: Style }) {
    setSaving(true); setNote(null)
    try {
      const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) })
      if (!res.ok) throw new Error(String(res.status))
      setLoaded(prev => prev ? {
        ...prev,
        checkInTime: next.checkInTime !== undefined ? next.checkInTime : prev.checkInTime,
        accountabilityStyle: next.accountabilityStyle ?? prev.accountabilityStyle,
      } : prev)
      setNote({ ok: true, text: 'Saved.' })
    } catch {
      setNote({ ok: false, text: "That didn't save. Try again." })
    } finally {
      setSaving(false)
    }
  }

  if (failed) {
    return (
      <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6">
        <p className="text-sm text-foreground/65">Couldn&apos;t load your check-in settings. Reload the page to try again.</p>
      </section>
    )
  }
  if (!loaded) return <div aria-busy="true" aria-label="Loading check-in settings" className="h-48 animate-pulse rounded-3xl border border-white/5 bg-white/3" />

  const timeChanged = time !== (loaded.checkInTime ?? '')

  return (
    <section aria-labelledby="checkin-heading" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8" data-section="checkin-settings">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/4">
          <BellRing className="size-5 text-keppel-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="checkin-heading" className="text-lg font-semibold tracking-tight text-foreground">Daily check-in</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
            Nova messages you on Telegram around this time, on days you haven&apos;t studied yet. If it can&apos;t reach you then, it tries for up to three hours and then leaves it for the day.
          </p>

          <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void save({ checkInTime: time || null }) }}>
            <div>
              <label htmlFor="checkin-time" className="block text-xs font-medium text-foreground/60">Time, in your timezone</label>
              <input
                id="checkin-time" type="time" value={time} onChange={e => { setTime(e.target.value); setNote(null) }}
                className="mt-1.5 h-11 rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground"
                data-checkin-time
              />
            </div>
            <button type="submit" disabled={saving || !timeChanged} className="inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50" data-checkin-save>
              {saving ? 'Saving…' : 'Save time'}
            </button>
            {loaded.checkInTime && (
              <button type="button" disabled={saving} onClick={() => { setTime(''); void save({ checkInTime: null }) }} className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-4 text-sm text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-50" data-checkin-clear>
                No fixed time
              </button>
            )}
          </form>
          <p className="mt-3 text-xs leading-relaxed text-foreground/45">
            {loaded.checkInTime
              ? 'With no fixed time, Nova nudges around the time you usually study instead.'
              : 'No time is set, so Nova nudges around the time you usually study.'}
            {' '}To stop Nova messaging first altogether, send /settings to it on Telegram.
          </p>
          {!loaded.telegram && (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs leading-relaxed text-foreground/75" data-checkin-needs-telegram>
              Telegram isn&apos;t connected, so no check-in can be sent yet. Connect it below.
            </p>
          )}

          <fieldset className="mt-7">
            <legend className="text-xs font-medium text-foreground/60">How Nova talks to you</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {STYLES.map(option => {
                const active = style === option.value
                return (
                  <button
                    key={option.value} type="button" disabled={saving} aria-pressed={active}
                    onClick={() => { setStyle(option.value); void save({ accountabilityStyle: option.value }) }}
                    className={`rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${active ? 'border-keppel-400/60 bg-keppel-400/8' : 'border-white/10 hover:border-white/20'}`}
                    data-style={option.value}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                      {option.label}
                      {active && <Check className="size-4 text-keppel-300" aria-hidden />}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-foreground/60">{option.body}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-foreground/45">
              This changes Nova&apos;s manner, not its advice: the same plan, the same dates. Either way it turns serious when an exam is close or something is weighing on you.
            </p>
          </fieldset>

          {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${note.ok ? 'text-keppel-300' : 'text-amber-300/90'}`} data-checkin-note>{note.text}</p>}
        </div>
      </div>
    </section>
  )
}

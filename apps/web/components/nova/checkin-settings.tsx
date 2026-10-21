'use client'

import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'

type Loaded = { checkInTime: string | null; telegram: boolean }

// When the daily check-in comes on Telegram. Stored on the account; Nova
// reads it from there. It changes when Nova speaks first, never what it
// recommends. How Nova talks (its tone) is set under "How Nova helps you".
export function CheckinSettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [time, setTime]     = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote]     = useState<{ ok: boolean; text: string } | null>(null)
  // The timezone Nova keeps the learner's days in, and the one this device is on.
  const [zone, setZone]     = useState<{ stored: string | null; device: string | null }>({ stored: null, device: null })

  useEffect(() => {
    let live = true
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { checkInTime?: string | null; platforms?: { telegram?: { connected?: boolean } } }) => {
        if (!live) return
        const now: Loaded = { checkInTime: d.checkInTime ?? null, telegram: d.platforms?.telegram?.connected === true }
        setLoaded(now)
        setTime(now.checkInTime ?? '')
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  // Asks which timezone Nova has for this learner. The request reports this
  // device's zone, which Nova stores only if it has none: the same report the
  // dashboard makes on every visit.
  useEffect(() => {
    let live = true
    let device: string | null = null
    try { device = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { device = null }
    if (!device) return
    fetch('/api/nova/timezone', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone: device }) })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean; timezone?: string } | null) => { if (live) setZone({ stored: d?.ok && d.timezone ? d.timezone : null, device }) })
      .catch(() => { if (live) setZone({ stored: null, device }) })
    return () => { live = false }
  }, [])

  // The learner's own choice: the one thing that moves a timezone on record.
  async function switchToDeviceZone() {
    if (!zone.device) return
    setSaving(true); setNote(null)
    try {
      const res = await fetch('/api/nova/timezone', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone: zone.device, replace: true }) })
      const d = await res.json().catch(() => null) as { ok?: boolean; timezone?: string } | null
      if (!res.ok || !d?.ok || !d.timezone) throw new Error(String(res.status))
      setZone(prev => ({ ...prev, stored: d.timezone! }))
      setNote({ ok: true, text: `Timezone changed to ${d.timezone}.` })
    } catch {
      setNote({ ok: false, text: "The timezone didn't change. Try again." })
    } finally {
      setSaving(false)
    }
  }

  async function save(next: { checkInTime: string | null }) {
    setSaving(true); setNote(null)
    try {
      const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) })
      if (!res.ok) throw new Error(String(res.status))
      setLoaded(prev => prev ? {
        ...prev,
        checkInTime: next.checkInTime,
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
          {zone.stored && (
            <p className="mt-3 text-xs leading-relaxed text-foreground/60" data-checkin-timezone>
              Your days and this time are kept in <span className="font-medium text-foreground/80">{zone.stored}</span>.
              {zone.device && zone.device !== zone.stored && (
                <>
                  {' '}This device is on {zone.device}.{' '}
                  <button type="button" disabled={saving} onClick={() => void switchToDeviceZone()} className="font-medium text-keppel-300 underline underline-offset-2 disabled:opacity-50" data-use-device-zone>
                    Use {zone.device}
                  </button>
                </>
              )}
            </p>
          )}
          {!loaded.telegram && (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs leading-relaxed text-foreground/75" data-checkin-needs-telegram>
              Telegram isn&apos;t connected, so no check-in can be sent yet. Connect it below.
            </p>
          )}


          {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${note.ok ? 'text-keppel-300' : 'text-amber-300/90'}`} data-checkin-note>{note.text}</p>}
        </div>
      </div>
    </section>
  )
}

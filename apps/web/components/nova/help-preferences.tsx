'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import {
  FIRST_FOCUS_DETAIL_MAX, audienceOf, firstFocusOptions, type FirstFocus, type FirstFocusId,
} from '@repo/api/nova/product/first-focus'
import { COMPANION_NAME_MAX, DEFAULT_COMPANION_NAME } from '@repo/api/nova/product/onboarding-answers'
import { STYLE_QUESTIONS, type StyleDimension } from '@repo/api/personality/style-items'
import { BUTTON_PRIMARY } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'

// The onboarding answers a learner can correct after onboarding, besides
// those with their own place (what they are learning for: the setup page;
// how firmly Nova speaks: Check-ins). Each part saves on its own: the
// companion's name and first focus through PATCH /api/settings, the three
// preferences through POST /api/personality.

type Loaded = {
  companionName: string
  firstFocus:    FirstFocus | null
  contexts:      string[]
  style:         Partial<Record<StyleDimension, string>>
}

const FIELD = 'h-10 w-full rounded-xl border border-white/10 bg-white/4 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-action'
const LABEL = 'mb-1.5 block text-xs font-medium text-foreground/60'

function Saved({ note }: { note: { ok: boolean; text: string } | null }) {
  if (!note) return null
  return (
    <p role={note.ok ? 'status' : 'alert'} className={cn('flex items-center gap-1.5 text-sm', note.ok ? 'text-action-ink' : 'text-red-500')}>
      {note.ok && <Check aria-hidden className="size-4" />}{note.text}
    </p>
  )
}

export function HelpPreferences() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [name, setName]     = useState('')
  const [focus, setFocus]   = useState<FirstFocusId | ''>('')
  const [detail, setDetail] = useState('')
  const [style, setStyle]   = useState<Partial<Record<StyleDimension, string>>>({})
  const [busy, setBusy]     = useState<'about' | 'style' | null>(null)
  const [aboutNote, setAboutNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [styleNote, setStyleNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      fetch('/api/settings', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch('/api/personality', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ])
      .then(([settings, personality]: [
        { companionName?: string; firstFocus?: FirstFocus | null; learningContexts?: string[] },
        { style?: { choices?: Record<StyleDimension, string> | null } },
      ]) => {
        if (!live) return
        const now: Loaded = {
          companionName: settings.companionName || DEFAULT_COMPANION_NAME,
          firstFocus:    settings.firstFocus ?? null,
          contexts:      settings.learningContexts ?? [],
          style:         personality.style?.choices ?? {},
        }
        setLoaded(now)
        setName(now.companionName)
        setFocus(now.firstFocus?.id ?? '')
        setDetail(now.firstFocus?.detail ?? '')
        setStyle(now.style)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  if (failed) return <p role="status" className="rounded-3xl border border-white/8 bg-card/70 p-6 text-sm text-foreground/65">These settings didn&apos;t load. Reload the page to try again.</p>
  if (!loaded) return <div aria-busy="true" aria-label="Loading your preferences" className="h-72 animate-pulse rounded-3xl border border-white/5 bg-white/3" />

  const options = firstFocusOptions(audienceOf(loaded.contexts))
  const styleComplete = STYLE_QUESTIONS.every(q => style[q.id] !== undefined)

  async function saveAbout() {
    setBusy('about'); setAboutNote(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companionName: name, firstFocus: focus ? { id: focus, detail: detail.trim() || null } : null }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setAboutNote({ ok: false, text: data?.error ?? "That didn't save. Try again." }); return }
      setAboutNote({ ok: true, text: 'Saved' })
    } catch {
      setAboutNote({ ok: false, text: "Couldn't reach Kivo. Try again." })
    } finally {
      setBusy(null)
    }
  }

  async function saveStyle() {
    setBusy('style'); setStyleNote(null)
    try {
      const res = await fetch('/api/personality', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style }),
      })
      setStyleNote(res.ok ? { ok: true, text: 'Saved. Nova uses this from your next message.' } : { ok: false, text: "That didn't save. Try again." })
    } catch {
      setStyleNote({ ok: false, text: "Couldn't reach Kivo. Try again." })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/8 bg-card/70 p-6">
        <h2 className="text-base font-semibold text-foreground">Your companion and first focus</h2>
        <p className="mt-1 text-sm text-foreground/60">The name is what Kivo calls your companion on its pages. What you want help with first decides which templates setup shows first.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pref-name" className={LABEL}>Companion name</label>
            <input id="pref-name" value={name} maxLength={COMPANION_NAME_MAX} onChange={e => setName(e.target.value)} placeholder={DEFAULT_COMPANION_NAME} className={FIELD} />
          </div>
          <div>
            <label htmlFor="pref-focus" className={LABEL}>Help with first</label>
            <select id="pref-focus" value={focus} onChange={e => setFocus(e.target.value as FirstFocusId | '')} className={FIELD}>
              <option value="">Not said</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          {focus && (
            <div className="sm:col-span-2">
              <label htmlFor="pref-detail" className={LABEL}>{focus === 'other' ? 'In a sentence' : 'Anything specific (optional)'}</label>
              <input id="pref-detail" value={detail} maxLength={FIRST_FOCUS_DETAIL_MAX} onChange={e => setDetail(e.target.value)} className={FIELD} />
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-subtle">Your goals are edited on the study page; changing this does not rewrite them.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void saveAbout()} disabled={busy !== null || (focus === 'other' && !detail.trim())} className={BUTTON_PRIMARY}>
            {busy === 'about' ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Saving…</> : 'Save'}
          </button>
          <Saved note={aboutNote} />
        </div>
      </section>

      <section className="rounded-3xl border border-white/8 bg-card/70 p-6">
        <h2 className="text-base font-semibold text-foreground">How you like to be helped</h2>
        <p className="mt-1 text-sm text-foreground/60">Shapes how Nova words its replies. Asking for something different in a message always wins.</p>
        <div className="mt-5 space-y-5">
          {STYLE_QUESTIONS.map(q => (
            <fieldset key={q.id}>
              <legend className="text-sm font-medium text-foreground/85">{q.question}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {q.options.map(o => {
                  const on = style[q.id] === o.value
                  return (
                    <label key={o.value} title={o.hint}
                      className={cn('cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                        on ? 'border-action bg-action-soft text-foreground' : 'border-white/10 text-foreground/70 hover:bg-white/5')}>
                      <input type="radio" name={`pref-${q.id}`} value={o.value} checked={on} onChange={() => setStyle(s => ({ ...s, [q.id]: o.value }))} className="sr-only" />
                      {o.label}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void saveStyle()} disabled={busy !== null || !styleComplete} className={BUTTON_PRIMARY}>
            {busy === 'style' ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Saving…</> : 'Save'}
          </button>
          {!styleComplete && <p className="text-xs text-subtle">Answer all three to save.</p>}
          <Saved note={styleNote} />
        </div>
      </section>
    </div>
  )
}

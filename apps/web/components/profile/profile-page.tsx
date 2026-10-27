'use client'

// The learner's profile: who they are professionally, in their own words
// (product/professional-profile.ts), what they are learning for, their record
// on Kivo from Progress, and what is connected. It reads GET /api/settings
// (and /api/nova/progress for a Nova learner) and saves through PATCH
// /api/settings { name, professional }: the page says "Saved" only when the
// server lists the profile as saved. Only the learner sees it; Nova does not
// read it. The Account card shows the account's own address and how it signs
// in, and asks POST /api/settings/password-reset for a reset link to that
// address (the server takes the account from the session, not from here).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, AtSign, BookOpen, Briefcase, CalendarDays, Check, CircleAlert, Clock, ExternalLink, Flame, KeyRound, Link2, Loader2, Lock, MapPin, Pencil, Plus, Send, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react'
import {
  BIO_MAX, HEADLINE_MAX, LINKS_MAX, LOCATION_MAX, ORGANISATION_MAX, SKILLS_MAX, SKILL_MAX,
  checkLink, checkProfessionalProfile, initialsOf, type ProfessionalProfile,
} from '@repo/api/nova/product/professional-profile'
import { AUDIENCE_LABEL, audienceOf } from '@repo/api/nova/product/first-focus'
import { WORKING_ON_LABEL } from '@repo/api/nova/product/onboarding-options'
import type { NovaProgressView } from '@repo/api/nova/product/progress.types'
import { cn } from '@/lib/utils'

type Settings = {
  name: string
  email: string
  image: string | null
  isGoogleOAuth: boolean
  // Absent on an API older than the web app.
  emailVerified?: boolean
  hasPassword?: boolean
  memberSince: string | null
  professional: ProfessionalProfile | null
  persona: string | null
  learningContexts: string[]
  workingOn: { selected: string[]; custom: string[] } | null
  weeklyHours: { hours: number } | null
  platforms?: { telegram?: { connected: boolean } }
}

type Draft = { name: string; headline: string; organisation: string; location: string; bio: string; skills: string[]; links: string[] }
const draftOf = (s: Settings): Draft => ({
  name: s.name, headline: s.professional?.headline ?? '', organisation: s.professional?.organisation ?? '', location: s.professional?.location ?? '',
  bio: s.professional?.bio ?? '', skills: s.professional?.skills ?? [], links: s.professional?.links.map(l => l.url) ?? [],
})

const CARD = 'rounded-3xl border border-white/8 bg-card/70 p-6'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle'
const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const hours = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`)

function Avatar({ name, email, image, size = 'lg' }: { name: string; email: string; image: string | null; size?: 'lg' | 'sm' }) {
  const [broken, setBroken] = useState(false)
  const box = size === 'lg' ? 'size-24 text-3xl sm:size-28 sm:text-4xl' : 'size-10 text-sm'
  return image && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn(box, 'rounded-full object-cover ring-4 ring-background')} />
  ) : (
    <span aria-hidden className={cn(box, 'grid place-items-center rounded-full bg-gradient-to-br from-nova via-action to-nova/50 font-semibold tracking-tight text-action-foreground ring-4 ring-background')}>
      {initialsOf(name, email)}
    </span>
  )
}

function Stat({ icon: Icon, value, label }: { icon: typeof Clock; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-background/40 p-4" data-profile-stat={label}>
      <Icon aria-hidden className="size-4 text-nova-ink" />
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-foreground/60">{label}</p>
    </div>
  )
}

export function ProfilePage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [progress, setProgress] = useState<NovaProgressView | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Settings) => { if (!live) return; setSettings(s); if (s.persona !== 'rex') fetch('/api/nova/progress', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(p => { if (live) setProgress(p) }).catch(() => {}) })
      .catch(() => { if (live) setLoadError(true) })
    return () => { live = false }
  }, [])

  if (loadError) return <div className="mx-auto max-w-5xl pt-10"><p role="alert" className="rounded-2xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">Your profile didn’t load. Refresh to try again.</p></div>
  if (!settings) return <div aria-busy="true" className="mx-auto max-w-5xl space-y-4 pt-10"><div className="h-64 animate-pulse rounded-3xl bg-white/4" /><div className="h-40 animate-pulse rounded-3xl bg-white/4" /></div>

  const p = settings.professional
  const audience = audienceOf(settings.learningContexts)
  const workingOn = [...(settings.workingOn?.selected ?? []).map(id => WORKING_ON_LABEL[id as keyof typeof WORKING_ON_LABEL] ?? id), ...(settings.workingOn?.custom ?? [])]
  const ready = progress && 'status' in progress && progress.status === 'ready' ? progress : null
  const name = settings.name || settings.email.split('@')[0] || 'You'

  return (
    <div className="mx-auto w-full max-w-5xl pb-20 pt-12 lg:pt-4" data-profile>
      {/* ── The card: who they are ─────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[2rem] border border-white/8 bg-card/70" aria-labelledby="profile-name">
        <div aria-hidden className="nova-hero h-28 sm:h-36" style={{ ['--h1' as string]: 179, ['--h2' as string]: 237, ['--h3' as string]: 162 }}>
          <div className="nova-canvas h-full w-full opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        </div>
        <div className="px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4 sm:-mt-14">
            <Avatar name={name} email={settings.email} image={settings.image} />
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 bg-background/60 px-4 text-sm font-medium text-foreground/90 backdrop-blur transition-colors hover:border-nova/50 hover:bg-nova/10" data-profile-edit>
                <Pencil aria-hidden className="size-4" /> Edit profile
              </button>
            )}
          </div>
          <h1 id="profile-name" className="mt-4 text-[1.9rem] font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[2.25rem]">{name}</h1>
          {p?.headline ? <p className="mt-1 text-[17px] text-foreground/80" data-profile-headline>{p.headline}</p>
            : !editing && <button type="button" onClick={() => setEditing(true)} className="mt-1 text-[15px] text-foreground/50 hover:text-nova-ink">Add a headline, like “Backend engineer learning ML”</button>}
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-foreground/60">
            {p?.organisation && <span className="inline-flex items-center gap-1.5"><Briefcase aria-hidden className="size-4" />{p.organisation}</span>}
            {p?.location && <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden className="size-4" />{p.location}</span>}
            {audience && <span className="inline-flex items-center gap-1.5 rounded-full bg-nova/10 px-2.5 py-0.5 font-medium text-nova-ink">{AUDIENCE_LABEL[audience].label}</span>}
            {settings.memberSince && <span className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden className="size-4" />On Kivo since {monthYear(settings.memberSince)}</span>}
          </p>
        </div>
      </section>

      {editing ? (
        <ProfileEditor settings={settings} onCancel={() => setEditing(false)} onSaved={s => { setSettings(s); setEditing(false) }} />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <section className={CARD} aria-labelledby="profile-about">
              <h2 id="profile-about" className={EYEBROW}>About</h2>
              {p?.bio ? <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85" data-profile-bio>{p.bio}</p>
                : <p className="mt-3 text-sm text-foreground/55">A few lines about what you do and what you’re working toward. <button type="button" onClick={() => setEditing(true)} className="font-medium text-nova-ink hover:underline">Write your bio</button></p>}
              {p && p.skills.length > 0 && (
                <>
                  <h3 className={cn(EYEBROW, 'mt-6')}>Skills</h3>
                  <ul className="mt-3 flex flex-wrap gap-2" data-profile-skills>
                    {p.skills.map(s => <li key={s} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-foreground/85">{s}</li>)}
                  </ul>
                </>
              )}
            </section>

            {workingOn.length > 0 && (
              <section className={CARD} aria-labelledby="profile-working">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="profile-working" className={EYEBROW}>What I’m learning for</h2>
                  <Link href="/settings" className="text-xs text-foreground/55 hover:text-foreground">Change</Link>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {workingOn.map(w => <li key={w} className="inline-flex items-center gap-1.5 rounded-xl bg-nova/[0.08] px-3 py-1.5 text-sm text-foreground/90"><Sparkles aria-hidden className="size-3.5 text-nova-ink" />{w}</li>)}
                </ul>
                {settings.weeklyHours && <p className="mt-3 text-xs text-foreground/55">About {settings.weeklyHours.hours} hours a week, as you said at sign-up.</p>}
              </section>
            )}

            {settings.persona !== 'rex' && (
              <section className={CARD} aria-labelledby="profile-record">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="profile-record" className={EYEBROW}>Learning with Kivo</h2>
                  <Link href="/progress" className="inline-flex items-center gap-1 text-xs text-foreground/55 hover:text-foreground">Progress <ArrowRight aria-hidden className="size-3" /></Link>
                </div>
                {ready && ready.overview.sessions > 0 ? (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat icon={Clock} value={hours(ready.overview.learningMinutes)} label="Focused study" />
                      <Stat icon={BookOpen} value={String(ready.overview.sessions)} label="Sessions" />
                      <Stat icon={Flame} value={String(ready.overview.activeDays)} label="Active days this year" />
                      <Stat icon={TrendingUp} value={String(ready.overview.topicsImproved)} label="Topics improving" />
                    </div>
                    {ready.overview.since && <p className="mt-3 text-xs text-foreground/50">From timed sessions of ten minutes or more since {monthYear(ready.overview.since)}.</p>}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-foreground/55">{progress ? 'Your record starts with your first focus session of ten minutes or more.' : 'Loading your record…'}</p>
                )}
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <section className={CARD} aria-labelledby="profile-links">
              <h2 id="profile-links" className={EYEBROW}>Contact and links</h2>
              <ul className="mt-3 space-y-2.5 text-sm">
                <li className="flex items-center gap-2.5 text-foreground/80"><AtSign aria-hidden className="size-4 shrink-0 text-foreground/50" /><span className="truncate">{settings.email}</span></li>
                {p?.links.map(l => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="group flex items-center gap-2.5 text-foreground/85 hover:text-nova-ink" data-profile-link>
                      <Link2 aria-hidden className="size-4 shrink-0 text-foreground/50 group-hover:text-nova-ink" />
                      <span className="min-w-0 flex-1 truncate">{l.label}</span>
                      <ExternalLink aria-hidden className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
              {(!p || p.links.length === 0) && <button type="button" onClick={() => setEditing(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-nova-ink hover:underline"><Plus aria-hidden className="size-3.5" /> Add LinkedIn, GitHub or a portfolio</button>}
            </section>

            <AccountCard settings={settings} />

            <p className="flex items-start gap-2 px-2 text-xs leading-relaxed text-foreground/50" data-profile-private>
              <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Only you can see your profile. Nova doesn’t read it, and nothing in it changes your plan.
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}

// Editing, checked as it is typed by the same rules the server applies.
function ProfileEditor({ settings, onCancel, onSaved }: { settings: Settings; onCancel: () => void; onSaved: (s: Settings) => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(settings))
  const [skill, setSkill] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD(x => ({ ...x, [k]: v })); setError(null) }
  const professional = useMemo(() => ({ headline: d.headline, organisation: d.organisation, location: d.location, bio: d.bio, skills: d.skills, links: d.links.filter(l => l.trim()) }), [d])
  const local = checkProfessionalProfile(professional)
  const linkErrors = d.links.map(l => (l.trim() ? (() => { const c = checkLink(l); return c.ok ? null : c.message })() : null))
  const nameError = !d.name.trim() ? 'Your name can’t be empty.' : d.name.trim().length > 80 ? 'Keep your name under 80 characters.' : null
  const blocked = !local.ok || linkErrors.some(Boolean) || !!nameError

  const addSkill = () => {
    const t = skill.trim()
    if (!t || t.length > SKILL_MAX || d.skills.length >= SKILLS_MAX) return
    // Already there: nothing to add, and the box is cleared.
    if (!d.skills.some(s => s.toLowerCase() === t.toLowerCase())) set('skills', [...d.skills, t])
    setSkill('')
  }

  async function save() {
    if (blocked || saving) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: d.name.trim(), professional }) })
      const body = await res.json().catch(() => null) as { saved?: string[]; error?: string; field?: string } | null
      if (!res.ok || !body?.saved?.includes('professionalProfile')) { setError({ field: body?.field ?? null, message: body?.error ?? 'That didn’t save. Try again.' }); return }
      const fresh = await fetch('/api/settings', { cache: 'no-store' }).then(r => r.json()) as Settings
      onSaved(fresh)
    } catch {
      setError({ field: null, message: 'Could not reach the server. Nothing was changed.' })
    } finally { setSaving(false) }
  }

  const input = 'h-11 w-full rounded-xl border border-white/10 bg-background/50 px-3.5 text-[15px] text-foreground placeholder:text-foreground/35 transition-colors focus:border-nova/60 focus:outline-none'
  const label = 'text-sm font-medium text-foreground/85'
  const count = (n: number, max: number) => <span className={cn('text-xs tabular-nums', n > max ? 'text-amber-300' : 'text-foreground/40')}>{n}/{max}</span>
  const fieldError = (f: string) => error?.field === f ? <p role="alert" className="mt-1.5 text-xs text-amber-200">{error.message}</p> : null

  return (
    <form className={cn(CARD, 'nova-rise mt-6 space-y-6')} onSubmit={e => { e.preventDefault(); void save() }} aria-label="Edit your profile" data-profile-editor>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className={label}>Name</span>
          <input className={cn(input, 'mt-1.5')} value={d.name} maxLength={81} onChange={e => set('name', e.target.value)} autoComplete="name" data-field="name" />
          {nameError && <p className="mt-1.5 text-xs text-amber-200">{nameError}</p>}{fieldError('name')}
        </label>
        <label className="block sm:col-span-2"><span className="flex items-baseline justify-between"><span className={label}>Headline</span>{count(d.headline.length, HEADLINE_MAX)}</span>
          <input className={cn(input, 'mt-1.5')} value={d.headline} onChange={e => set('headline', e.target.value)} placeholder="Final-year CS student · aspiring ML engineer" data-field="headline" />{fieldError('headline')}
        </label>
        <label className="block"><span className="flex items-baseline justify-between"><span className={label}>Where you work or study</span>{count(d.organisation.length, ORGANISATION_MAX)}</span>
          <input className={cn(input, 'mt-1.5')} value={d.organisation} onChange={e => set('organisation', e.target.value)} placeholder="IIT Delhi, Acme Inc." autoComplete="organization" data-field="organisation" />{fieldError('organisation')}
        </label>
        <label className="block"><span className="flex items-baseline justify-between"><span className={label}>Location</span>{count(d.location.length, LOCATION_MAX)}</span>
          <input className={cn(input, 'mt-1.5')} value={d.location} onChange={e => set('location', e.target.value)} placeholder="Bengaluru, India" data-field="location" />{fieldError('location')}
        </label>
        <label className="block sm:col-span-2"><span className="flex items-baseline justify-between"><span className={label}>Bio</span>{count(d.bio.length, BIO_MAX)}</span>
          <textarea className={cn(input, 'mt-1.5 h-auto min-h-28 resize-y py-3 leading-relaxed')} value={d.bio} onChange={e => set('bio', e.target.value)} placeholder="What you do, what you’re learning, and what you’re working toward." data-field="bio" />{fieldError('bio')}
        </label>
      </div>

      <div>
        <p className="flex items-baseline justify-between"><span className={label}>Skills</span><span className="text-xs text-foreground/40">{d.skills.length}/{SKILLS_MAX}</span></p>
        <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-background/50 p-1.5 focus-within:border-nova/60">
          {d.skills.map(s => (
            <span key={s} className="inline-flex items-center gap-1 rounded-lg bg-nova/12 py-1 pl-2.5 pr-1 text-sm text-foreground">{s}
              <button type="button" onClick={() => set('skills', d.skills.filter(x => x !== s))} aria-label={`Remove ${s}`} className="grid size-5 place-items-center rounded text-foreground/60 hover:bg-white/10 hover:text-foreground"><X className="size-3" /></button>
            </span>
          ))}
          {d.skills.length < SKILLS_MAX && (
            <input value={skill} maxLength={SKILL_MAX} onChange={e => setSkill(e.target.value)} onBlur={addSkill}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill() } else if (e.key === 'Backspace' && !skill && d.skills.length) set('skills', d.skills.slice(0, -1)) }}
              placeholder={d.skills.length ? 'Add another' : 'Python, Data structures, Public speaking… (Enter to add)'} className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none" data-field="skill" />
          )}
        </div>
        {fieldError('skills')}
      </div>

      <div>
        <p className="flex items-baseline justify-between"><span className={label}>Links</span><span className="text-xs text-foreground/40">{d.links.length}/{LINKS_MAX}</span></p>
        <div className="mt-1.5 space-y-2">
          {d.links.map((l, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <input className={input} value={l} inputMode="url" onChange={e => set('links', d.links.map((x, k) => (k === i ? e.target.value : x)))} placeholder="linkedin.com/in/you" data-field={`link-${i}`} />
                <button type="button" onClick={() => set('links', d.links.filter((_, k) => k !== i))} aria-label="Remove this link" className="grid size-11 shrink-0 place-items-center rounded-xl text-foreground/55 hover:bg-white/6 hover:text-foreground"><X className="size-4" /></button>
              </div>
              {linkErrors[i] && <p className="mt-1 text-xs text-amber-200">{linkErrors[i]}</p>}
            </div>
          ))}
          {d.links.length < LINKS_MAX && <button type="button" onClick={() => set('links', [...d.links, ''])} className="inline-flex items-center gap-1.5 text-sm font-medium text-nova-ink hover:underline" data-add-link><Plus className="size-3.5" /> Add a link</button>}
        </div>
        {fieldError('links')}
      </div>

      {error && !error.field && <p role="alert" className="text-sm text-amber-200">{error.message}</p>}
      {!local.ok && <p className="text-xs text-amber-200">{local.message}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/8 pt-5">
        <button type="button" onClick={onCancel} className="inline-flex h-10 items-center rounded-xl px-4 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground">Cancel</button>
        <button type="submit" disabled={blocked || saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-action px-5 text-sm font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-action-hover disabled:opacity-50" data-profile-save>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save profile
        </button>
      </div>
    </form>
  )
}

type ResetState =
  | { kind: 'idle' } | { kind: 'sending' }
  | { kind: 'sent'; email: string; accepted: boolean }
  | { kind: 'limited'; minutes: number } | { kind: 'no_password'; google: boolean } | { kind: 'error' }

// The account itself: the address Kivo knows it by, whether that address is
// confirmed, how it signs in, and the password. Read from the server's answer
// only; nothing here is worked out in the browser.
function AccountCard({ settings }: { settings: Settings }) {
  const [reset, setReset] = useState<ResetState>({ kind: 'idle' })
  const hasPassword = settings.hasPassword ?? !settings.isGoogleOAuth
  const methods = [hasPassword && 'Email and password', settings.isGoogleOAuth && 'Google'].filter(Boolean).join(' · ') || 'Email and password'

  async function sendReset() {
    setReset({ kind: 'sending' })
    try {
      const res = await fetch('/api/settings/password-reset', { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { email?: string; accepted?: boolean; reason?: string; google?: boolean; retryAfterSeconds?: number }
      if (res.ok && body.email) setReset({ kind: 'sent', email: body.email, accepted: body.accepted === true })
      else if (res.status === 429) setReset({ kind: 'limited', minutes: Math.max(1, Math.ceil((body.retryAfterSeconds ?? 3600) / 60)) })
      else if (res.status === 409) setReset({ kind: 'no_password', google: body.google === true })
      else setReset({ kind: 'error' })
    } catch { setReset({ kind: 'error' }) }
  }

  return (
    <section className={CARD} aria-labelledby="profile-account" data-profile-account>
      <h2 id="profile-account" className={EYEBROW}>Account</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-foreground/55">Email</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground/90">
            <span className="min-w-0 break-all" data-account-email>{settings.email}</span>
            {settings.emailVerified !== undefined && (settings.emailVerified
              ? <span className="inline-flex items-center gap-1 text-xs text-nova-ink" data-account-verified="yes"><ShieldCheck aria-hidden className="size-3.5" />Verified</span>
              : <span className="inline-flex items-center gap-1 text-xs text-amber-300" data-account-verified="no"><CircleAlert aria-hidden className="size-3.5" />Not verified</span>)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2"><dt className="text-xs text-foreground/55">Sign-in</dt><dd className="text-right text-foreground/80" data-account-methods>{methods}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="inline-flex items-center gap-1.5 text-xs text-foreground/55"><Send aria-hidden className="size-3.5" />Telegram</dt>
          <dd>{settings.platforms?.telegram?.connected ? <span className="inline-flex items-center gap-1 text-nova-ink"><Check aria-hidden className="size-3.5" />Connected</span> : <Link href="/settings" className="text-foreground/60 hover:text-foreground">Connect</Link>}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-white/8 pt-4" data-account-password>
        <h3 className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground"><KeyRound aria-hidden className="size-4 text-nova-ink" />Password</h3>
        {hasPassword && reset.kind !== 'no_password' ? (
          <>
            <p className="mt-1 text-xs leading-relaxed text-foreground/60">We email a link to {settings.email}. It works once, for an hour, and lets you choose a new password.</p>
            {reset.kind !== 'sent' && (
              <button type="button" onClick={() => void sendReset()} disabled={reset.kind === 'sending'}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-white/12 px-3.5 text-sm font-medium text-foreground/90 hover:border-nova/50 hover:bg-nova/10 disabled:opacity-60" data-account-reset>
                {reset.kind === 'sending' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null} Email me a reset link
              </button>
            )}
            <div role="status" aria-live="polite" className="mt-2 text-xs leading-relaxed" data-account-reset-state={reset.kind}>
              {reset.kind === 'sent' && (reset.accepted
                ? <p className="text-foreground/80">Our email service has accepted a reset link for {reset.email}. If it isn’t in your inbox in a few minutes, check spam. Resetting doesn’t sign you out of other browsers.</p>
                : <p className="text-amber-200">Our email service didn’t accept the message, so no link is on its way. Try again in a few minutes.</p>)}
              {reset.kind === 'limited' && <p className="text-amber-200">You’ve asked for several links in the last hour. Try again in about {reset.minutes} min, or use the newest link you have.</p>}
              {reset.kind === 'error' && <p className="text-amber-200">That didn’t go through. Check your connection and try again.</p>}
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs leading-relaxed text-foreground/60" data-account-google-only>
            You sign in with Google, so Kivo has no password for this account. Your password is managed by Google:{' '}
            <a href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer" className="font-medium text-nova-ink hover:underline">Google account security</a>.
          </p>
        )}
      </div>
    </section>
  )
}

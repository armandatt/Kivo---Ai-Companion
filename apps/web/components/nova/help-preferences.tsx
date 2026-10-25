'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { audienceOf } from '@repo/api/nova/product/first-focus'
import { CREATURE_NAME_MAX, DEFAULT_CREATURE_NAME } from '@repo/api/nova/product/onboarding-answers'
import {
  OBSTACLE, OBSTACLES, OBSTACLE_LABELS, WEEKLY_PRESETS, WORKING_ON_LABELS, checkWeeklyHours, workingOnOptions,
  type MultiAnswer, type ObstacleId, type WeeklyHours, type WeeklyPresetId, type WorkingOnId,
} from '@repo/api/nova/product/onboarding-options'
import { TONE_OPTIONS, type Tone } from '@repo/api/nova/product/tone'
import type { ReplyLanguage } from '@repo/api/nova/types/understanding.types'
import { STYLE_QUESTIONS, type StyleDimension } from '@repo/api/personality/style-items'
import { Choice, CustomEntries, MultiChoice } from '@/components/onboarding/answer-controls'
import { BUTTON_PRIMARY } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'

// The onboarding answers a learner can change after onboarding, besides
// those with their own place (what they are learning for: the setup page).
// Each card saves on its own through PATCH /api/settings, and the three
// older preferences through POST /api/personality. A card says "Saved" only
// when the server lists what it stored.

type Multi<Id extends string> = { selected: Id[]; custom: string[] }
type Note = { ok: boolean; text: string } | null

type Loaded = {
  creatureName: string
  contexts:     string[]
  workingOn:    Multi<WorkingOnId>
  weekly:       { preset: WeeklyPresetId | 'custom' | null; hours: string }
  obstacles:    Multi<ObstacleId>
  language:     ReplyLanguage | null
  tone:         Tone | null
  style:        Partial<Record<StyleDimension, string>>
}

const LANGUAGES: ReadonlyArray<{ value: ReplyLanguage; label: string; hint: string }> = [
  { value: 'english',  label: 'English',  hint: 'Natural, everyday English.' },
  { value: 'hindi',    label: 'Hindi',    hint: 'हिन्दी, in Devanagari script.' },
  { value: 'hinglish', label: 'Hinglish', hint: 'Hindi and English mixed, in Roman letters.' },
]

const FIELD = 'h-10 w-full rounded-xl border border-white/10 bg-white/4 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-action'
const LABEL = 'mb-1.5 block text-xs font-medium text-foreground/60'

const multi = <Id extends string>(m: MultiAnswer<Id> | null | undefined): Multi<Id> => ({ selected: m?.selected ?? [], custom: m?.custom ?? [] })
const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])

function Saved({ note }: { note: Note }) {
  if (!note) return null
  return (
    <p role={note.ok ? 'status' : 'alert'} className={cn('flex items-center gap-1.5 text-sm', note.ok ? 'text-action-ink' : 'text-red-500')}>
      {note.ok && <Check aria-hidden className="size-4" />}{note.text}
    </p>
  )
}

function Card({ title, description, children, footer }: { title: string; description: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/8 bg-card/70 p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-foreground/60">{description}</p>
      <div className="mt-5 space-y-5">{children}</div>
      <div className="mt-5 flex flex-wrap items-center gap-3">{footer}</div>
    </section>
  )
}

// PATCH /api/settings, believed only when the server says it stored these.
async function patch(body: Record<string, unknown>, keys: string[]): Promise<Note> {
  try {
    const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null) as { error?: string; saved?: string[] } | null
    if (!res.ok) return { ok: false, text: data?.error ?? "That didn't save. Try again." }
    if (!Array.isArray(data?.saved) || !keys.every(k => data!.saved!.includes(k))) return { ok: false, text: "Kivo's server hasn't been updated for this yet, so it didn't save. Try again later." }
    return { ok: true, text: 'Saved. Nova uses this from your next message.' }
  } catch {
    return { ok: false, text: "Couldn't reach Kivo. Try again." }
  }
}

export function HelpPreferences() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft]   = useState<Loaded | null>(null)
  const [busy, setBusy]     = useState<'about' | 'voice' | 'creature' | 'style' | null>(null)
  const [notes, setNotes]   = useState<Record<'about' | 'voice' | 'creature' | 'style', Note>>({ about: null, voice: null, creature: null, style: null })

  useEffect(() => {
    let live = true
    Promise.all([
      fetch('/api/settings', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch('/api/personality', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ])
      .then(([settings, personality]: [
        { creatureName?: string; companionName?: string; learningContexts?: string[]; workingOn?: MultiAnswer<WorkingOnId> | null;
          weeklyHours?: WeeklyHours | null; obstacles?: MultiAnswer<ObstacleId> | null; language?: ReplyLanguage | null; tone?: Tone | null },
        { style?: { choices?: Record<StyleDimension, string> | null } },
      ]) => {
        if (!live) return
        const weekly = settings.weeklyHours ?? null
        const now: Loaded = {
          creatureName: settings.creatureName || settings.companionName || DEFAULT_CREATURE_NAME,
          contexts:     settings.learningContexts ?? [],
          workingOn:    multi(settings.workingOn),
          weekly:       { preset: weekly?.preset ?? null, hours: weekly?.preset === 'custom' ? String(weekly.hours) : '' },
          obstacles:    multi(settings.obstacles),
          language:     settings.language ?? null,
          tone:         settings.tone ?? null,
          style:        personality.style?.choices ?? {},
        }
        setLoaded(now)
        setDraft(now)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  if (failed) return <p role="status" className="rounded-3xl border border-white/8 bg-card/70 p-6 text-sm text-foreground/65">These settings didn&apos;t load. Reload the page to try again.</p>
  if (!loaded || !draft) return <div aria-busy="true" aria-label="Loading your preferences" className="h-72 animate-pulse rounded-3xl border border-white/5 bg-white/3" />

  const set = (patchDraft: Partial<Loaded>) => setDraft(d => (d ? { ...d, ...patchDraft } : d))
  const note = (key: keyof typeof notes, value: Note) => setNotes(n => ({ ...n, [key]: value }))
  const weeklyAnswer = draft.weekly.preset === null ? null
    : draft.weekly.preset === 'custom' ? { preset: 'custom' as const, hours: draft.weekly.hours } : { preset: draft.weekly.preset }
  const weeklyCheck = weeklyAnswer ? checkWeeklyHours(weeklyAnswer) : null
  const styleComplete = STYLE_QUESTIONS.every(q => draft.style[q.id] !== undefined)

  async function run(key: keyof typeof notes, body: Record<string, unknown>, keys: string[]) {
    setBusy(key); note(key, null)
    note(key, await patch(body, keys))
    setBusy(null)
  }

  async function saveStyle() {
    setBusy('style'); note('style', null)
    try {
      const res = await fetch('/api/personality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: draft!.style }) })
      note('style', res.ok ? { ok: true, text: 'Saved. Nova uses this from your next message.' } : { ok: false, text: "That didn't save. Try again." })
    } catch {
      note('style', { ok: false, text: "Couldn't reach Kivo. Try again." })
    } finally {
      setBusy(null)
    }
  }

  const saveButton = (key: keyof typeof notes, onClick: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={busy !== null || disabled} className={BUTTON_PRIMARY}>
      {busy === key ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Saving…</> : 'Save'}
    </button>
  )

  return (
    <div className="space-y-4" data-help-preferences>
      <Card title="What you're working on" description="Nova uses this as context for its suggestions. It creates no tasks or deadlines."
        footer={<>
          {saveButton('about', () => void run('about', { workingOn: draft.workingOn, obstacles: draft.obstacles, weeklyHours: weeklyAnswer }, ['workingOn', 'obstacles', 'weeklyHours']), weeklyAnswer !== null && weeklyCheck?.ok !== true)}
          <Saved note={notes.about} />
        </>}>
        <fieldset>
          <legend className="text-sm font-medium text-foreground/85">Working on</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {workingOnOptions(audienceOf(draft.contexts)).map(o => (
              <MultiChoice key={o.id} name="pref-working-on" value={o.id} checked={draft.workingOn.selected.includes(o.id)} label={o.label}
                onToggle={() => set({ workingOn: { ...draft.workingOn, selected: toggle(draft.workingOn.selected, o.id) } })} />
            ))}
          </div>
          <CustomEntries id="pref-working-on" entries={draft.workingOn.custom} labels={WORKING_ON_LABELS} addLabel="Your own"
            placeholder="e.g. Final-year thesis" onChange={custom => set({ workingOn: { ...draft.workingOn, custom } })} />
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-foreground/85">Time you can give each week</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {WEEKLY_PRESETS.map(p => (
              <Choice key={p.id} name="pref-weekly" value={p.id} checked={draft.weekly.preset === p.id} label={p.label}
                onSelect={() => set({ weekly: { ...draft.weekly, preset: p.id } })} />
            ))}
            <Choice name="pref-weekly" value="custom" checked={draft.weekly.preset === 'custom'} label="My own estimate"
              onSelect={() => set({ weekly: { ...draft.weekly, preset: 'custom' } })} />
          </div>
          {draft.weekly.preset === 'custom' && (
            <div className="mt-3 max-w-xs">
              <label htmlFor="pref-weekly-hours" className={LABEL}>Hours per week</label>
              <input id="pref-weekly-hours" inputMode="decimal" value={draft.weekly.hours} onChange={e => set({ weekly: { ...draft.weekly, hours: e.target.value } })} className={FIELD} />
              {draft.weekly.hours.trim() !== '' && weeklyCheck && !weeklyCheck.ok && <p role="alert" className="mt-1.5 text-xs text-red-500">{weeklyCheck.message}</p>}
            </div>
          )}
          <p className="mt-2 text-xs text-subtle">The usual daily time Nova plans with is on the study page; changing this doesn&apos;t move it.</p>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-foreground/85">What usually gets in the way</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {OBSTACLES.map(id => (
              <MultiChoice key={id} name="pref-obstacles" value={id} checked={draft.obstacles.selected.includes(id)} label={OBSTACLE[id].label}
                onToggle={() => set({ obstacles: { ...draft.obstacles, selected: id === 'not_sure'
                  ? (draft.obstacles.selected.includes('not_sure') ? [] : ['not_sure'])
                  : toggle(draft.obstacles.selected.filter(s => s !== 'not_sure'), id) } })} />
            ))}
          </div>
          <CustomEntries id="pref-obstacles" entries={draft.obstacles.custom} labels={OBSTACLE_LABELS} addLabel="Your own"
            placeholder="e.g. My phone" onChange={custom => set({ obstacles: { ...draft.obstacles, custom } })} />
          <p className="mt-2 text-xs text-subtle">Shapes how Nova helps. It never turns on reminders or messages.</p>
        </fieldset>
      </Card>

      <Card title="Language and tone" description="How Nova speaks to you on the web and on Telegram. Writing to it in another language, or asking for a different manner, always wins."
        footer={<>
          {saveButton('voice', () => void run('voice', { language: draft.language, tone: draft.tone }, [...(draft.language ? ['language'] : []), ...(draft.tone ? ['tone'] : [])]), !draft.language && !draft.tone)}
          <Saved note={notes.voice} />
        </>}>
        <fieldset>
          <legend className="text-sm font-medium text-foreground/85">Language</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {LANGUAGES.map(l => (
              <Choice key={l.value} name="pref-language" value={l.value} checked={draft.language === l.value} label={l.label} hint={l.hint}
                onSelect={() => set({ language: l.value })} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium text-foreground/85">Tone</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {TONE_OPTIONS.map(t => (
              <Choice key={t.value} name="pref-tone" value={t.value} checked={draft.tone === t.value} label={t.label} hint={t.hint}
                onSelect={() => set({ tone: t.value })} />
            ))}
          </div>
          <p className="mt-2 text-xs text-subtle">Tone changes Nova&apos;s manner, not its advice. It turns calm whenever an exam is close or something is weighing on you.</p>
        </fieldset>
      </Card>

      <Card title="Your creature" description="The name of the creature in your world. Nova is always called Nova."
        footer={<>
          {saveButton('creature', () => void run('creature', { creatureName: draft.creatureName }, ['creatureName']))}
          <Saved note={notes.creature} />
        </>}>
        <div className="max-w-sm">
          <label htmlFor="pref-creature" className={LABEL}>Creature name</label>
          <input id="pref-creature" value={draft.creatureName} maxLength={CREATURE_NAME_MAX} onChange={e => set({ creatureName: e.target.value })} placeholder={DEFAULT_CREATURE_NAME} className={FIELD} />
        </div>
      </Card>

      <Card title="How you like to be helped" description="Optional. Shapes how Nova words its replies. Asking for something different in a message always wins."
        footer={<>
          {saveButton('style', () => void saveStyle(), !styleComplete)}
          {!styleComplete && <p className="text-xs text-subtle">Answer all three to save.</p>}
          <Saved note={notes.style} />
        </>}>
        {STYLE_QUESTIONS.map(q => (
          <fieldset key={q.id}>
            <legend className="text-sm font-medium text-foreground/85">{q.question}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.options.map(o => {
                const on = draft.style[q.id] === o.value
                return (
                  <label key={o.value} title={o.hint}
                    className={cn('cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                      on ? 'border-action bg-action-soft text-foreground' : 'border-white/10 text-foreground/70 hover:bg-white/5')}>
                    <input type="radio" name={`pref-${q.id}`} value={o.value} checked={on} onChange={() => set({ style: { ...draft.style, [q.id]: o.value } })} className="sr-only" />
                    {o.label}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </Card>
    </div>
  )
}

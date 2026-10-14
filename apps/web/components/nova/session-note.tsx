'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { REFLECTION_FIELD_MAX, type ReflectionResponse } from '@repo/api/nova/product/focus-context.types'

// The optional note after a session: what got done, what got in the way and
// the next step, in the learner's own words. It is kept with that session
// and shown back the next time they study the topic. Skipping it changes
// nothing: the session is already logged. It is not a rating and does not
// change what Nova thinks they know.

const FIELD = 'mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none'

const QUESTIONS = [
  { key: 'did',     label: 'What did you get done?',  placeholder: 'e.g. Worked through two examples' },
  { key: 'blocked', label: 'What got in the way?',    placeholder: 'e.g. Still unsure about the last step' },
  { key: 'next',    label: 'What is the next step?',  placeholder: 'e.g. Try the practice set' },
] as const

type Answers = Record<(typeof QUESTIONS)[number]['key'], string>

export function SessionNote({ sessionId }: { sessionId: string }) {
  const [answers, setAnswers] = useState<Answers>({ did: '', blocked: '', next: '' })
  const [state, setState]     = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError]     = useState<string | null>(null)

  const empty = QUESTIONS.every(q => !answers[q.key].trim())

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (empty || state !== 'idle') return
    setState('saving'); setError(null)
    try {
      const res  = await fetch('/api/nova/session/reflection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...answers }),
      })
      const data = await res.json().catch(() => null) as ReflectionResponse | null
      if (res.ok && data?.ok) { setState('saved'); return }
      setError(data && !data.ok ? data.message : "Your note wasn't saved. Your session is still logged; try again.")
    } catch {
      setError("Your note wasn't saved. Your session is still logged; check your connection and try again.")
    }
    setState('idle')
  }

  if (state === 'saved') {
    return (
      <p role="status" className="mx-auto mt-8 flex max-w-sm items-center justify-center gap-2 text-sm text-foreground/75" data-note-saved>
        <Check className="size-4 text-keppel-300" /> Note saved. You&apos;ll see it next time you study this.
      </p>
    )
  }

  return (
    <form onSubmit={save} aria-labelledby="session-note-heading" className="mx-auto mt-10 max-w-md rounded-2xl border border-white/8 bg-card/50 p-5 text-left" data-section="session-note">
      <h2 id="session-note-heading" className="text-sm font-medium text-foreground">Leave yourself a note <span className="font-normal text-foreground/45">(optional)</span></h2>
      <p className="mt-1 text-xs leading-relaxed text-foreground/50">For you, next time. It doesn&apos;t change what Nova has on record for this topic.</p>
      <div className="mt-4 space-y-3">
        {QUESTIONS.map(q => (
          <div key={q.key}>
            <label htmlFor={`note-${q.key}`} className="text-xs font-medium text-foreground/60">{q.label}</label>
            <input id={`note-${q.key}`} value={answers[q.key]} maxLength={REFLECTION_FIELD_MAX} disabled={state === 'saving'} autoComplete="off"
              onChange={e => { setError(null); setAnswers(a => ({ ...a, [q.key]: e.target.value })) }} placeholder={q.placeholder} className={FIELD} />
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-red-300">{error}</p>}
      <button type="submit" disabled={empty || state === 'saving'}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-40">
        {state === 'saving' ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Save note'}
      </button>
    </form>
  )
}

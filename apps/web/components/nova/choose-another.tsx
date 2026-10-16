'use client'

// "Choose another": the learner studies something other than Nova's
// recommendation. The other blocks on today's plan come first, then any topic
// of theirs. Starting sends the ordinary `start` command (useStartSession):
// nothing is recorded until a session actually starts, and the plan itself
// does not change, since the plan is worked out afresh from the record.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Shuffle, X } from 'lucide-react'
import type { TodayAction } from '@repo/api/nova/product/today.types'
import type { NovaKnowledgeView } from '@repo/api/nova/product/knowledge.types'

type Startable = Pick<TodayAction, 'topicName' | 'subjectName' | 'durationMinutes'>

const LENGTHS = [15, 25, 45]
const FIELD = 'h-10 w-full rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground disabled:opacity-50'

export function ChooseAnother({ alternatives, onStart, disabled }: {
  alternatives: TodayAction[]
  onStart: (action: Startable) => void
  disabled?: boolean
}) {
  const [open, setOpen]         = useState(false)
  const [subjects, setSubjects] = useState<Array<{ name: string; topics: string[] }> | null>(null)
  const [failed, setFailed]     = useState(false)
  const [subject, setSubject]   = useState('')
  const [topic, setTopic]       = useState('')
  const [minutes, setMinutes]   = useState(25)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || subjects !== null) return
    let gone = false
    fetch('/api/nova/knowledge', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() as Promise<NovaKnowledgeView> : null))
      .then(v => {
        if (gone) return
        if (v?.status === 'ready') setSubjects(v.subjects.map(s => ({ name: s.subjectName, topics: s.topics.map(t => t.topicName) })))
        else setFailed(true)
      })
      .catch(() => { if (!gone) setFailed(true) })
    return () => { gone = true }
  }, [open, subjects])

  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>('button, select')?.focus() }, [open])

  const topics = subjects?.find(s => s.name === subject)?.topics ?? []

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} data-choose-another
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-sm text-foreground/75 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40">
        <Shuffle className="size-3.5" /> Choose another
      </button>
    )
  }

  return (
    <div ref={panel} role="region" aria-label="Choose another" data-choose-panel
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
      className="mt-3 rounded-2xl border border-white/10 bg-card/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Study something else</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
      </div>

      {alternatives.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/40">Also on today&apos;s plan</p>
          <ul className="mt-2 space-y-1.5">
            {alternatives.map(a => (
              <li key={`${a.subjectName}:${a.topicName}`}>
                <button type="button" disabled={disabled} onClick={() => onStart(a)} data-start-alternative
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5 disabled:opacity-40">
                  <span className="min-w-0"><span className="block truncate font-medium text-foreground/90">{a.topicName}</span><span className="block truncate text-xs text-foreground/45">{a.subjectName} · {a.durationMinutes} min</span></span>
                  <Play className="size-3.5 shrink-0 text-foreground/50" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/40">Any of your topics</p>
      {failed ? (
        <p className="mt-2 text-sm text-foreground/55">Your topics didn&apos;t load. Try again in a moment.</p>
      ) : subjects === null ? (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-foreground/55"><Loader2 className="size-3.5 animate-spin" /> Loading your topics…</p>
      ) : subjects.length === 0 ? (
        <p className="mt-2 text-sm text-foreground/55">No topics yet. Add some in study settings.</p>
      ) : (
        <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"
          onSubmit={e => { e.preventDefault(); if (subject && topic) onStart({ subjectName: subject, topicName: topic, durationMinutes: minutes }) }}>
          <label className="sr-only" htmlFor="another-subject">Subject</label>
          <select id="another-subject" value={subject} onChange={e => { setSubject(e.target.value); setTopic('') }} className={FIELD}>
            <option value="">Subject</option>
            {subjects.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="another-topic">Topic</label>
          <select id="another-topic" value={topic} onChange={e => setTopic(e.target.value)} disabled={!subject} className={FIELD}>
            <option value="">{subject ? 'Topic' : 'Pick a subject first'}</option>
            {topics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="sr-only" htmlFor="another-length">Length</label>
          <select id="another-length" value={minutes} onChange={e => setMinutes(Number(e.target.value))} className={FIELD}>
            {LENGTHS.map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          <button type="submit" disabled={disabled || !subject || !topic} data-start-chosen
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50">
            <Play className="size-3.5" /> Start
          </button>
        </form>
      )}
      <p className="mt-3 text-xs text-foreground/40">Nothing is recorded until the session starts. Nova&apos;s plan stays as it is.</p>
    </div>
  )
}

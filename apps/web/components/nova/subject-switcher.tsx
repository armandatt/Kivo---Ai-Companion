'use client'

import { Check, Layers, Loader2 } from 'lucide-react'
import type { TodaySubjectProgress } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { relativeDay } from './format'
import { toneStyle } from './subject-color'

// The learner's top-level subjects as cards (the server sends only subjects
// inside no other: the Knowledge Map's own hierarchy, never names), each in
// its own colour, with how far through it they are from the record.
// Choosing one marks it as the subject in view: context for Nova, nothing
// more. It adds nothing to today and opens nothing.
export function SubjectSwitcher({ progress, focus, onChoose, busy }: {
  progress: TodaySubjectProgress[]
  focus:    string | null
  onChoose: (subject: string | null) => void
  // A choice is being planned.
  busy:     boolean
}) {
  if (progress.length < 1 && focus === null) return null
  const card = 'subject-tone group relative flex min-w-[11.5rem] max-w-[15rem] shrink-0 snap-start flex-col gap-1.5 overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait'
  return (
    <section aria-labelledby="today-subject" data-section="subject-switcher" className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="today-subject" className="text-xs font-semibold text-foreground/70">Subjects <span className="font-normal text-foreground/50">· pick one to give Nova context; nothing is added to today</span></h2>
        {busy && <span role="status" className="inline-flex items-center gap-1.5 text-xs text-foreground/55"><Loader2 aria-hidden className="size-3 animate-spin" />Planning…</span>}
      </div>
      <div role="group" aria-label="Subjects" className="-mx-1 mt-2 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
        <button type="button" aria-pressed={focus === null} disabled={busy} onClick={() => onChoose(null)}
          className={cn(card, focus === null ? 'border-action bg-action-soft shadow-soft' : 'border-white/10 bg-card/70 hover:border-white/25')}>
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers aria-hidden className="size-3.5 text-foreground/60" />All subjects
            {focus === null && <Check aria-hidden className="ml-auto size-3.5 text-action-ink" />}
          </span>
          <span className="text-xs leading-snug text-foreground/60">No subject in view. Nova plans across everything.</span>
        </button>
        {progress.map(p => {
          const on = focus !== null && focus.toLowerCase() === p.subjectName.toLowerCase()
          const share = p.topicsTotal > 0 ? (p.topicsStarted / p.topicsTotal) * 100 : 0
          return (
            <button key={p.subjectId ?? p.subjectName} type="button" aria-pressed={on} disabled={busy} onClick={() => onChoose(on ? null : p.subjectName)}
              style={toneStyle(p.subjectName)}
              className={cn(card, on ? 'border-[var(--sc)] bg-[var(--sc-soft)] shadow-soft' : 'border-white/10 bg-card/70 hover:border-[var(--sc-edge)]')}>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--sc)] ring-4 ring-[var(--sc-soft)]" />
                <span className="truncate text-sm font-semibold text-foreground">{p.subjectName}</span>
                {on && <Check aria-hidden className="ml-auto size-3.5 shrink-0 text-[var(--sc-ink)]" />}
              </span>
              {p.topicsTotal > 0 && (
                <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-white/8">
                  <span className="block h-full rounded-full bg-[var(--sc)]" style={{ width: `${share}%` }} />
                </span>
              )}
              <span className="text-xs tabular-nums text-foreground/60">
                {p.topicsTotal === 0 ? 'No topics yet' : `${p.topicsStarted} of ${p.topicsTotal} topics started`}
                {p.innerSubjects ? ` · ${p.innerSubjects} inside` : ''}
              </span>
              <span className="truncate text-xs text-foreground/55">
                {p.lastTopic ? <>Last: {p.lastTopic}{p.lastStudiedAt ? `, ${relativeDay(p.lastStudiedAt)}` : ''}</> : p.nextTopic ? <>Start with {p.nextTopic}</> : <>&nbsp;</>}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// Under the switcher on a day given to one subject: where they left off and
// what comes next, from the record.
export function FocusNote({ progress, onClear }: { progress: TodaySubjectProgress | null; onClear: () => void }) {
  if (!progress) return null
  const parts = [
    progress.lastTopic ? `Last time: ${progress.lastTopic}${progress.lastStudiedAt ? `, ${relativeDay(progress.lastStudiedAt)}` : ''}.` : 'Nothing studied in it yet.',
    progress.nextTopic ? `Next new topic: ${progress.nextTopic}.` : null,
  ].filter(Boolean)
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs leading-relaxed text-foreground/65" style={toneStyle(progress.subjectName)}>
      <span className="subject-tone font-semibold text-[var(--sc-ink)]">Picking up {progress.subjectName} where you left off.</span>
      <span>{parts.join(' ')}</span>
      <button type="button" onClick={onClear} className="font-medium text-foreground/60 underline decoration-white/25 underline-offset-4 hover:text-foreground">Back to all subjects</button>
    </p>
  )
}

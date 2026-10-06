'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { LearningResourceResponse } from '@repo/api/nova/product/learning-events.types'
import { minutesLabel } from '../format'
import { useStartSession } from '../use-start-session'
import { fetchResource } from './saved-api'

type Loaded = Extract<LearningResourceResponse, { ok: true }>

// "Study this", arriving from the browser extension or the Saved list. It
// offers the page and where it is filed; the session itself is started by
// the ordinary start command, on the learner's click, and from then on it is
// a session like any other. Nothing is timed or recorded before that.
export function StudyRequest({ id }: { id: string }) {
  const [loaded, setLoaded]   = useState<Loaded | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [subjectId, setSubjectId] = useState('')
  const [topic, setTopic]     = useState('')
  const { start, starting, error } = useStartSession()

  useEffect(() => {
    let cancelled = false
    void fetchResource(id).then(res => {
      if (cancelled) return
      if (!res.ok) { setMissing(res.message); return }
      setLoaded(res)
      setSubjectId(res.resource.subjectId ?? '')
      setTopic(res.resource.topicName ?? '')
    })
    return () => { cancelled = true }
  }, [id])

  if (missing) {
    return (
      <div className="mt-16 text-center" data-study-request="missing">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nova can&apos;t find that page</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-foreground/60">It may have been removed, or it was saved to a different account.</p>
        <Link href="/saved" className="mt-8 inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground transition-colors hover:bg-white/5">Open Saved</Link>
      </div>
    )
  }
  if (!loaded) return <div className="mx-auto mt-16 h-40 w-full max-w-md animate-pulse rounded-2xl bg-white/4" aria-busy="true" aria-label="Loading" />

  const { resource, subjects } = loaded
  const subject = subjects.find(s => s.id === subjectId)
  const ready   = Boolean(subject) && topic.trim().length > 0
  const noSubjects = subjects.length === 0

  return (
    <div className="mt-12" data-study-request={resource.id}>
      <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/90">Study this</p>
      <h1 className="mt-2 text-center text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl" data-study-title>{resource.title}</h1>
      <p className="mt-2 text-center text-sm text-foreground/50">
        <a href={resource.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-keppel-200 hover:underline">{resource.domain}</a>
      </p>

      <div className="mx-auto mt-8 max-w-md rounded-2xl border border-white/8 bg-card/60 p-5">
        {noSubjects ? (
          <p className="text-sm leading-relaxed text-foreground/65" data-no-subjects>
            Nova doesn&apos;t know your subjects yet, so it has nowhere to file a session. Tell it what you&apos;re studying on Today first.
          </p>
        ) : (
          <>
            <label htmlFor="study-subject" className="block text-xs font-medium text-foreground/55">Subject</label>
            <select id="study-subject" value={subjectId} onChange={e => setSubjectId(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground">
              <option value="">Choose a subject</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <label htmlFor="study-topic" className="mt-4 block text-xs font-medium text-foreground/55">Topic</label>
            <input id="study-topic" list="study-topics" value={topic} onChange={e => setTopic(e.target.value)} maxLength={120} placeholder="What is this session about?" className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground placeholder:text-foreground/30" />
            <datalist id="study-topics">{(subject?.topics ?? []).map(t => <option key={t} value={t} />)}</datalist>

            <button
              type="button"
              disabled={!ready || starting !== null}
              onClick={() => void start({ topicName: topic.trim(), subjectName: subject!.name, durationMinutes: resource.study.minutes }, resource.id)}
              className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-xl bg-keppel-400 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50"
              data-start-study
            >
              {starting ? 'Starting…' : `Start · ${minutesLabel(resource.study.minutes)}`}
            </button>
            {!ready && <p className="mt-3 text-xs leading-relaxed text-foreground/45">A session needs a subject and a topic, so Nova knows what it was about.</p>}
            {error && <p role="alert" className="mt-3 text-xs text-amber-300/90">{error}</p>}
          </>
        )}
      </div>
      <p className="mx-auto mt-4 max-w-md text-center text-xs leading-relaxed text-foreground/40">
        Nothing is recorded until you start. How the session goes is what Nova learns from, not the page.
      </p>
    </div>
  )
}

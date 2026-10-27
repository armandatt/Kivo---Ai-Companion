'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { History, Loader2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeSession, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import type { ArchivedTopic, ArchivedTopicsView } from '@repo/api/nova/product/topic-archive.types'
import { minutesLabel, relativeDay, sentenceCase } from '../format'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import { fetchNotes } from '../notes/notes-api'
import { OUTCOME_LABEL } from './labels'
import type { NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { BUTTON_PRIMARY, SectionHeading } from '../workspace/ui'


function SessionLine({ session }: { session: KnowledgeSession }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground/70">
      <span className="text-foreground/85">{relativeDay(session.date)}</span>
      {/* A session the learner only told Nova about was never timed. */}
      <span className="text-foreground/45">{session.measured && session.minutes !== null ? minutesLabel(session.minutes) : 'reported in chat, not timed'}</span>
      {session.outcome && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-foreground/75">{OUTCOME_LABEL[session.outcome]}</span>}
      {session.confusionPoints.length > 0 && <span className="text-xs text-foreground/45">Flagged: {session.confusionPoints.join(', ')}</span>}
    </li>
  )
}

// The learner's own notes on a topic, fetched when its panel is opened. They
// are listed beside the topic's state; they are not part of it and do not
// feed it.
export function TopicNotes({ subjectId, topicName }: { subjectId: string; topicName: string }) {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchNotes({ subjectId, topic: topicName }).then(view => {
      if (!cancelled) setNotes(view?.status === 'ready' ? view.notes : [])
    })
    return () => { cancelled = true }
  }, [subjectId, topicName])

  const newNote = `/notes/new?subjectId=${encodeURIComponent(subjectId)}&topic=${encodeURIComponent(topicName)}`
  return (
    <div data-topic-notes={topicName}>
      {notes === null ? (
        <p className="text-sm text-foreground/40">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-foreground/55">
          No notes filed under this topic yet. <Link href={newNote} className="font-medium text-keppel-300 hover:text-keppel-200">Write one</Link>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map(n => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="text-sm text-foreground/80 underline-offset-4 hover:text-keppel-200 hover:underline">{n.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Archive: off the active lists, history kept (product/topic-archive.ts).
async function postArchive(topicId: string, archived: boolean): Promise<string | null> {
  try {
    const res = await fetch('/api/nova/topics/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, archived }), cache: 'no-store' })
    if (res.status === 401) { window.location.href = '/signin'; return 'Sign in again.' }
    const r = await res.json() as { ok: boolean; message?: string }
    return r.ok ? null : r.message ?? "That didn't work."
  } catch {
    return "Couldn't reach the server. Nothing was changed."
  }
}

// What a topic row can reach beyond itself: the map's connections, other
// topics, and a session. All optional: without them the row is as it was.
export interface TopicActions {
  map?:         NovaKnowledgeMapReady | null
  onOpenTopic?: (topicId: string) => void
  // Absent while a session runs: one session at a time.
  onStudy?:     (topic: KnowledgeTopic) => void
  // The topic id of the start in flight, if any.
  studying?:    string | null
}

// A studied topic's record, in parts the topic page lays out: where it
// stands, its sessions, the session to start, and archiving. All read from
// the Knowledge view; nothing here computes a level or a date.

export function TopicMetrics({ topic }: { topic: KnowledgeTopic }) {
  const verified = topic.level !== 'unverified'
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8 sm:grid-cols-4">
        <Fact label="Level" value={verified ? `${topic.masteryPercent}%` : 'None yet'} />
        <Fact label="Sessions" value={String(topic.reviewCount)} />
        <Fact label="Retention" value={topic.lastStudiedAt ? `~${topic.retentionPercent}%` : 'Unknown'} />
        <Fact label="Next review" tone={topic.reviewState === 'due' ? 'due' : undefined}
          value={topic.reviewState === 'due' ? (topic.daysOverdue > 0 ? `${topic.daysOverdue} day${topic.daysOverdue === 1 ? '' : 's'} overdue` : 'Due now')
            : topic.nextReviewAt ? sentenceCase(relativeDay(topic.nextReviewAt)) : 'Not scheduled'} />
      </dl>
      <p className="mt-2.5 max-w-prose text-xs leading-relaxed text-foreground/50">
        {verified
          ? `An estimate from how you said each of ${topic.reviewCount === 1 ? 'your 1 finished session' : `your ${topic.reviewCount} finished sessions`} went, not a test score. Retention is estimated from the time since you last studied it.`
          : 'No focused session on this topic yet. It gets a level after the first one.'}
      </p>
    </div>
  )
}

export function TopicSessions({ topic }: { topic: KnowledgeTopic }) {
  return topic.recentSessions.length > 0
    ? <ul className="space-y-2">{topic.recentSessions.map(s => <SessionLine key={s.id} session={s} />)}</ul>
    : <p className="text-sm text-foreground/55">No sessions in the last 90 days. Start one and it is recorded here, with how you said it went.</p>
}

export function StudyButton({ topic, actions }: { topic: KnowledgeTopic; actions: TopicActions }) {
  if (!actions.onStudy) return null
  return (
    <button type="button" onClick={() => actions.onStudy!(topic)} disabled={actions.studying != null} className={cn(BUTTON_PRIMARY, 'h-9 px-3.5')} data-study-topic>
      {actions.studying === topic.id
        ? <><Loader2 aria-hidden className="size-3.5 animate-spin" /> Starting…</>
        : <><Play aria-hidden className="size-3" /> Study · 25 min</>}
    </button>
  )
}

export function ArchiveTopic({ topic, onChanged }: { topic: KnowledgeTopic; onChanged: () => void }) {
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  return (
    <div>
      <button type="button" disabled={archiving} data-archive-topic
        onClick={async () => {
          if (!window.confirm(`Archive ${topic.topicName}? It leaves your plan and lists. Its level, sessions, notes and history stay, and you can restore it.`)) return
          setArchiving(true); setArchiveError(null)
          const error = await postArchive(topic.id, true)
          setArchiving(false)
          if (error) setArchiveError(error); else onChanged()
        }}
        className="text-xs text-foreground/50 underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-40">
        {archiving ? 'Archiving…' : 'Archive this topic'}
      </button>
      {archiveError && <p role="alert" className="mt-1.5 text-xs text-amber-200/90">{archiveError}</p>}
    </div>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'due' }) {
  return (
    <div className="min-w-0 bg-card px-3.5 py-3">
      <dt className="text-[11px] font-medium text-foreground/50">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-base font-semibold tabular-nums tracking-tight', tone === 'due' ? 'text-amber-300' : 'text-foreground')}>{value}</dd>
    </div>
  )
}

export function RecentLearning({ sessions }: { sessions: KnowledgeSession[] }) {
  if (sessions.length === 0) return null
  return (
    <section aria-labelledby="knowledge-recent" data-section="recent-learning">
      <SectionHeading id="knowledge-recent" icon={History}>Recent learning</SectionHeading>
      <ul className="mt-3 space-y-3">
        {sessions.map(s => (
          <li key={s.id} data-session={s.id} data-measured={s.measured}>
            <p className="truncate text-sm text-foreground/90">{s.topicName ?? 'Study session'}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-foreground/55">
              <span>{relativeDay(s.date)}</span>
              <span aria-hidden className="text-foreground/25">·</span>
              <span>{s.measured && s.minutes !== null ? minutesLabel(s.minutes) : 'reported in chat, not timed'}</span>
              {s.outcome && <><span aria-hidden className="text-foreground/25">·</span><span className="text-foreground/75">{OUTCOME_LABEL[s.outcome]}</span></>}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// The learner's archived topics, each with Restore. Shown only when there are
// any; read from GET /api/nova/topics/archive.
export function ArchivedTopics({ onChanged, version }: { onChanged: () => void; version: string }) {
  const [topics, setTopics] = useState<ArchivedTopic[] | null>(null)
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    fetch('/api/nova/topics/archive', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() as Promise<ArchivedTopicsView> : null))
      .then(v => { if (!gone) setTopics(v?.status === 'ready' ? v.topics : []) })
      .catch(() => { if (!gone) setTopics([]) })
    return () => { gone = true }
  }, [version])
  if (!topics || topics.length === 0) return null
  return (
    <section aria-labelledby="archived-topics" className="rounded-2xl border border-white/8 bg-card/40 p-4" data-archived-topics>
      <h3 id="archived-topics" className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">Archived topics</h3>
      <p className="mt-1 text-xs text-foreground/45">Out of your plan and lists. Their history stays.</p>
      <ul className="mt-2 divide-y divide-white/6">
        {topics.map(t => (
          <li key={t.topicId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-archived={t.topicName}>
            <span className="min-w-0 text-foreground/75">{t.topicName} <span className="text-xs text-foreground/40">{t.subjectName}{t.studied ? ' · studied' : ''}</span></span>
            <button type="button" disabled={busy !== null}
              onClick={async () => { setBusy(t.topicId); setError(null); const e = await postArchive(t.topicId, false); setBusy(null); if (e) setError(e); else onChanged() }}
              className="inline-flex h-8 items-center rounded-lg border border-white/10 px-2.5 text-xs text-foreground/70 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40">
              {busy === t.topicId ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-xs text-amber-200/90">{error}</p>}
    </section>
  )
}

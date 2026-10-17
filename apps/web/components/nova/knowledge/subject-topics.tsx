'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, History, Loader2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeSession, KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import type { ArchivedTopic, ArchivedTopicsView } from '@repo/api/nova/product/topic-archive.types'
import { minutesLabel, relativeDay, sentenceCase } from '../format'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import { fetchNotes } from '../notes/notes-api'
import { LEVEL_LABEL, LEVEL_TONE, OUTCOME_LABEL, reviewLabel, sessionsLabel } from './labels'
import type { NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { BUTTON_PRIMARY, SectionHeading } from '../workspace/ui'
import { toneStyle } from '../subject-color'
import { TopicConnections } from './topic-connections'

// The record a link into this page names (?topic=<id> or ?subject=<id>), read
// from the address once the page is in the browser.
const linkedId = (name: 'topic' | 'subject'): string | null => new URLSearchParams(window.location.search).get(name)

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
function TopicNotes({ subjectId, topicName }: { subjectId: string; topicName: string }) {
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
    <div className="mt-4" data-topic-notes={topicName}>
      <p className="text-xs font-medium text-foreground/55">Your notes</p>
      {notes === null ? (
        <p className="mt-2 text-sm text-foreground/35">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mt-2 text-sm text-foreground/45">
          None on this topic yet. <Link href={newNote} className="text-keppel-300 hover:text-keppel-200">Write one</Link>
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
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

function TopicRow({ topic, subjectId, focus = 0, actions = {}, onChanged }: { topic: KnowledgeTopic; subjectId: string; focus?: number; actions?: TopicActions; onChanged?: () => void }) {
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  // A link from the Knowledge Map names the topic it is about (?topic=<id>):
  // that topic is opened and brought into view.
  const [linked, setLinked] = useState(false)
  const [open, setOpen] = useState(false)
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (linkedId('topic') !== topic.id) return
    setLinked(true)
    setOpen(true)
    row.current?.scrollIntoView({ block: 'center' })
  }, [topic.id])
  // Opened from the subject's board on this page: the same, without the address.
  useEffect(() => {
    if (!focus) return
    setOpen(true)
    row.current?.scrollIntoView({ block: 'center' })
  }, [focus])
  const verified = topic.level !== 'unverified'
  const panel = `topic-${topic.id}`

  return (
    <li ref={row} data-topic={topic.topicName} data-level={topic.level} data-review={topic.reviewState} data-linked={linked || undefined}
      style={toneStyle(topic.subjectName)}
      className={cn('subject-tone relative transition-colors', (linked || open) && 'bg-[var(--sc-faint)]')}>
      {/* An open topic is marked in its subject's colour */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1 bg-[var(--sc)] transition-opacity', open ? 'opacity-100' : 'opacity-0')} />
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/3 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className={cn('truncate text-[15px] text-foreground/90', open ? 'font-semibold text-foreground' : 'font-medium')}>{topic.topicName}</p>
            <p className={cn('shrink-0 text-xs', topic.reviewState === 'due' ? 'font-medium text-amber-300' : 'text-foreground/50')}>
              {reviewLabel(topic)}
            </p>
          </div>
          {/* The bar is the stored level. With no session behind it there is no level to draw. */}
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/6" aria-hidden>
            {verified && <div className={cn('h-full rounded-full', LEVEL_TONE[topic.level])} style={{ width: `${topic.masteryPercent}%` }} />}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-2 text-xs text-foreground/50">
            <span>{verified ? `${LEVEL_LABEL[topic.level]} · ${topic.masteryPercent}%` : LEVEL_LABEL.unverified}</span>
            <span aria-hidden className="text-foreground/20">·</span>
            <span>{sessionsLabel(topic.reviewCount)}</span>
            {topic.lastStudiedAt && <><span aria-hidden className="text-foreground/20">·</span><span>Last studied {relativeDay(topic.lastStudiedAt)}</span></>}
          </p>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-foreground/35 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div id={panel} className="nova-rise border-t border-[var(--sc-edge)] px-4 py-4 sm:px-5" data-topic-detail={topic.topicName}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            <Fact label="Current level" value={verified ? `${topic.masteryPercent}%` : 'None yet'} />
            <Fact label="Sessions" value={String(topic.reviewCount)} />
            <Fact label="Retention now" value={topic.lastStudiedAt ? `about ${topic.retentionPercent}%` : 'Unknown'} />
            <Fact
              label="Next review"
              value={topic.reviewState === 'due' ? (topic.daysOverdue > 0 ? `Due, ${topic.daysOverdue} day${topic.daysOverdue === 1 ? '' : 's'} overdue` : 'Due now')
                : topic.nextReviewAt ? sentenceCase(relativeDay(topic.nextReviewAt)) : 'Not scheduled'}
            />
          </dl>
          <p className="mt-4 max-w-prose text-xs leading-relaxed text-foreground/45">
            {verified
              ? `The level is a running estimate built over ${topic.reviewCount === 1 ? '1 finished session' : `${topic.reviewCount} finished sessions`}, from how you said each one went. A session where you didn't say counts as neutral. It is not a test score. Retention is an estimate from the time since you last studied it.`
              : 'Nova has only heard about this topic in conversation. It gets a level after your first focused session on it.'}
          </p>
          <div className="mt-4">
            <p className="text-xs font-medium text-foreground/55">Recent sessions</p>
            {topic.recentSessions.length > 0
              ? <ul className="mt-2 space-y-1.5">{topic.recentSessions.map(s => <SessionLine key={s.id} session={s} />)}</ul>
              : <p className="mt-2 text-sm text-foreground/45">None in the last 90 days.</p>}
          </div>
          <TopicNotes subjectId={subjectId} topicName={topic.topicName} />
          {actions.onOpenTopic && (
            <TopicConnections map={actions.map ?? null} topicId={topic.id} topicName={topic.topicName} onOpenTopic={actions.onOpenTopic} />
          )}
          {actions.onStudy && (
            <button type="button" onClick={() => actions.onStudy!(topic)} disabled={actions.studying != null} className={cn(BUTTON_PRIMARY, 'mt-5 h-9 px-3.5')}>
              {actions.studying === topic.id
                ? <><Loader2 aria-hidden className="size-3.5 animate-spin" /> Starting…</>
                : <><Play aria-hidden className="size-3" /> Study this · 25 min</>}
            </button>
          )}
          {onChanged && (
            <div className="mt-4 border-t border-white/6 pt-3">
              <button type="button" disabled={archiving} data-archive-topic
                onClick={async () => {
                  if (!window.confirm(`Archive ${topic.topicName}? It leaves your plan and lists. Its level, sessions, notes and history stay, and you can restore it.`)) return
                  setArchiving(true); setArchiveError(null)
                  const error = await postArchive(topic.id, true)
                  setArchiving(false)
                  if (error) setArchiveError(error); else onChanged()
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40">
                {archiving ? 'Archiving…' : 'Archive this topic'}
              </button>
              {archiveError && <p role="alert" className="mt-2 text-xs text-amber-200/90">{archiveError}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-foreground/40">{label}</dt>
      <dd className="mt-1 text-sm text-foreground/85">{value}</dd>
    </div>
  )
}

// A subject and the topics Nova has on record under it. Topics are never
// made up from the subject's name: a subject with none says so.
export function SubjectTopics({ subject, focusTopic = null, showHeading = true, actions, onChanged }: {
  subject:      KnowledgeSubject
  // A topic to open and bring into view, from elsewhere on the page. `n`
  // changes each time it is asked for, so asking twice opens it twice.
  focusTopic?:  { id: string; n: number } | null
  showHeading?: boolean
  actions?:     TopicActions
  // Archive and restore refresh the page through this (Subject Studio's).
  onChanged?:   () => void
}) {
  const { topicCount, dueCount } = subject.summary
  // ?subject=<id>, from the Knowledge Map: this subject is brought into view.
  const [linked, setLinked] = useState(false)
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    if (linkedId('subject') !== subject.subjectId) return
    setLinked(true)
    section.current?.scrollIntoView({ block: 'start' })
  }, [subject.subjectId])
  return (
    <section ref={section} data-subject={subject.subjectName} aria-label={subject.subjectName} data-linked={linked || undefined} className="scroll-mt-24">
      {showHeading && (
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{subject.subjectName}</h3>
          <p className="text-xs text-foreground/55">
            {topicCount === 0 ? 'No topics yet' : `${topicCount} topic${topicCount === 1 ? '' : 's'}${dueCount > 0 ? ` · ${dueCount} due` : ''}`}
          </p>
        </div>
      )}
      {topicCount === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-white/12 px-4 py-4 text-sm text-foreground/60" data-empty="topics">
          Nova hasn&apos;t built enough topic evidence here yet. Finish a focused session on something in {subject.subjectName} and it will appear.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8">
          {subject.topics.map(topic => <TopicRow key={topic.id} topic={topic} subjectId={subject.subjectId} focus={focusTopic?.id === topic.id ? focusTopic.n : 0} actions={actions} onChanged={onChanged} />)}
        </ul>
      )}
    </section>
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

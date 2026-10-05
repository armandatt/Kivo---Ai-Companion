'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeSession, KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import { minutesLabel, relativeDay, sentenceCase } from '../format'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import { fetchNotes } from '../notes/notes-api'
import { LEVEL_LABEL, LEVEL_TONE, OUTCOME_LABEL, reviewLabel, sessionsLabel } from './labels'

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

function TopicRow({ topic, subjectId }: { topic: KnowledgeTopic; subjectId: string }) {
  const [open, setOpen] = useState(false)
  const verified = topic.level !== 'unverified'
  const panel = `topic-${topic.id}`

  return (
    <li data-topic={topic.topicName} data-level={topic.level} data-review={topic.reviewState}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/3 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[15px] font-medium text-foreground/90">{topic.topicName}</p>
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
        <div id={panel} className="border-t border-white/6 bg-white/2 px-4 py-4 sm:px-5" data-topic-detail={topic.topicName}>
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
export function SubjectTopics({ subject }: { subject: KnowledgeSubject }) {
  const { topicCount, dueCount } = subject.summary
  return (
    <section data-subject={subject.subjectName} aria-label={subject.subjectName}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-base font-semibold tracking-tight text-foreground">{subject.subjectName}</h3>
        <p className="text-xs text-foreground/45">
          {topicCount === 0 ? 'No topics yet' : `${topicCount} topic${topicCount === 1 ? '' : 's'}${dueCount > 0 ? ` · ${dueCount} due` : ''}`}
        </p>
      </div>
      {topicCount === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-white/10 px-5 py-4 text-sm text-foreground/50" data-empty="topics">
          Nova hasn&apos;t built enough topic evidence here yet. Finish a focused session on something in {subject.subjectName} and it will appear.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/6 overflow-hidden rounded-2xl border border-white/8 bg-card/40">
          {subject.topics.map(topic => <TopicRow key={topic.id} topic={topic} subjectId={subject.subjectId} />)}
        </ul>
      )}
    </section>
  )
}

export function RecentLearning({ sessions }: { sessions: KnowledgeSession[] }) {
  if (sessions.length === 0) return null
  return (
    <section aria-labelledby="knowledge-recent" className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="recent-learning">
      <h2 id="knowledge-recent" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Recent learning</h2>
      <ul className="mt-4 space-y-3.5">
        {sessions.map(s => (
          <li key={s.id} data-session={s.id} data-measured={s.measured}>
            <p className="truncate text-sm text-foreground/85">{s.topicName ?? 'Study session'}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-foreground/45">
              <span>{relativeDay(s.date)}</span>
              <span aria-hidden className="text-foreground/20">·</span>
              <span>{s.measured && s.minutes !== null ? minutesLabel(s.minutes) : 'reported in chat, not timed'}</span>
              {s.outcome && <><span aria-hidden className="text-foreground/20">·</span><span className="text-foreground/65">{OUTCOME_LABEL[s.outcome]}</span></>}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

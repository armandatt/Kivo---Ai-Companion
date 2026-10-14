'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, Bookmark, FileText, Map, Search } from 'lucide-react'
import type { NovaKnowledgeReady } from '@repo/api/nova/product/knowledge.types'
import { useStartSession } from '../use-start-session'
import { DueReviews } from './due-reviews'
import { RecentLearning, SubjectTopics } from './subject-topics'

const quickLinks = [
  { href: '/home', label: 'Today', icon: BookOpen },
  { href: '/notes', label: 'Notes', icon: FileText },
  { href: '/saved', label: 'Saved pages', icon: Bookmark },
  { href: '/map', label: 'Knowledge map', icon: Map },
]

// What Nova has on record about each topic, what is due, and the sessions
// behind it. Read-only: a topic changes when a session on it ends.
export function NovaKnowledge({ view }: { view: NovaKnowledgeReady }) {
  const { start, starting, error } = useStartSession()
  const [query, setQuery] = useState('')
  const noSubjects = view.totals.subjectCount === 0
  const noTopics   = view.totals.topicCount === 0
  const normalizedQuery = query.trim().toLowerCase()
  const subjects = useMemo(() => {
    if (!normalizedQuery) return view.subjects
    return view.subjects
      .map(subject => ({ ...subject, topics: subject.topics.filter(topic => topic.topicName.toLowerCase().includes(normalizedQuery)) }))
      .filter(subject => subject.subjectName.toLowerCase().includes(normalizedQuery) || subject.topics.length > 0)
  }, [normalizedQuery, view.subjects])

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-8 lg:pt-2">
      <header className="border-b border-white/8 pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-keppel-300/80">Knowledge Space</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Your learning, connected</h1>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
              Revisit what you&apos;ve studied, keep your notes close, and choose the next useful action.
            </p>
          </div>
          <Link href="/home" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:border-keppel-400/50 hover:text-foreground">
            Back to Today <ArrowRight className="size-4" />
          </Link>
        </div>
        <nav aria-label="Knowledge navigation" className="mt-6 flex flex-wrap gap-2">
          {quickLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors ${href === '/map' ? 'bg-keppel-400/10 text-keppel-200' : 'text-foreground/55 hover:bg-white/5 hover:text-foreground'}`}>
              <Icon className="size-3.5" /> {label}
            </Link>
          ))}
        </nav>
      </header>

      {!noSubjects && (
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-5 text-sm text-foreground/55">
            <span><strong className="font-medium text-foreground">{view.totals.subjectCount}</strong> subjects</span>
            <span><strong className="font-medium text-foreground">{view.totals.topicCount}</strong> topics</span>
            <span><strong className="font-medium text-foreground">{view.totals.dueCount}</strong> due</span>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Search subjects and topics</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search topics…" className="h-10 w-full rounded-xl border border-white/10 bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none" />
          </label>
        </div>
      )}

      {noSubjects ? (
        <section className="mt-8 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-empty="subjects">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Nova doesn&apos;t have enough learning context yet</h2>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60">
            It doesn&apos;t know which subjects you are taking. Tell it on Today and this page will start to fill in.
          </p>
          <Link href="/home" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
            Go to Today
          </Link>
        </section>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-10">
            {view.activeSession && (
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-keppel-400/25 bg-card/70 p-4 sm:p-5" data-active-session>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-keppel-300/90">Session in progress</p>
                  <p className="mt-1 truncate text-base font-medium text-foreground">{view.activeSession.topicName ?? 'Study session'}</p>
                </div>
                <Link href="/focus" className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
                  Resume
                </Link>
              </div>
            )}

            <DueReviews
              reviews={view.dueReviews}
              hasTopics={!noTopics}
              blocked={view.activeSession !== null}
              onStart={review => void start({ topicName: review.topicName, subjectName: review.subjectName, durationMinutes: review.reviewMinutes }, review.id)}
              starting={starting}
              error={error}
            />

            <section aria-labelledby="knowledge-subjects">
              <h2 id="knowledge-subjects" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Subjects</h2>
              {noTopics && (
                <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/55" data-empty="knowledge">
                  Start a focused session and Nova will begin building your knowledge map.
                </p>
              )}
              <div className="mt-5 space-y-8">
                {subjects.length > 0 ? subjects.map(subject => <SubjectTopics key={subject.subjectName} subject={subject} />) : (
                  <p className="rounded-2xl border border-dashed border-white/10 px-5 py-6 text-sm text-foreground/55">No subjects or topics match that search.</p>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <RecentLearning sessions={view.recentLearning} />
            <section className="rounded-2xl border border-white/8 bg-card/50 p-5">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">How to read this</h2>
              <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/60">
                <li>A topic&apos;s level moves with how you say each session went. It is an estimate, not a test result.</li>
                <li>The more sessions behind a topic, the more that level is worth.</li>
                <li>A topic is due when its scheduled review date arrives. How you said the last session went sets that date.</li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}

'use client'

import Link from 'next/link'
import type { NovaKnowledgeReady } from '@repo/api/nova/product/knowledge.types'
import { useStartSession } from '../use-start-session'
import { DueReviews } from './due-reviews'
import { RecentLearning, SubjectTopics } from './subject-topics'

// What Nova has on record about each topic, what is due, and the sessions
// behind it. Read-only: a topic changes when a session on it ends.
export function NovaKnowledge({ view }: { view: NovaKnowledgeReady }) {
  const { start, starting, error } = useStartSession()
  const noSubjects = view.totals.subjectCount === 0
  const noTopics   = view.totals.topicCount === 0

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Your Knowledge</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          Nova tracks what you&apos;ve studied, how your understanding is developing, and when topics are worth revisiting.
        </p>
      </header>

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
                {view.subjects.map(subject => <SubjectTopics key={subject.subjectName} subject={subject} />)}
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

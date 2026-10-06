'use client'

import Link from 'next/link'
import type { NovaProgressReady } from '@repo/api/nova/product/progress.types'
import { calendarDate, inDays, minutesLabel } from '../format'
import { Consistency } from './consistency'
import { Growth } from './growth'
import { Journey } from './journey'

function Stat({ id, label, value, hint }: { id: string; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-card/50 p-4 sm:p-5" data-stat={id}>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-foreground/40">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tracking-tight text-foreground" data-stat-value>{value}</dd>
      <p className="mt-1 text-xs text-foreground/45">{hint}</p>
    </div>
  )
}

function notCountedLine(n: NovaProgressReady['overview']['notCounted']): string | null {
  const parts: string[] = []
  if (n.selfReported > 0) parts.push(`${n.selfReported} you told Nova about in chat (not timed)`)
  if (n.underTenMinutes > 0) parts.push(`${n.underTenMinutes} under 10 minutes`)
  return parts.length > 0 ? `Not counted here: ${parts.join(', and ')}.` : null
}

// "Have I actually changed?" The server answers; this page lays the answer
// out. It computes nothing about the learner.
export function NovaProgress({ view }: { view: NovaProgressReady }) {
  const { overview, consistency } = view
  const notCounted = notCountedLine(overview.notCounted)

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4" data-progress={view.hasEvidence ? 'ready' : 'empty'}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Your Learning Journey</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          {view.hasEvidence && overview.since
            ? `What has changed since your first session on ${calendarDate(overview.since, consistency.timezone)}, from the sessions you finished and how you said they went.`
            : 'What changes as you study, from the sessions you finish and how you say they went.'}
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {!view.hasEvidence ? (
            <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-empty="progress">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Your journey starts with your first session</h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60">
                Nova has no finished session of 10 minutes or more on record yet, so there is nothing to show and nothing is made up. Finish one and it appears here.
              </p>
              {notCounted && <p className="mt-3 max-w-prose text-xs leading-relaxed text-foreground/45" data-not-counted>{notCounted}</p>}
              <Link href="/home" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
                Go to Today
              </Link>
            </section>
          ) : (
            <>
              <section aria-label="Overview">
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat id="minutes" label="Learning time" value={minutesLabel(overview.learningMinutes)} hint="Timed study, pauses left out" />
                  <Stat id="sessions" label="Sessions" value={String(overview.sessions)} hint="Finished, 10 minutes or more" />
                  <Stat id="active-days" label="Active days" value={String(overview.activeDays)} hint="In the last year" />
                  <Stat id="topics-improved" label="Topics improved" value={String(overview.topicsImproved)} hint="See Your growth" />
                </dl>
                {notCounted && <p className="mt-3 text-xs leading-relaxed text-foreground/45" data-not-counted>{notCounted}</p>}
              </section>

              {view.changes.length > 0 && (
                <section aria-labelledby="progress-changes" data-section="changes">
                  <h2 id="progress-changes" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">What changed?</h2>
                  <ul className="mt-4 space-y-2.5 rounded-2xl border border-white/8 bg-card/50 p-4 sm:p-5">
                    {view.changes.map(change => (
                      <li key={change.text} data-change={change.kind} className="flex gap-3 text-[15px] leading-relaxed text-foreground/85">
                        <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-keppel-400" />
                        <span>{change.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Growth growth={view.growth} />
              <Consistency consistency={consistency} />
              <Journey events={view.journey} timezone={consistency.timezone} />
            </>
          )}
        </div>

        <aside className="space-y-6">
          {view.nextExam && (
            <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="next-exam">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Next milestone</h2>
              <p className="mt-3 text-base font-medium text-foreground">{view.nextExam.title}</p>
              <p className="mt-1 text-sm text-foreground/60">
                {view.nextExam.subjectName ? `${view.nextExam.subjectName} · ` : ''}{calendarDate(view.nextExam.date, consistency.timezone)} · {inDays(view.nextExam.daysUntil)}
              </p>
            </section>
          )}

          {view.goals.length > 0 && (
            <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="goals">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">What you&apos;re working toward</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/80">
                {view.goals.map(goal => <li key={goal}>{goal}</li>)}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-foreground/40">In your words, from setup. Nova doesn&apos;t track how far along these are.</p>
            </section>
          )}

          {view.usualSession && (
            <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="usual-session">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Your usual session</h2>
              <p className="mt-3 text-base font-medium text-foreground">About {minutesLabel(view.usualSession.minutes)}</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground/45">
                The middle of your last {view.usualSession.basedOnSessions} sessions.{' '}
                <Link href="/learning-dna" className="text-keppel-300 hover:text-keppel-200">See how Nova knows</Link>
              </p>
            </section>
          )}

          <section className="rounded-2xl border border-white/8 bg-card/50 p-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">How to read this</h2>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/60">
              <li>Everything here comes from sessions you finished. Chat messages and notes don&apos;t count as study.</li>
              <li>A topic&apos;s level moves with how you say each session went. It is an estimate, not a test result.</li>
              <li>A comeback is a session after 4 or more days away.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

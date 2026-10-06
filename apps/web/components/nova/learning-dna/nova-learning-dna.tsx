'use client'

import Link from 'next/link'
import type { DnaSection, DnaSignalView, NovaLearningDnaReady } from '@repo/api/nova/product/learning-dna.types'
import { Confidence, LEVEL_LABEL, PendingSignal, SignalCard, TrendChip } from './signal-card'

const SECTIONS: Array<{ id: DnaSection; title: string; empty: string }> = [
  { id: 'rhythm',    title: 'Your rhythm',         empty: 'Nova has no rhythm to describe yet.' },
  { id: 'works',     title: 'What works for you',  empty: 'Nova has not seen one way of studying go better than another yet.' },
  { id: 'struggles', title: 'Where you struggle',  empty: 'Nothing stands out.' },
]

function Section({ id, title, empty, signals }: { id: DnaSection; title: string; empty: string; signals: DnaSignalView[] }) {
  const known   = signals.filter(s => s.level !== 'unknown' && s.value)
  const pending = signals.filter(s => s.level === 'unknown' || !s.value)
  return (
    <section aria-labelledby={`dna-${id}`} data-section={id}>
      <h2 id={`dna-${id}`} className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">{title}</h2>
      {known.length > 0
        ? <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{known.map(s => <SignalCard key={s.key} signal={s} />)}</div>
        : <p className="mt-3 text-sm text-foreground/55" data-empty={id}>{empty}</p>}
      {pending.length > 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-4 sm:p-5" data-pending-group={id}>
          <p className="text-xs font-medium text-foreground/55">Not enough evidence yet</p>
          <ul className="mt-3 divide-y divide-white/6">{pending.map(s => <PendingSignal key={s.key} signal={s} />)}</ul>
        </div>
      )}
    </section>
  )
}

// What Nova believes about how the learner studies, why, how sure it is and
// whether that is changing. The server decides all four; this lays them out.
export function NovaLearningDna({ view }: { view: NovaLearningDnaReady }) {
  const known    = view.signals.filter(s => s.level !== 'unknown' && s.value)
  const changing = view.signals.filter(s => view.changing.includes(s.key))
  const state    = view.sessionsConsidered === 0 ? 'empty' : known.length === 0 ? 'insufficient' : 'ready'
  const t        = view.thresholds

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4" data-learning-dna={state}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Your Learning DNA</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          {state === 'ready'
            ? 'Nova has learned a few things about how you work. Each one says how sure it is and what it rests on, and each can change.'
            : 'How Nova comes to understand the way you study: from sessions you finish, not from a quiz.'}
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {state === 'empty' && (
            <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-empty="learning-dna">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Nova doesn&apos;t know how you learn yet</h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60">
                It has no finished session of 10 minutes or more from the last {view.windowDays} days to learn from, and it won&apos;t guess.
                After {t.emerging} sessions the first signals appear here.
              </p>
              <Link href="/home" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
                Go to Today
              </Link>
            </section>
          )}

          {state === 'insufficient' && (
            <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-insufficient>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Still learning how you work</h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60">
                Nova has {view.sessionsConsidered} finished {view.sessionsConsidered === 1 ? 'session' : 'sessions'} from the last {view.windowDays} days.
                That is too few to say anything about you: {view.sessionsConsidered === 1 ? 'one session is' : 'a handful of sessions are'} not a pattern.
                The first signals need {t.emerging}.
              </p>
            </section>
          )}

          {state !== 'empty' && SECTIONS.map(s => <Section key={s.id} {...s} signals={view.signals.filter(x => x.section === s.id)} />)}

          {state === 'ready' && (
            <section aria-labelledby="dna-changing" data-section="changing">
              <h2 id="dna-changing" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Changing</h2>
              {changing.length === 0 ? (
                <p className="mt-3 text-sm text-foreground/55" data-empty="changing">Nothing is moving right now. Your recent sessions agree with what Nova already believed.</p>
              ) : (
                <ul className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40">
                  {changing.map(s => (
                    <li key={s.key} data-changing={s.key} className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-foreground/90">{s.label}: <span className="text-foreground/65">{s.headline}</span></p>
                        <TrendChip trend={s.trend} />
                      </div>
                      {s.trendNote && <p className="mt-1 text-xs leading-relaxed text-foreground/55">{s.trendNote}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="how-nova-knows">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">How Nova knows</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <dt className="text-xs text-foreground/45">Sessions used</dt>
                <dd className="mt-0.5 text-lg font-semibold text-foreground" data-sessions-used>{view.sessionsConsidered}</dd>
              </div>
              <div>
                <dt className="text-xs text-foreground/45">With your answer</dt>
                <dd className="mt-0.5 text-lg font-semibold text-foreground" data-answered>{view.answeredSessions}</dd>
              </div>
            </dl>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/60">
              <li>Only finished, timed sessions of 10 minutes or more from the last {view.windowDays} days. Chat messages and notes are not evidence.</li>
              <li>&ldquo;Went well&rdquo; means you answered Good or Crushed it. Nova has no other measure.</li>
              <li>{LEVEL_LABEL.emerging} from {t.emerging}, {LEVEL_LABEL.supported.toLowerCase()} from {t.supported}, {LEVEL_LABEL.strong.toLowerCase()} from {t.strong} pieces of evidence.</li>
              <li>&ldquo;This works better than that&rdquo; needs {t.perSide} answered sessions on each side and a {t.leadPoints}-point lead.</li>
              <li>Typical values are the middle of your sessions, so one unusual day does not move them.</li>
              <li>These are patterns in how your sessions went, not proof of what caused them. A hard topic can make a session length look worse than it is.</li>
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-foreground/45" data-timezone={view.timezone ?? 'unknown'}>
              {view.timezone
                ? `Times of day are in ${view.timezone} time.`
                : 'Nova doesn’t know your timezone, so it says nothing about time of day.'}
            </p>
          </section>

          {view.statedStudyTime && (
            <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="stated">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">What you told Nova</h2>
              <p className="mt-3 text-sm leading-relaxed text-foreground/80">You said you study in the {view.statedStudyTime}.</p>
              <p className="mt-2 text-xs leading-relaxed text-foreground/45">That is your word, not something Nova worked out. Usual study time, on the left, is what your sessions show.</p>
            </section>
          )}

          {known.length > 0 && (
            <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="evidence">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Behind each belief</h2>
              <ul className="mt-4 space-y-3.5">
                {known.map(s => (
                  <li key={s.key} data-evidence={s.key}>
                    <p className="text-sm text-foreground/85">{s.label}</p>
                    <div className="mt-1"><Confidence signal={s} /></div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="not-tracked">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">What Nova doesn&apos;t know</h2>
            <ul className="mt-4 space-y-3">
              {view.notTracked.map(n => (
                <li key={n.label}>
                  <p className="text-sm text-foreground/80">{n.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground/45">{n.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

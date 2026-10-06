'use client'

import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProgressGrowth, ProgressTopic } from '@repo/api/nova/product/progress.types'
import { LEVEL_LABEL, LEVEL_TONE, OUTCOME_LABEL, sessionsLabel } from '../knowledge/labels'

// One topic: where its estimate stands, where it stood when a starting point
// is on record, and the learner's own answers. Nothing is drawn that the
// server did not send: a topic with no recorded movement gets no "from" mark.
function TopicGrowthRow({ topic }: { topic: ProgressTopic }) {
  const { change } = topic
  return (
    <li data-topic={topic.topicName} data-direction={topic.direction} className="px-4 py-3.5 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] font-medium text-foreground/90">{topic.topicName}</p>
        <p className="shrink-0 text-xs text-foreground/50">{topic.subjectName}</p>
      </div>

      <div className="relative mt-2 h-1.5 rounded-full bg-white/6" aria-hidden>
        <div className={cn('h-full rounded-full', LEVEL_TONE[topic.level])} style={{ width: `${topic.masteryPercent}%` }} />
        {change && (
          <span
            data-from-mark
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-foreground/60"
            style={{ left: `${change.fromPercent}%` }}
          />
        )}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/55">
        {topic.direction === 'improving' && <ArrowUpRight className="size-3.5 text-keppel-300" aria-hidden />}
        {topic.direction === 'needs_attention' && <ArrowDownRight className="size-3.5 text-amber-300" aria-hidden />}
        <span className={cn(topic.direction === 'improving' && 'text-keppel-200', topic.direction === 'needs_attention' && 'text-amber-200/90')} data-reason>
          {topic.reason}
        </span>
        <span aria-hidden className="text-foreground/20">·</span>
        <span>{LEVEL_LABEL[topic.level]} · {topic.masteryPercent}%</span>
        <span aria-hidden className="text-foreground/20">·</span>
        <span>{sessionsLabel(topic.sessions)}</span>
      </p>

      {topic.outcomes.length > 1 && (
        <ol className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="How you said each session went, oldest first" data-outcomes>
          {topic.outcomes.map((o, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-foreground/25">→</span>}
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-foreground/70">{OUTCOME_LABEL[o]}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

function Group({ id, title, hint, topics }: { id: string; title: string; hint: string; topics: ProgressTopic[] }) {
  if (topics.length === 0) return null
  return (
    <div data-growth-group={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground/85">{title} <span className="text-foreground/40">{topics.length}</span></h3>
        <p className="text-xs text-foreground/40">{hint}</p>
      </div>
      <ul className="mt-2.5 divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40">
        {topics.map(t => <TopicGrowthRow key={t.topicId} topic={t} />)}
      </ul>
    </div>
  )
}

export function Growth({ growth }: { growth: ProgressGrowth }) {
  const total = growth.improving.length + growth.steady.length + growth.needsAttention.length + growth.justStarted.length
  return (
    <section aria-labelledby="progress-growth" data-section="growth">
      <h2 id="progress-growth" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Your growth</h2>
      {total === 0 ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/55" data-empty="growth">
          No topic has a finished session behind it yet. Start a session on a topic and tell Nova how it went; this is where it will show.
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-foreground/45">
            Each bar is Nova&apos;s current estimate for the topic. The thin mark is where it stood earlier, shown only when that is on record.
          </p>
          <div className="mt-5 space-y-7">
            <Group id="improving" title="Improving" hint="Up 10 points or more, or better answers" topics={growth.improving} />
            <Group id="needs_attention" title="Needs attention" hint="Slipping, struggling or still weak" topics={growth.needsAttention} />
            <Group id="steady" title="Steady" hint="Holding where it was" topics={growth.steady} />
            <Group id="just_started" title="Just started" hint="One session: nothing to compare yet" topics={growth.justStarted} />
          </div>
        </>
      )}
    </section>
  )
}

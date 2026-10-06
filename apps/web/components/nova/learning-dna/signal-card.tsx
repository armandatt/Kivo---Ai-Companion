'use client'

import { cn } from '@/lib/utils'
import type { DnaLevel, DnaSignalView, DnaTrend, DnaValue } from '@repo/api/nova/product/learning-dna.types'
import { relativeDay } from '../format'

export const LEVEL_LABEL: Record<Exclude<DnaLevel, 'unknown'>, string> = {
  emerging:  'Early signal',
  supported: 'Supported',
  strong:    'Strong',
}
const LEVEL_DOTS: Record<Exclude<DnaLevel, 'unknown'>, number> = { emerging: 1, supported: 2, strong: 3 }

export const TREND_LABEL: Record<DnaTrend, string> = {
  new:           'New',
  strengthening: 'Strengthening',
  steady:        'Steady',
  weakening:     'Weakening',
  changed:       'Changed',
}

export function Confidence({ signal }: { signal: DnaSignalView }) {
  if (signal.level === 'unknown') return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/55" data-confidence={signal.level}>
      <span className="flex items-center gap-1" aria-hidden>
        {[1, 2, 3].map(i => <span key={i} className={cn('size-1.5 rounded-full', i <= LEVEL_DOTS[signal.level as Exclude<DnaLevel, 'unknown'>] ? 'bg-keppel-400' : 'bg-white/12')} />)}
      </span>
      <span className="text-foreground/75">{LEVEL_LABEL[signal.level]}</span>
      <span aria-hidden className="text-foreground/20">·</span>
      <span data-evidence-count>{signal.evidenceCount} {signal.evidenceUnit}</span>
      {signal.lastUpdated && <><span aria-hidden className="text-foreground/20">·</span><span>latest {relativeDay(signal.lastUpdated)}</span></>}
    </p>
  )
}

export function TrendChip({ trend }: { trend: DnaTrend | null }) {
  if (!trend || trend === 'steady') return null
  return (
    <span data-trend={trend} className={cn(
      'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
      trend === 'weakening' ? 'border-amber-300/30 text-amber-200' : 'border-keppel-400/30 text-keppel-200',
    )}>
      {TREND_LABEL[trend]}
    </span>
  )
}

function Share({ label, part, of, lead }: { label: string; part: number; of: number; lead?: boolean }) {
  return (
    <li className="text-xs text-foreground/60" data-share={label}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn(lead && 'text-foreground/85')}>{label}</span>
        <span className="shrink-0 tabular-nums">{part} of {of} went well</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/6" aria-hidden>
        <div className={cn('h-full rounded-full', lead ? 'bg-keppel-400' : 'bg-keppel-400/40')} style={{ width: `${(part / of) * 100}%` }} />
      </div>
    </li>
  )
}

// The detail under a headline. Everything drawn is a number the server sent.
function Detail({ value }: { value: DnaValue }) {
  switch (value.kind) {
    case 'minutes':
      return <p className="text-sm text-foreground/65">Usually between {value.low} and {value.high} minutes.</p>
    case 'percent_of_plan':
      return <p className="text-sm text-foreground/65">A typical session runs {value.typical}% of the length it was planned for.</p>
    case 'days_per_week':
      return <p className="text-sm text-foreground/65">{value.low === value.high ? `${value.typical} in most weeks.` : `Usually between ${value.low} and ${value.high}.`}</p>
    case 'window':
      return <p className="text-sm text-foreground/65">{value.sessions} of your last {value.of} sessions started then.</p>
    case 'comparison':
      return (
        <ul className="space-y-2.5">
          <Share label={value.label} part={value.wentWell} of={value.of} lead />
          {value.against.map(a => <Share key={a.label} label={a.label} part={a.wentWell} of={a.of} />)}
        </ul>
      )
    case 'topics':
      return (
        <ul className="divide-y divide-white/6">
          {value.topics.map(t => (
            <li key={`${t.subjectName}:${t.topicName}`} data-struggle-topic={t.topicName} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="text-sm text-foreground/90">{t.topicName}</span>
                {t.subjectName && <span className="text-xs text-foreground/45"> · {t.subjectName}</span>}
              </span>
              <span className="shrink-0 text-xs text-foreground/60">
                Struggled in {t.struggled} of {t.answered}{t.masteryPercent !== null ? ` · ${t.masteryPercent}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      )
  }
}

// One belief: what Nova concludes, how well supported it is, why, and
// whether it is moving.
export function SignalCard({ signal }: { signal: DnaSignalView }) {
  if (signal.level === 'unknown' || !signal.value) return null
  return (
    <article data-signal={signal.key} data-level={signal.level} className="rounded-2xl border border-white/8 bg-card/50 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-foreground/40">{signal.label}</p>
        <TrendChip trend={signal.trend} />
      </div>
      {signal.value.kind !== 'topics' && <p className="mt-2 text-xl font-semibold tracking-tight text-foreground" data-headline>{signal.headline}</p>}
      <div className="mt-2.5"><Detail value={signal.value} /></div>

      <div className="mt-4 border-t border-white/6 pt-3.5">
        <Confidence signal={signal} />
        <p className="mt-2 text-xs leading-relaxed text-foreground/50" data-explanation>{signal.explanation}</p>
        {signal.trendNote && (
          <p className={cn('mt-2 text-xs leading-relaxed', signal.trend === 'weakening' ? 'text-amber-200/90' : 'text-keppel-200/90')} data-trend-note>{signal.trendNote}</p>
        )}
      </div>
    </article>
  )
}

// A signal Nova has no conclusion for: what it would need, and nothing else.
export function PendingSignal({ signal }: { signal: DnaSignalView }) {
  return (
    <li data-pending={signal.key} className="py-3 first:pt-0 last:pb-0">
      <p className="text-sm text-foreground/75">{signal.label}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-foreground/45">{signal.explanation}</p>
    </li>
  )
}

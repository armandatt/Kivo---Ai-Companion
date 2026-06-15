'use client'

import { Scale, Apple, Target, TrendingDown } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { PlannerPageData, ReviewType, TimelineEntry } from './use-planner-data'

type Props = {
  next7Days: PlannerPageData['next7Days']
  loading:   boolean
}

const REVIEW_ICONS: Record<ReviewType, React.ElementType> = {
  weight:    Scale,
  nutrition: Apple,
  goal:      Target,
  plateau:   TrendingDown,
}

const REVIEW_COLORS: Record<ReviewType, string> = {
  weight:    'text-sky-400',
  nutrition: 'text-emerald-400',
  goal:      'text-violet-400',
  plateau:   'text-amber-400',
}

function WorkoutPill({ entry }: { entry: TimelineEntry }) {
  if (!entry.workout) return null
  const { status, muscles } = entry.workout
  const cls =
    status === 'completed' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
    status === 'skipped'   ? 'bg-amber-500/15 text-amber-400/70 border-amber-500/20 line-through' :
                             'bg-white/5 text-white/50 border-white/10'
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${cls} leading-tight block truncate max-w-full`}>
      {muscles}
    </span>
  )
}

function DayCell({ entry }: { entry: TimelineEntry }) {
  const todayCls = entry.isToday
    ? 'border-emerald-500/40 bg-emerald-500/5'
    : entry.isPast
    ? 'border-white/5 bg-white/2'
    : 'border-white/5 bg-white/2'

  return (
    <div className={`flex-1 flex flex-col gap-1.5 rounded-xl border px-2 py-2.5 min-w-0 ${todayCls}`}>
      {/* Day header */}
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold ${entry.isToday ? 'text-emerald-400' : 'text-white/30'}`}>
          {entry.dayName}
        </span>
        {entry.isToday && (
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        )}
      </div>

      {/* Workout pill */}
      <WorkoutPill entry={entry} />

      {/* Review icons */}
      {entry.reviews.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {entry.reviews.map((r, i) => {
            const Icon = REVIEW_ICONS[r.type]
            return (
              <Icon
                key={i}
                className={`w-3 h-3 ${REVIEW_COLORS[r.type]}`}
                title={r.label}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function WeekTimeline({ next7Days, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-28 animate-pulse" />
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-4">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-3">
        This Week
      </p>
      <div className="flex gap-1.5">
        {next7Days.map(entry => (
          <DayCell key={entry.dateISO} entry={entry} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mt-3 flex-wrap">
        {(Object.entries(REVIEW_ICONS) as [ReviewType, React.ElementType][]).map(([type, Icon]) => (
          <div key={type} className="flex items-center gap-1">
            <Icon className={`w-2.5 h-2.5 ${REVIEW_COLORS[type]}`} />
            <span className="text-[9px] text-white/25 capitalize">{type}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

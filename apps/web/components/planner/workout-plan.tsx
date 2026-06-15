'use client'

import { CheckCircle2, Circle, ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { PlannerPageData, SplitDay } from './use-planner-data'

type Props = {
  workoutPlan: PlannerPageData['workoutPlan']
  loading:     boolean
}

function DayRow({ day }: { day: SplitDay }) {
  return (
    <div className={[
      'flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0',
      day.isNext ? 'opacity-100' : day.isDone ? 'opacity-40' : 'opacity-70',
    ].join(' ')}>
      <span className="text-[10px] text-white/30 w-5 tabular-nums shrink-0">
        {day.dayNumber}
      </span>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${day.isNext ? 'text-white font-semibold' : 'text-white/60'} truncate`}>
          {day.muscles}
        </span>
      </div>
      <div className="shrink-0">
        {day.isDone ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500/60" />
        ) : day.isNext ? (
          <ArrowRight className="w-4 h-4 text-emerald-400" />
        ) : (
          <Circle className="w-4 h-4 text-white/15" />
        )}
      </div>
    </div>
  )
}

export function WorkoutPlan({ workoutPlan, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-40 animate-pulse" />
  }

  if (!workoutPlan) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <p className="text-sm text-white/40">No workout split configured.</p>
      </Card>
    )
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[11px] text-white/30 uppercase tracking-wider font-semibold mb-0.5">
            Workout Plan
          </p>
          <h3 className="text-sm font-bold text-white">{workoutPlan.splitName}</h3>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-emerald-400 tabular-nums leading-none">
            {workoutPlan.totalSessions}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">sessions</p>
        </div>
      </div>

      {/* Frequency badge */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[10px] font-medium text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
          {workoutPlan.daysPerWeek}×/week
        </span>
        {workoutPlan.lastSessionDate && (
          <span className="text-[10px] text-white/25">
            Last: {workoutPlan.lastSessionDate}
          </span>
        )}
      </div>

      {/* Days list */}
      <div>
        {workoutPlan.days.map(day => (
          <DayRow key={day.dayNumber} day={day} />
        ))}
      </div>
    </Card>
  )
}

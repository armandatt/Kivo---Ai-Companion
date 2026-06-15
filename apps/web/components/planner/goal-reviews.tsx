'use client'

import { Target } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { PlannerPageData } from './use-planner-data'

type Props = {
  goalReview: PlannerPageData['goalReview']
  loading:    boolean
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  ahead:    { label: 'Ahead',    cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  on_track: { label: 'On track', cls: 'text-sky-400 bg-sky-400/10 border-sky-400/30' },
  behind:   { label: 'Behind',   cls: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  unknown:  { label: 'Unknown',  cls: 'text-white/30 bg-white/5 border-white/10' },
}

const OVERALL_CFG: Record<string, string> = {
  on_track: 'text-emerald-400',
  behind:   'text-amber-400',
  critical: 'text-red-400',
  unknown:  'text-white/30',
}

export function GoalReviews({ goalReview, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-36 animate-pulse" />
  }

  if (!goalReview) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Goal</p>
        </div>
        <p className="text-sm text-white/25">No goal configured.</p>
      </Card>
    )
  }

  const {
    goalType, exercise, progressPercent, status, currentValue, targetValue,
    unit, startDate, targetDate, overallStatus, narrative,
  } = goalReview

  const statusCfg = STATUS_CFG[status] ?? STATUS_CFG.unknown

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-4 h-4 text-white/30 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-0.5">Goal</p>
            <p className="text-sm font-semibold text-white capitalize truncate">
              {goalType.replace('_', ' ')}{exercise ? ` · ${exercise}` : ''}
            </p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${statusCfg.cls}`}>
          {statusCfg.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/40">Progress</span>
          <span className="text-[11px] font-semibold text-white/60 tabular-nums">
            {progressPercent}%
          </span>
        </div>
        <Progress value={progressPercent} className="h-2 bg-white/5" />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-white/20">
            {currentValue !== null ? `${currentValue}${unit}` : '—'}
          </span>
          <span className="text-[10px] text-white/20">
            {targetValue !== null ? `${targetValue}${unit}` : '—'}
          </span>
        </div>
      </div>

      {/* Overall status */}
      <p className={`text-xs font-semibold mb-2 capitalize ${OVERALL_CFG[overallStatus] ?? OVERALL_CFG.unknown}`}>
        {overallStatus.replace('_', ' ')}
      </p>

      {/* Narrative */}
      <p className="text-[11px] text-white/35 leading-relaxed mb-3">{narrative}</p>

      {/* Dates */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <span className="text-[10px] text-white/25">Start: {startDate}</span>
        {targetDate && (
          <span className="text-[10px] text-white/25">Target: {targetDate}</span>
        )}
      </div>
    </Card>
  )
}

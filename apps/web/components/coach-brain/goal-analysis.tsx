'use client'

import { Target, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { CoachPageData } from './use-coach-data'

type Props = { goalAnalysis: CoachPageData['goalAnalysis']; loading: boolean }

const STATUS_CFG = {
  ahead:    { label: 'Ahead',    cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  on_track: { label: 'On track', cls: 'text-sky-400 bg-sky-400/10 border-sky-400/30' },
  behind:   { label: 'Behind',   cls: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  unknown:  { label: 'Unknown',  cls: 'text-white/30 bg-white/5 border-white/10' },
} as const

const OVERALL_COLOR = {
  on_track: 'text-emerald-400',
  behind:   'text-amber-400',
  critical: 'text-red-400',
  unknown:  'text-white/25',
} as const

export function GoalAnalysis({ goalAnalysis, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-44 animate-pulse" />
  }

  if (!goalAnalysis) {
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

  const g = goalAnalysis
  const statusCfg = STATUS_CFG[g.status]

  const WeightIcon =
    g.weightTrend === 'gaining' ? TrendingUp :
    g.weightTrend === 'losing'  ? TrendingDown : Minus

  const weightColor =
    g.weightTrend === 'gaining' ? 'text-emerald-400' :
    g.weightTrend === 'losing'  ? 'text-sky-400'     : 'text-white/30'

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Target className="w-4 h-4 text-white/30 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-0.5">Goal</p>
            <p className="text-sm font-bold text-white capitalize truncate">
              {g.goalType.replace('_', ' ')}{g.exercise ? ` · ${g.exercise}` : ''}
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
          <span className="text-[11px] font-bold text-white/60 tabular-nums">{g.progressPercent}%</span>
        </div>
        <Progress value={g.progressPercent} className="h-2 bg-white/5" />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-white/20">
            {g.currentValue !== null ? `${g.currentValue}${g.unit}` : '—'}
          </span>
          <span className="text-[10px] text-white/20">
            {g.targetValue !== null ? `${g.targetValue}${g.unit}` : '—'}
          </span>
        </div>
      </div>

      {/* ETA */}
      {g.etaLabel && (
        <p className={`text-xs font-semibold mb-3 ${OVERALL_COLOR[g.overallStatus]}`}>
          {g.etaLabel}
        </p>
      )}

      {/* Why */}
      <div className="mb-4">
        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">Why</p>
        <p className="text-[11px] text-white/45 leading-relaxed">{g.whyProgressStatus}</p>
      </div>

      {/* Weight trend */}
      {g.weightTrend && (
        <div className="flex items-center gap-2 pt-3 border-t border-white/5">
          <WeightIcon className={`w-3.5 h-3.5 ${weightColor}`} />
          <p className={`text-[11px] font-medium capitalize ${weightColor}`}>
            {g.weightTrend}
            {g.weeklyRateKg !== null && g.weeklyRateKg !== 0 && (
              <span className="text-white/30 font-normal">
                {' '}({g.weeklyRateKg > 0 ? '+' : ''}{g.weeklyRateKg}kg/week)
              </span>
            )}
            {g.weightStalled && <span className="text-white/30 font-normal"> — stalled</span>}
          </p>
        </div>
      )}

      {/* Dates */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
        <span className="text-[10px] text-white/20">Start: {g.startDate}</span>
        {g.targetDate && (
          <span className="text-[10px] text-white/20">Target: {g.targetDate}</span>
        )}
      </div>
    </Card>
  )
}

'use client'

import { Target, Calendar, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData, GoalStatus } from './use-goals-data'

type Props = { primaryGoal: GoalsPageData['primaryGoal']; loading: boolean }

const STATUS_CFG: Record<GoalStatus, { label: string; color: string; bg: string }> = {
  ahead:    { label: 'Ahead',    color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20' },
  on_track: { label: 'On Track', color: 'text-sky-400',     bg: 'bg-sky-400/10 border-sky-400/20' },
  behind:   { label: 'Behind',   color: 'text-amber-400',   bg: 'bg-amber-400/10 border-amber-400/20' },
  unknown:  { label: 'No data',  color: 'text-white/30',    bg: 'bg-white/5 border-white/10' },
}

export function PrimaryGoal({ primaryGoal, loading }: Props) {
  if (loading) {
    return <div className="h-44 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!primaryGoal) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Primary Goal</p>
        </div>
        <p className="text-sm text-white/25">
          Tell Rex your goal to unlock forecasting. Try: "My goal is to lose 8kg by August."
        </p>
      </Card>
    )
  }

  const { type, targetValue, currentValue, progressPct, status, targetDate, daysRemaining, unit } = primaryGoal
  const cfg       = STATUS_CFG[status]
  const pct       = progressPct ?? 0
  const hasTarget = targetValue !== null && currentValue !== null

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Primary Goal</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      {/* Goal type */}
      <p className="text-2xl font-bold text-white mb-1">{type}</p>

      {/* Target row */}
      {hasTarget && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-white/50">
            <span className="text-white/80 font-semibold">{currentValue}{unit}</span>
            {targetValue !== null && (
              <> → <span className="text-white/60">{targetValue}{unit}</span></>
            )}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {hasTarget && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-white/30">Progress</span>
            <span className={`text-[11px] font-bold ${cfg.color}`}>{Math.round(pct)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                status === 'ahead' || status === 'on_track' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Deadline row */}
      {targetDate && (
        <div className="flex items-center gap-1.5 text-[11px] text-white/35">
          <Calendar className="w-3 h-3" />
          <span>
            {new Date(targetDate + 'T00:00:00').toLocaleDateString('en', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </span>
          {daysRemaining !== null && (
            <span className="ml-1 text-white/20">· {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining</span>
          )}
        </div>
      )}
    </Card>
  )
}

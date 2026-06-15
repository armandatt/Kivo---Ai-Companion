'use client'

import { Apple, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { PlannerPageData } from './use-planner-data'

type Props = {
  nutritionReviews: PlannerPageData['nutritionReviews']
  loading:          boolean
}

const LIMITER_LABELS: Record<string, string> = {
  recovery:   'Recovery limited',
  training:   'Training limited',
  nutrition:  'Nutrition gap',
  adherence:  'Adherence issue',
  unknown:    'Assessing',
}

const LIMITER_CLS: Record<string, string> = {
  recovery:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
  training:  'bg-sky-500/15 text-sky-400 border-sky-500/30',
  nutrition: 'bg-red-500/15 text-red-400 border-red-500/30',
  adherence: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  unknown:   'bg-white/5 text-white/30 border-white/10',
}

const STATUS_CLS: Record<string, string> = {
  on_track: 'text-emerald-400',
  behind:   'text-amber-400',
  critical: 'text-red-400',
  unknown:  'text-white/30',
}

export function NutritionReviews({ nutritionReviews, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-36 animate-pulse" />
  }

  if (!nutritionReviews) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Apple className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Nutrition</p>
        </div>
        <p className="text-sm text-white/25">No nutrition data available.</p>
      </Card>
    )
  }

  const {
    primaryLimiter, overallStatus, proteinTargetG, proteinAvgG,
    proteinDaysLogged, calorieBalance, actionNeeded, reason,
  } = nutritionReviews

  const proteinPct = proteinAvgG !== null && proteinTargetG > 0
    ? Math.min(100, Math.round((proteinAvgG / proteinTargetG) * 100))
    : null

  const balanceLabel: Record<string, string> = {
    surplus:     'Calorie surplus',
    deficit:     'Calorie deficit',
    maintenance: 'Maintenance calories',
    unclear:     'Calorie balance unclear',
  }
  const balanceCls: Record<string, string> = {
    surplus:     'text-emerald-400',
    deficit:     'text-sky-400',
    maintenance: 'text-white/40',
    unclear:     'text-white/25',
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Apple className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Nutrition</p>
        </div>
        <div className="flex items-center gap-2">
          {actionNeeded && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${LIMITER_CLS[primaryLimiter] ?? LIMITER_CLS.unknown}`}>
            {LIMITER_LABELS[primaryLimiter] ?? 'Assessing'}
          </span>
        </div>
      </div>

      {/* Overall status */}
      <p className={`text-xs font-semibold mb-3 capitalize ${STATUS_CLS[overallStatus] ?? STATUS_CLS.unknown}`}>
        {overallStatus.replace('_', ' ')}
      </p>

      {/* Protein bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/40">Protein</span>
          <span className="text-[11px] text-white/50 tabular-nums">
            {proteinAvgG !== null ? `${proteinAvgG}g` : '—'} / {proteinTargetG}g
          </span>
        </div>
        <Progress value={proteinPct ?? 0} className="h-1.5 bg-white/5" />
        {proteinDaysLogged > 0 && (
          <p className="text-[10px] text-white/20 mt-1">
            {proteinDaysLogged} day{proteinDaysLogged !== 1 ? 's' : ''} logged
          </p>
        )}
      </div>

      {/* Calorie balance */}
      {calorieBalance && calorieBalance !== 'unclear' && (
        <p className={`text-[11px] font-medium mb-3 ${balanceCls[calorieBalance] ?? 'text-white/30'}`}>
          {balanceLabel[calorieBalance]}
        </p>
      )}

      {/* Reason */}
      <p className="text-[11px] text-white/35 leading-relaxed">{reason}</p>
    </Card>
  )
}

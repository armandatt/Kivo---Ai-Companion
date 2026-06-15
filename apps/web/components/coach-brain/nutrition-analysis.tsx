'use client'

import { Apple, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { CoachPageData } from './use-coach-data'

type Props = { nutrition: CoachPageData['nutrition']; loading: boolean }

const TREND_ICON = { up: TrendingUp, down: TrendingDown, stable: Minus } as const
const TREND_COLOR = { up: 'text-emerald-400', down: 'text-red-400', stable: 'text-white/30' } as const
const CONF_COLOR = { high: 'text-emerald-400', moderate: 'text-amber-400', low: 'text-white/25' } as const

const BALANCE_LABEL: Record<string, string> = {
  surplus:     'Calorie surplus',
  deficit:     'Calorie deficit',
  maintenance: 'Maintenance',
  unclear:     'Balance unclear',
}
const BALANCE_COLOR: Record<string, string> = {
  surplus:     'text-emerald-400',
  deficit:     'text-sky-400',
  maintenance: 'text-white/40',
  unclear:     'text-white/25',
}

export function NutritionAnalysis({ nutrition, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-48 animate-pulse" />
  }

  if (!nutrition) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Apple className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Nutrition</p>
        </div>
        <p className="text-sm text-white/25">No nutrition context available.</p>
      </Card>
    )
  }

  const proteinPct = nutrition.proteinAvgG !== null && nutrition.proteinTargetG > 0
    ? Math.min(100, Math.round((nutrition.proteinAvgG / nutrition.proteinTargetG) * 100))
    : null

  const TrendIcon = nutrition.proteinTrend ? TREND_ICON[nutrition.proteinTrend] : null

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Apple className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Nutrition</p>
        </div>
        <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full ${
          nutrition.actionNeeded ? 'bg-amber-500/15 text-amber-400' : 'bg-white/5 text-white/30'
        }`}>
          Tier {nutrition.tier}{nutrition.actionNeeded ? ' · Action needed' : ''}
        </span>
      </div>

      {/* Summary */}
      {nutrition.summary && (
        <p className="text-[11px] text-white/40 leading-relaxed mb-4">{nutrition.summary}</p>
      )}

      {/* Protein section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-white/40">Protein</span>
          <div className="flex items-center gap-2">
            {TrendIcon && nutrition.proteinTrend && (
              <TrendIcon className={`w-3 h-3 ${TREND_COLOR[nutrition.proteinTrend]}`} />
            )}
            <span className="text-[11px] text-white/50 tabular-nums">
              {nutrition.proteinAvgG !== null ? `${nutrition.proteinAvgG}g` : '—'}
              {' / '}{nutrition.proteinTargetG}g
            </span>
          </div>
        </div>
        <Progress value={proteinPct ?? 0} className="h-1.5 bg-white/5" />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-white/20">
            {nutrition.proteinDaysLogged} day{nutrition.proteinDaysLogged !== 1 ? 's' : ''} logged
          </span>
          {nutrition.proteinConfidence && (
            <span className={`text-[10px] capitalize ${CONF_COLOR[nutrition.proteinConfidence]}`}>
              {nutrition.proteinConfidence} confidence
            </span>
          )}
        </div>
      </div>

      {/* Calorie section */}
      {nutrition.calorieBalance && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">Calories</p>
          <div className="flex items-center justify-between">
            <p className={`text-sm font-semibold ${BALANCE_COLOR[nutrition.calorieBalance] ?? 'text-white/40'}`}>
              {BALANCE_LABEL[nutrition.calorieBalance]}
            </p>
            {nutrition.calorieAlignedWithGoal !== null && (
              nutrition.calorieAlignedWithGoal
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                : <XCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
          </div>
          {nutrition.calorieNarrative && (
            <p className="text-[11px] text-white/35 mt-1 leading-relaxed">{nutrition.calorieNarrative}</p>
          )}
          {nutrition.calorieConfidence && (
            <span className={`text-[10px] capitalize ${CONF_COLOR[nutrition.calorieConfidence]}`}>
              {nutrition.calorieConfidence} confidence
            </span>
          )}
        </div>
      )}

      {/* Adherence */}
      {nutrition.adherence && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1">Adherence</p>
          <p className={`text-sm font-semibold capitalize ${
            nutrition.adherence === 'positive' ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {nutrition.adherence}
          </p>
        </div>
      )}

      {/* Top foods */}
      {nutrition.topFoods.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">Common foods</p>
          <div className="flex flex-wrap gap-1.5">
            {nutrition.topFoods.slice(0, 6).map(f => (
              <span key={f} className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

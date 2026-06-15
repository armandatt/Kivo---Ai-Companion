'use client'

import { Utensils, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData } from './use-progress-data'

type Props = { nutritionTrend: ProgressPageData['nutritionTrend']; loading: boolean }

export function NutritionTrend({ nutritionTrend, loading }: Props) {
  if (loading) {
    return <div className="h-56 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!nutritionTrend) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Utensils className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Nutrition</p>
        </div>
        <p className="text-sm text-white/25">Log meals with Rex to track nutrition trends.</p>
      </Card>
    )
  }

  const {
    currentAvgG, targetG, daysLogged, trend, confidence,
    prevAvgG, daysAboveTarget, topFoods, adherence, calorieBalance, calorieAligned,
  } = nutritionTrend

  const pct = currentAvgG !== null ? Math.min(100, Math.round((currentAvgG / targetG) * 100)) : 0
  const delta = currentAvgG !== null && prevAvgG !== null ? Math.round(currentAvgG - prevAvgG) : null

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-white/30'

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Utensils className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Nutrition</p>
        {trend && <TrendIcon className={`w-3.5 h-3.5 ml-auto ${trendColor}`} />}
      </div>

      {/* Protein bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/40">Protein</span>
          <div className="flex items-center gap-2">
            {delta !== null && (
              <span className={`text-[10px] font-medium ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {delta > 0 ? '+' : ''}{delta}g vs prev 2w
              </span>
            )}
            <span className="text-[11px] font-bold text-white/60 tabular-nums">
              {currentAvgG ?? '—'} / {targetG}g
            </span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-white/20">{daysLogged} days logged</span>
          <span className="text-[9px] text-white/20">{daysAboveTarget}d above target</span>
        </div>
      </div>

      {/* Calorie balance */}
      {calorieBalance && (
        <div className="flex items-start gap-2 mb-3">
          {calorieAligned === true
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            : calorieAligned === false
            ? <XCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            : <Minus className="w-3.5 h-3.5 text-white/20 shrink-0 mt-0.5" />
          }
          <p className="text-[11px] text-white/40 leading-relaxed">{calorieBalance}</p>
        </div>
      )}

      {/* Top foods */}
      {topFoods.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">Common foods</p>
          <div className="flex flex-wrap gap-1.5">
            {topFoods.map(f => (
              <span key={f} className="text-[10px] text-white/40 bg-white/5 border border-white/8 px-2 py-0.5 rounded-full capitalize">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Adherence */}
      {adherence && (
        <p className={`text-[10px] font-medium ${adherence === 'positive' ? 'text-emerald-400' : 'text-amber-400'}`}>
          Self-reported adherence: {adherence}
        </p>
      )}

      {/* Confidence */}
      {confidence && (
        <p className="text-[9px] text-white/20 mt-2">{confidence} confidence · {daysLogged} days of data</p>
      )}
    </Card>
  )
}

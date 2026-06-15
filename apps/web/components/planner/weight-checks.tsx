'use client'

import { Scale, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { PlannerPageData } from './use-planner-data'

type Props = {
  weightChecks: PlannerPageData['weightChecks']
  loading:      boolean
}

function TrendIcon({ trend }: { trend: "gaining" | "losing" | "stable" | null }) {
  if (trend === 'gaining') return <TrendingUp   className="w-3.5 h-3.5 text-emerald-400" />
  if (trend === 'losing')  return <TrendingDown className="w-3.5 h-3.5 text-sky-400" />
  return                          <Minus        className="w-3.5 h-3.5 text-white/30" />
}

function trendLabel(trend: "gaining" | "losing" | "stable" | null) {
  if (trend === 'gaining') return 'Gaining'
  if (trend === 'losing')  return 'Losing'
  if (trend === 'stable')  return 'Stable'
  return null
}

function trendColor(trend: "gaining" | "losing" | "stable" | null) {
  if (trend === 'gaining') return 'text-emerald-400'
  if (trend === 'losing')  return 'text-sky-400'
  return 'text-white/30'
}

function daysBetween(iso: string): number {
  const then = new Date(iso).getTime()
  const now  = Date.now()
  return Math.round((now - then) / 86_400_000)
}

export function WeightChecks({ weightChecks, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-36 animate-pulse" />
  }

  const { lastEntries, nextDueDateISO, frequencyDays, currentKg, weeklyRateKg, trend } = weightChecks

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Weight</p>
        </div>
        {currentKg !== null && (
          <div className="flex items-center gap-1.5">
            <TrendIcon trend={trend} />
            <span className={`text-sm font-bold tabular-nums ${trendColor(trend)}`}>
              {currentKg}kg
            </span>
          </div>
        )}
      </div>

      {/* Weekly rate + trend label */}
      {(weeklyRateKg !== null || trend) && (
        <div className="flex items-center gap-2 mb-4">
          {trend && (
            <span className={`text-xs font-medium ${trendColor(trend)}`}>
              {trendLabel(trend)}
            </span>
          )}
          {weeklyRateKg !== null && weeklyRateKg !== 0 && (
            <span className="text-[11px] text-white/30">
              {weeklyRateKg > 0 ? '+' : ''}{weeklyRateKg}kg/week
            </span>
          )}
        </div>
      )}

      {/* Previous entries */}
      {lastEntries.length > 0 ? (
        <div className="space-y-1.5 mb-4">
          {lastEntries.map((e, i) => {
            const daysAgo = daysBetween(e.dateISO)
            return (
              <div key={e.dateISO} className="flex items-center justify-between">
                <span className="text-[11px] text-white/30">
                  {daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`}
                </span>
                <span className={`text-xs font-semibold tabular-nums ${i === 0 ? 'text-white/80' : 'text-white/35'}`}>
                  {e.weightKg}kg
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-white/25 mb-4">No weigh-ins logged yet.</p>
      )}

      {/* Next due */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <span className="text-[11px] text-white/30">
          {frequencyDays ? `Every ${frequencyDays} days` : 'Frequency unknown'}
        </span>
        {nextDueDateISO && (
          <span className="text-[11px] font-medium text-white/50">
            Next: {nextDueDateISO}
          </span>
        )}
      </div>
    </Card>
  )
}

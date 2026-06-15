'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { HomePageData } from './use-home-data'

const RPE_LABEL = {
  overtrained:  { text: 'Overreaching',   color: 'text-red-400'     },
  undertrained: { text: 'Undertraining',  color: 'text-amber-400'   },
  optimal:      { text: 'Optimal zone',   color: 'text-emerald-400' },
  unknown:      { text: 'No RPE data',    color: 'text-white/20'    },
} as const

type Props = { stats: HomePageData['stats'] | null; loading: boolean }

export function QuickStats({ stats, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-40 animate-pulse" />
  }

  const sess        = stats?.sessionsThisWeek ?? 0
  const plan        = stats?.plannedThisWeek  ?? 0
  const consistency = stats?.consistencyScore  ?? 0
  const volumeKg    = stats?.volumeThisWeekKg  ?? 0
  const volumeT     = (volumeKg / 1000).toFixed(1)
  const rpeTrend    = stats?.rpeTrend          ?? 'unknown'
  const weightTrend = stats?.weightTrend       ?? null
  const rpeInfo     = RPE_LABEL[rpeTrend]

  const WeightIcon = weightTrend?.trend === 'gaining' ? TrendingUp
    : weightTrend?.trend === 'losing'  ? TrendingDown
    : Minus

  const weightColor = weightTrend?.trend === 'gaining' ? 'text-emerald-400'
    : weightTrend?.trend === 'losing'  ? 'text-red-400'
    : 'text-white/30'

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <h3 className="text-sm font-semibold text-white mb-4">This Week</h3>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-2xl font-bold text-white tabular-nums">{sess}</span>
            <span className="text-sm text-white/20">/{plan}</span>
          </div>
          <p className="text-xs text-white/30 mt-0.5">Sessions</p>
        </div>

        <div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-2xl font-bold text-white tabular-nums">{volumeT}</span>
            <span className="text-sm text-white/20">t</span>
          </div>
          <p className="text-xs text-white/30 mt-0.5">Volume</p>
        </div>

        <div>
          {weightTrend ? (
            <>
              <div className={`flex items-baseline gap-1 ${weightColor}`}>
                <WeightIcon className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="text-2xl font-bold tabular-nums">{weightTrend.currentKg}</span>
                <span className="text-sm text-white/20">kg</span>
              </div>
              <p className="text-xs text-white/30 mt-0.5">
                {weightTrend.stalled ? 'Stalled' : `${weightTrend.weeklyRateKg > 0 ? '+' : ''}${weightTrend.weeklyRateKg}kg/wk`}
              </p>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-white/20">—</span>
              <p className="text-xs text-white/30 mt-0.5">Weight</p>
            </>
          )}
        </div>
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/30">4-week consistency</span>
          <span className="text-xs text-white/50 tabular-nums">{consistency}%</span>
        </div>
        <Progress value={consistency} className="h-1.5 bg-white/5" />
      </div>

      <div className={`text-xs ${rpeInfo.color}`}>{rpeInfo.text}</div>
    </Card>
  )
}

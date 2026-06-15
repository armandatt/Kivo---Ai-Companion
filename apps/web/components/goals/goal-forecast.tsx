'use client'

import { TrendingUp, TrendingDown, Minus, BarChart2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData } from './use-goals-data'

type Props = { forecast: GoalsPageData['forecast']; loading: boolean }

function fmt(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

function PaceRow({ label, value, unit, highlight }: {
  label:     string
  value:     number | null
  unit:      string
  highlight?: string
}) {
  const display = value !== null
    ? `${value > 0 ? '+' : ''}${value}${unit}`
    : '—'
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-[12px] text-white/50">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${value !== null ? (highlight ?? 'text-white/80') : 'text-white/20'}`}>
        {display}
      </span>
    </div>
  )
}

export function GoalForecast({ forecast, loading }: Props) {
  if (loading) {
    return <div className="h-52 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!forecast) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Forecast</p>
        </div>
        <p className="text-sm text-white/25">Set a goal target with Rex to unlock pace forecasting.</p>
      </Card>
    )
  }

  const { currentPace, requiredPace, paceUnit, projectedWeeks, projectedDate, onTrack, confidence, confidenceReason } = forecast
  const paceGap = requiredPace !== null && currentPace !== null ? requiredPace - currentPace : null
  const gapAhead = paceGap !== null && paceGap <= 0  // current >= required → ahead

  const confColor = confidence === 'high' ? 'text-emerald-400' : confidence === 'medium' ? 'text-amber-400' : 'text-white/30'

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Forecast</p>
        </div>
        <span className={`text-[10px] font-medium ${confColor}`}>
          {confidence} confidence
        </span>
      </div>

      {/* Projected date */}
      {projectedDate && projectedWeeks ? (
        <div className="mb-4">
          <p className="text-[11px] text-white/35 mb-0.5">Projected target date</p>
          <p className="text-xl font-bold text-white">{fmt(projectedDate)}</p>
          <p className="text-[11px] text-white/30 mt-0.5">~{projectedWeeks} week{projectedWeeks !== 1 ? 's' : ''} at current pace</p>
        </div>
      ) : (
        <div className="mb-4">
          <p className="text-sm text-white/30">Cannot project — pace is 0 or going the wrong direction.</p>
        </div>
      )}

      {/* Pace rows */}
      <div>
        <PaceRow
          label="Current pace"
          value={currentPace}
          unit={paceUnit.replace('week', 'wk')}
          highlight={onTrack ? 'text-emerald-400' : 'text-amber-400'}
        />
        <PaceRow
          label="Required pace"
          value={requiredPace}
          unit={paceUnit.replace('week', 'wk')}
        />
        {paceGap !== null && (
          <div className="flex items-center justify-between py-2">
            <span className="text-[12px] text-white/50">Gap</span>
            <span className={`text-sm font-bold tabular-nums ${gapAhead ? 'text-emerald-400' : 'text-amber-400'}`}>
              {gapAhead ? 'On pace' : `+${Math.round(Math.abs(paceGap) * 100) / 100}${paceUnit.replace('week', 'wk')} needed`}
            </span>
          </div>
        )}
      </div>

      <p className="text-[9px] text-white/20 mt-3">{confidenceReason}</p>
    </Card>
  )
}

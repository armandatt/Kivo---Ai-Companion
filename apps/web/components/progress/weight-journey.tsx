'use client'

import { Scale, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { ProgressPageData } from './use-progress-data'

type Props = { weightJourney: ProgressPageData['weightJourney']; loading: boolean }

function fmt(d: string): string {
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export function WeightJourney({ weightJourney, loading }: Props) {
  if (loading) {
    return <div className="h-64 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!weightJourney || weightJourney.entries.length < 2) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Scale className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Weight Journey</p>
        </div>
        <p className="text-sm text-white/25">Log weight at least twice to see your journey.</p>
      </Card>
    )
  }

  const { entries, currentWeight, weeklyRate, trend, stalled, insight } = weightJourney

  const TrendIcon = stalled ? Minus : trend === 'gaining' ? TrendingUp : trend === 'losing' ? TrendingDown : Minus
  const trendColor = stalled ? 'text-white/30' : trend === 'gaining' ? 'text-emerald-400' : trend === 'losing' ? 'text-sky-400' : 'text-white/30'

  const vals = entries.map(e => e.weightKg)
  const minW  = Math.min(...vals)
  const maxW  = Math.max(...vals)
  const pad   = Math.max((maxW - minW) * 0.3, 0.5)

  // Show at most 12 data points to keep chart readable
  const stride   = Math.max(1, Math.ceil(entries.length / 12))
  const chartData = entries.filter((_, i) => i % stride === 0 || i === entries.length - 1)
    .map(e => ({ date: fmt(e.date), weightKg: e.weightKg }))

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Weight Journey</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-white">{currentWeight}kg</p>
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <TrendIcon className={`w-3 h-3 ${trendColor}`} />
            <span className={`text-[10px] font-medium ${trendColor}`}>
              {stalled ? 'stalled' : `${weeklyRate > 0 ? '+' : ''}${weeklyRate}kg/wk`}
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-36 -mx-1 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minW - pad, maxW + pad]}
              tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `${v}kg`}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: 'rgba(255,255,255,0.4)' }}
              itemStyle={{ color: '#34d399' }}
              formatter={(v: number) => [`${v}kg`, 'Weight']}
            />
            <Line
              type="monotone"
              dataKey="weightKg"
              stroke="#34d399"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: '#34d399' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Coaching insight */}
      <div className="flex items-start gap-2 bg-white/3 rounded-xl px-3 py-2.5 border border-white/5">
        {stalled
          ? <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          : <TrendIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${trendColor}`} />
        }
        <p className="text-[11px] text-white/50 leading-relaxed">{insight}</p>
      </div>
    </Card>
  )
}

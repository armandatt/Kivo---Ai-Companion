'use client'

import { Flame, TrendingUp, TrendingDown, Minus, Target } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { HomePageData, MainLiftEntry } from './use-home-data'

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const min   = Math.min(...values)
  const max   = Math.max(...values)
  const range = max - min || 1
  const H     = 20
  const STEP  = 10
  const W     = (values.length - 1) * STEP
  const pts   = values.map((v, i) => `${i * STEP},${H - ((v - min) / range) * H}`).join(' ')
  const lastX = (values.length - 1) * STEP
  const lastY = H - ((values[values.length - 1]! - min) / range) * H

  return (
    <svg width={W + 4} height={H + 4} className="overflow-visible shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill="#34d399" />
    </svg>
  )
}

function LiftRow({ lift }: { lift: MainLiftEntry }) {
  const DeltaIcon  = lift.deltaKg > 0 ? TrendingUp : lift.deltaKg < 0 ? TrendingDown : Minus
  const deltaColor =
    lift.deltaKg > 0 ? 'text-emerald-400' :
    lift.deltaKg < 0 ? 'text-red-400'     :
                       'text-white/20'
  const deltaStr   = lift.deltaKg === 0 ? '—' : `${lift.deltaKg > 0 ? '+' : ''}${lift.deltaKg}kg`

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-white/40 w-14 shrink-0">{lift.exercise}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-white tabular-nums">{lift.currentKg}kg</span>
        {lift.isPR && (
          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">PR</span>
        )}
        {lift.isStalled && (
          <span className="text-[10px] font-medium text-amber-500/70 bg-amber-500/8 px-1.5 py-0.5 rounded shrink-0">stall</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Sparkline values={lift.trend} />
        <div className={`flex items-center gap-0.5 text-xs font-medium ${deltaColor} shrink-0`}>
          <DeltaIcon className="w-3 h-3" />
          <span>{deltaStr}</span>
        </div>
      </div>
    </div>
  )
}

type Props = { momentum: HomePageData['momentum'] | null; loading: boolean }

export function Momentum({ momentum, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-48 animate-pulse" />
  }

  const streakDays   = momentum?.streakDays   ?? 0
  const mainLifts    = momentum?.mainLifts    ?? []
  const goalProgress = momentum?.goalProgress ?? null

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Momentum</h3>
        {streakDays > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-bold text-orange-400">{streakDays}</span>
          </div>
        )}
      </div>

      {mainLifts.length > 0 && (
        <div className="mb-3">
          {mainLifts.map(l => <LiftRow key={l.exercise} lift={l} />)}
        </div>
      )}

      {mainLifts.length === 0 && !goalProgress && (
        <p className="text-sm text-white/20 py-3 text-center">No lift data yet.</p>
      )}

      {goalProgress && (
        <div className="pt-3 border-t border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-white/30 shrink-0" />
            <span className="text-xs text-white/40 capitalize">
              {goalProgress.goalType.replace('_', ' ')} goal
              {goalProgress.exercise ? ` · ${goalProgress.exercise}` : ''}
            </span>
            <span className={[
              'ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize',
              goalProgress.status === 'ahead'    ? 'text-emerald-400 bg-emerald-400/10' :
              goalProgress.status === 'on_track' ? 'text-sky-400 bg-sky-400/10'         :
              goalProgress.status === 'behind'   ? 'text-amber-400 bg-amber-400/10'     :
                                                   'text-white/30 bg-white/5',
            ].join(' ')}>
              {goalProgress.status.replace('_', ' ')}
            </span>
          </div>
          <Progress value={goalProgress.progressPercent} className="h-1.5 bg-white/5" />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-white/20">
              {goalProgress.currentValue ?? '—'}{goalProgress.currentValue != null ? goalProgress.unit : ''}
            </span>
            <span className="text-[10px] text-white/20">
              {goalProgress.targetValue ?? '—'}{goalProgress.targetValue != null ? goalProgress.unit : ''}
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}

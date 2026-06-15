'use client'

import { Dumbbell, TrendingUp, TrendingDown, Minus, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LineChart, Line, Tooltip, ResponsiveContainer } from 'recharts'
import type { ProgressPageData, LiftSummary } from './use-progress-data'

type Props = { strengthProgression: ProgressPageData['strengthProgression']; loading: boolean }

function Sparkline({ history }: { history: LiftSummary['prHistory'] }) {
  if (history.length < 2) return null
  const data = history.map(h => ({ weightKg: h.weightKg }))
  return (
    <div className="w-16 h-8 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="weightKg" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function LiftRow({ lift }: { lift: LiftSummary }) {
  const hasChange  = lift.changeKg !== null && lift.changeKg !== 0
  const isNew      = lift.prevKg === null
  const DirIcon    = isNew ? Star : lift.changeKg !== null && lift.changeKg > 0 ? TrendingUp : lift.changeKg !== null && lift.changeKg < 0 ? TrendingDown : Minus
  const dirColor   = isNew ? 'text-violet-400' : lift.changeKg !== null && lift.changeKg > 0 ? 'text-emerald-400' : lift.changeKg !== null && lift.changeKg < 0 ? 'text-red-400' : 'text-white/25'

  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 last:border-0 pb-3 last:pb-0">
      <div className="flex items-center gap-2 min-w-0">
        <DirIcon className={`w-3.5 h-3.5 shrink-0 ${dirColor}`} />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-white/80 truncate capitalize">{lift.exercise}</p>
          <p className="text-[10px] text-white/30">{lift.reps} reps · {lift.date.slice(0, 10)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Sparkline history={lift.prHistory} />
        <div className="text-right">
          <p className="text-sm font-bold text-white">{lift.currentKg}kg</p>
          {hasChange && (
            <p className={`text-[10px] font-medium ${dirColor}`}>
              {lift.changeKg! > 0 ? '+' : ''}{lift.changeKg}kg
            </p>
          )}
          {isNew && <p className="text-[10px] text-violet-400">first PR</p>}
        </div>
      </div>
    </div>
  )
}

export function StrengthProgression({ strengthProgression, loading }: Props) {
  if (loading) {
    return <div className="h-64 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!strengthProgression || strengthProgression.lifts.length === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Dumbbell className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Strength</p>
        </div>
        <p className="text-sm text-white/25">No PR data yet. Mention PRs to Rex or log sessions to track progress.</p>
      </Card>
    )
  }

  const { lifts, totalCurrentKg, biggestPR } = strengthProgression

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Strength</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[11px] text-white/30">{totalCurrentKg}kg total PRs</p>
          {biggestPR !== 'none yet' && (
            <p className="text-[10px] text-violet-400 mt-0.5">{biggestPR}</p>
          )}
        </div>
      </div>

      {/* Lift list */}
      <div className="space-y-3">
        {lifts.map(lift => (
          <LiftRow key={lift.exercise} lift={lift} />
        ))}
      </div>
    </Card>
  )
}

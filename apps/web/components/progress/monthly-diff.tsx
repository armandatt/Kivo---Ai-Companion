'use client'

import { TrendingUp, TrendingDown, Minus, CalendarDays } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData } from './use-progress-data'

type Props = { monthlyDiff: ProgressPageData['monthlyDiff']; loading: boolean }

type DiffEntry = { label: string; delta: number | null; display: string; invert?: boolean }

function DiffRow({ entry }: { entry: DiffEntry }) {
  const { label, delta, display, invert = false } = entry
  const noData = delta === null

  const positive = noData ? false : invert ? delta < 0 : delta > 0
  const negative = noData ? false : invert ? delta > 0 : delta < 0
  const Icon = noData ? Minus : positive ? TrendingUp : negative ? TrendingDown : Minus
  const color = noData
    ? 'text-white/20'
    : positive
    ? 'text-emerald-400'
    : negative
    ? 'text-red-400'
    : 'text-white/30'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
      <span className="text-[12px] text-white/50 flex-1">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${noData ? 'text-white/20' : color}`}>
        {display}
      </span>
    </div>
  )
}

export function MonthlyDiff({ monthlyDiff, loading }: Props) {
  if (loading) {
    return <div className="h-64 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  const rows: DiffEntry[] = [
    { label: 'Weight',      delta: monthlyDiff.weight.delta,      display: monthlyDiff.weight.label, invert: monthlyDiff.weight.invertColor },
    { label: 'Strength',    delta: monthlyDiff.strength.delta,    display: monthlyDiff.strength.label },
    { label: 'Consistency', delta: monthlyDiff.consistency.delta, display: monthlyDiff.consistency.label },
    { label: 'Protein',     delta: monthlyDiff.protein.delta,     display: monthlyDiff.protein.label },
    { label: 'Burnout',     delta: monthlyDiff.burnout.delta,     display: monthlyDiff.burnout.label, invert: true },
  ]

  const hasAnyData = rows.some(r => r.delta !== null)

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">What Changed This Month?</p>
      </div>
      <p className="text-[10px] text-white/20 mb-4">{monthlyDiff.period}</p>

      {!hasAnyData ? (
        <p className="text-sm text-white/25">Not enough history yet for monthly comparison.</p>
      ) : (
        <div>
          {rows.map(r => <DiffRow key={r.label} entry={r} />)}
        </div>
      )}
    </Card>
  )
}

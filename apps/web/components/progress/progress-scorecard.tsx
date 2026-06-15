'use client'

import { TrendingUp, TrendingDown, Minus, Scale, Dumbbell, CalendarCheck, ShieldCheck, Utensils } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData, ScorecardCard } from './use-progress-data'

type Props = { scorecard: ProgressPageData['scorecard']; loading: boolean }

const STATUS_BG = {
  positive: 'bg-emerald-500/10 border-emerald-500/20',
  neutral:  'bg-white/4 border-white/8',
  warning:  'bg-amber-500/10 border-amber-500/20',
  unknown:  'bg-white/3 border-white/5',
} as const

const STATUS_COLOR = {
  positive: 'text-emerald-400',
  neutral:  'text-white/50',
  warning:  'text-amber-400',
  unknown:  'text-white/25',
} as const

const DIR_ICON = {
  up:      TrendingUp,
  down:    TrendingDown,
  stable:  Minus,
  unknown: Minus,
} as const

const DIR_COLOR = {
  up:      'text-emerald-400',
  down:    'text-red-400',
  stable:  'text-white/25',
  unknown: 'text-white/15',
} as const

function MetricCard({
  icon: Icon, label, card,
}: {
  icon: React.ElementType
  label: string
  card: ScorecardCard | null
}) {
  if (!card) {
    return (
      <div className="flex-1 rounded-2xl border border-white/5 bg-white/3 p-4 min-w-[120px]">
        <div className="flex items-center gap-1.5 mb-2">
          <Icon className="w-3.5 h-3.5 text-white/15" />
          <span className="text-[10px] font-semibold text-white/20 uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-lg font-bold text-white/15">—</p>
        <p className="text-[10px] text-white/15 mt-0.5">No data</p>
      </div>
    )
  }

  const DirIcon = DIR_ICON[card.direction]
  return (
    <div className={`flex-1 rounded-2xl border p-4 min-w-[120px] ${STATUS_BG[card.status]}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-3.5 h-3.5 ${STATUS_COLOR[card.status]}`} />
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <DirIcon className={`w-3.5 h-3.5 shrink-0 ${STATUS_COLOR[card.status]}`} />
        <p className={`text-base font-bold ${STATUS_COLOR[card.status]}`}>{card.value}</p>
      </div>
      {card.delta && (
        <p className="text-[10px] text-white/30 mt-0.5">{card.delta}</p>
      )}
    </div>
  )
}

export function ProgressScorecard({ scorecard, loading }: Props) {
  if (loading) {
    return <div className="h-32 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      <MetricCard icon={Scale}         label="Weight"      card={scorecard.weight} />
      <MetricCard icon={Dumbbell}      label="Strength"    card={scorecard.strength} />
      <MetricCard icon={CalendarCheck} label="Consistency" card={scorecard.consistency} />
      <MetricCard icon={ShieldCheck}   label="Recovery"    card={scorecard.recovery} />
      <MetricCard icon={Utensils}      label="Protein"     card={scorecard.nutrition} />
    </div>
  )
}

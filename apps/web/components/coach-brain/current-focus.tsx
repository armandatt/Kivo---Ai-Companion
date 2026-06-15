'use client'

import { Brain, ShieldAlert, TrendingDown, Utensils, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Props = { currentFocus: CoachPageData['currentFocus']; loading: boolean }

const LIMITER_CFG = {
  recovery:  { Icon: ShieldAlert,   label: 'Recovery',    color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  training:  { Icon: TrendingDown,  label: 'Training',    color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  nutrition: { Icon: Utensils,      label: 'Nutrition',   color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  adherence: { Icon: AlertTriangle, label: 'Consistency', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  unknown:   { Icon: Brain,         label: 'Unknown',     color: 'text-white/30',   bg: 'bg-white/5',       border: 'border-white/8' },
} as const

const CONFIDENCE_COLOR = { high: 'text-emerald-400', moderate: 'text-amber-400', low: 'text-white/30' } as const
const STATUS_COLOR = { on_track: 'text-emerald-400', behind: 'text-amber-400', critical: 'text-red-400', unknown: 'text-white/30' } as const

export function CurrentFocus({ currentFocus, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-48 animate-pulse" />
  }

  if (!currentFocus) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Current Focus</p>
        </div>
        <p className="text-sm text-white/30">Not enough data yet. Start logging sessions and nutrition.</p>
      </Card>
    )
  }

  const cfg = LIMITER_CFG[currentFocus.limiter]
  const displayLabel =
    currentFocus.limiter === 'unknown'
      ? (currentFocus.overallStatus === 'on_track' ? 'On track' : 'Insufficient data')
      : cfg.label

  return (
    <Card className={`border ${cfg.border} ${cfg.bg} p-5`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center border ${cfg.border}`}>
            <cfg.Icon className={`w-4 h-4 ${cfg.color}`} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-0.5">Current Focus</p>
            <p className={`text-base font-bold ${cfg.color}`}>{displayLabel}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-xs font-semibold capitalize ${STATUS_COLOR[currentFocus.overallStatus]}`}>
            {currentFocus.overallStatus.replace('_', ' ')}
          </p>
          <p className={`text-[10px] mt-0.5 capitalize ${CONFIDENCE_COLOR[currentFocus.confidence]}`}>
            {currentFocus.confidence} confidence
          </p>
        </div>
      </div>

      {/* Why */}
      <p className="text-sm text-white/70 leading-relaxed mb-4">{currentFocus.why}</p>

      {/* Evidence */}
      {currentFocus.evidence.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">Evidence</p>
          <div className="space-y-1">
            {currentFocus.evidence.map((ev, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${cfg.color}`} />
                <p className="text-[11px] text-white/50 leading-relaxed">{ev}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

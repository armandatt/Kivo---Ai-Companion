'use client'

import { ArrowUp, Minus, AlertTriangle, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { HomePageData, OverloadTarget } from './use-home-data'

const FLAG_CONFIG = {
  increase:        { Icon: ArrowUp,       color: 'text-emerald-400', label: '+2.5kg' },
  maintain:        { Icon: Minus,         color: 'text-amber-400',   label: 'Hold'   },
  technique_check: { Icon: AlertTriangle, color: 'text-red-400',     label: 'Form'   },
  rep_increase:    { Icon: TrendingUp,    color: 'text-sky-400',     label: '+1 rep' },
} as const

function TargetRow({ target }: { target: OverloadTarget }) {
  const cfg = target.flag && target.flag in FLAG_CONFIG
    ? FLAG_CONFIG[target.flag as keyof typeof FLAG_CONFIG]
    : null

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{target.exercise}</p>
        <p className="text-xs text-white/25 mt-0.5 truncate">{target.note}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm text-white/50 tabular-nums">
          {target.nextWeightKg}kg
        </span>
        {cfg && (
          <div className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
            <cfg.Icon className="w-3 h-3" />
            <span>{cfg.label}</span>
          </div>
        )}
      </div>
    </div>
  )
}

type Props = { mission: HomePageData['mission'] | null; loading: boolean }

export function TodaysMission({ mission, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-48 animate-pulse" />
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Today's Mission</h3>
        {mission?.nextMuscles && (
          <span className="text-xs text-white/25">{mission.nextMuscles}</span>
        )}
      </div>

      {mission?.phase1Note ? (
        <p className="text-sm text-white/40 py-3 leading-relaxed">{mission.phase1Note}</p>
      ) : !mission?.targets.length ? (
        <p className="text-sm text-white/20 py-4 text-center">
          No targets yet — log a session to unlock targets.
        </p>
      ) : (
        <div>
          {mission.targets.map(t => <TargetRow key={t.exercise} target={t} />)}
        </div>
      )}
    </Card>
  )
}

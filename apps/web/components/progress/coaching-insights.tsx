'use client'

import { Brain, AlertCircle, Info } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData } from './use-progress-data'

type Props = { coachingInsights: ProgressPageData['coachingInsights']; loading: boolean }

const PRIORITY_CFG = {
  high:   { Icon: AlertCircle, color: 'text-red-400',    border: 'border-red-500/15',    bg: 'bg-red-500/5' },
  medium: { Icon: Brain,       color: 'text-amber-400',  border: 'border-amber-500/15',  bg: 'bg-amber-500/5' },
  low:    { Icon: Info,        color: 'text-sky-400',    border: 'border-sky-500/15',    bg: 'bg-sky-500/5' },
} as const

export function CoachingInsights({ coachingInsights, loading }: Props) {
  if (loading) {
    return <div className="h-40 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (coachingInsights.length === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Rex Insights</p>
        </div>
        <p className="text-sm text-white/25">Insights appear after a few weeks of data.</p>
      </Card>
    )
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Rex Insights</p>
        <span className="ml-auto text-[10px] text-white/15">Deterministic · No AI</span>
      </div>

      <div className="space-y-3">
        {coachingInsights.map((insight, i) => {
          const cfg = PRIORITY_CFG[insight.priority]
          return (
            <div key={i} className={`flex items-start gap-3 rounded-xl border p-3 ${cfg.border} ${cfg.bg}`}>
              <cfg.Icon className={`w-4 h-4 shrink-0 mt-0.5 ${cfg.color}`} />
              <div className="min-w-0">
                <p className="text-sm text-white/70 leading-relaxed">{insight.text}</p>
                <p className="text-[9px] text-white/20 mt-1">{insight.source}</p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

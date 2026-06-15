'use client'

import { GitBranch, TrendingUp, Utensils, Users, Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData, ScenarioLever } from './use-goals-data'

type Scenario = GoalsPageData['scenarios'][number]
type Props    = { scenarios: GoalsPageData['scenarios']; loading: boolean }

function fmt(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

const LEVER_CFG: Record<ScenarioLever, { Icon: typeof GitBranch; color: string; bg: string }> = {
  current:     { Icon: TrendingUp, color: 'text-white/50',    bg: 'bg-white/4 border-white/8' },
  consistency: { Icon: Users,      color: 'text-sky-400',     bg: 'bg-sky-400/8 border-sky-400/15' },
  nutrition:   { Icon: Utensils,   color: 'text-orange-400',  bg: 'bg-orange-400/8 border-orange-400/15' },
  combined:    { Icon: Zap,        color: 'text-emerald-400', bg: 'bg-emerald-400/8 border-emerald-400/15' },
}

function ScenarioCard({ s }: { s: Scenario }) {
  const { Icon, color, bg } = LEVER_CFG[s.lever]
  const saved = s.deltaWeeks && s.deltaWeeks > 0 ? `${s.deltaWeeks}wk faster` : null

  return (
    <div className={`rounded-xl border p-3 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        <p className={`text-[11px] font-semibold ${color}`}>{s.label}</p>
        {saved && (
          <span className="ml-auto text-[10px] text-emerald-400 font-medium">{saved}</span>
        )}
      </div>
      <p className="text-[10px] text-white/40 mb-2">{s.description}</p>
      {s.projectedDate ? (
        <div>
          <p className="text-[12px] font-bold text-white/80">{fmt(s.projectedDate)}</p>
          <p className="text-[10px] text-white/30">~{s.projectedWeeks} week{s.projectedWeeks !== 1 ? 's' : ''}</p>
        </div>
      ) : (
        <p className="text-[11px] text-white/25">
          {s.lever === 'current' ? 'Pace needs to increase' : 'Cannot project — insufficient pace data'}
        </p>
      )}
    </div>
  )
}

export function AlternativeScenarios({ scenarios, loading }: Props) {
  if (loading) {
    return <div className="h-44 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (scenarios.length === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">What If?</p>
        </div>
        <p className="text-sm text-white/25">Set a goal target to unlock scenario modelling.</p>
      </Card>
    )
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">What If?</p>
      </div>
      <p className="text-[10px] text-white/20 mb-4">Deterministic estimates — not predictions.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {scenarios.map((s, i) => <ScenarioCard key={i} s={s} />)}
      </div>
    </Card>
  )
}

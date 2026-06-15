'use client'

import { AlertTriangle, AlertCircle, Info, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData } from './use-goals-data'

type Risk = GoalsPageData['risks'][number]

type Props = { risks: GoalsPageData['risks']; loading: boolean }

const SEV_CFG = {
  high:   { Icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-400/8 border-red-400/15' },
  medium: { Icon: AlertCircle,   color: 'text-amber-400',  bg: 'bg-amber-400/8 border-amber-400/15' },
  low:    { Icon: Info,          color: 'text-sky-400',    bg: 'bg-sky-400/8 border-sky-400/15' },
}

function RiskRow({ risk }: { risk: Risk }) {
  const { Icon, color, bg } = SEV_CFG[risk.severity]
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${bg}`}>
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${color}`} />
      <div className="min-w-0">
        <p className={`text-[12px] font-semibold ${color} mb-0.5`}>{risk.title}</p>
        <p className="text-[11px] text-white/50 leading-relaxed">{risk.detail}</p>
      </div>
    </div>
  )
}

export function GoalRisks({ risks, loading }: Props) {
  if (loading) {
    return <div className="h-36 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Risks</p>
        {risks.length > 0 && (
          <span className="ml-auto text-[10px] text-white/25">{risks.length} active</span>
        )}
      </div>

      {risks.length === 0 ? (
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400/60" />
          <p className="text-sm text-emerald-400/60">No active risks detected.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {risks.map((r, i) => <RiskRow key={i} risk={r} />)}
        </div>
      )}
    </Card>
  )
}

'use client'

import { AlertTriangle, Info, Zap, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Rec = CoachPageData['recommendations'][number]

type Props = { recommendations: CoachPageData['recommendations']; loading: boolean }

const TIER_CFG = {
  high:   { Icon: Zap,           label: 'High risk',   color: 'text-red-400',    bg: 'bg-red-500/8',    border: 'border-red-500/20' },
  medium: { Icon: AlertTriangle, label: 'Medium risk',  color: 'text-amber-400',  bg: 'bg-amber-500/8',  border: 'border-amber-500/20' },
  low:    { Icon: Info,          label: 'Low risk',    color: 'text-sky-400',    bg: 'bg-sky-500/8',    border: 'border-sky-500/20' },
} as const

const CONF_COLOR = { high: 'text-emerald-400', moderate: 'text-amber-400', low: 'text-white/30' } as const

function RecCard({ rec }: { rec: Rec }) {
  const cfg = TIER_CFG[rec.tier]
  return (
    <div className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-2.5">
        <cfg.Icon className={`w-3.5 h-3.5 ${cfg.color} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${rec.blocked ? 'text-white/30 line-through' : 'text-white/80'}`}>
            {rec.text}
          </p>
          {rec.blocked && rec.blockedReason && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Lock className="w-3 h-3 text-white/25 shrink-0" />
              <p className="text-[10px] text-white/30 italic">{rec.blockedReason}</p>
            </div>
          )}
          {rec.evidence.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rec.evidence.map((ev, i) => (
                <span key={i} className="text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded-full">
                  {ev}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className={`text-[9px] font-medium shrink-0 mt-0.5 capitalize ${CONF_COLOR[rec.confidence]}`}>
          {rec.confidence}
        </span>
      </div>
    </div>
  )
}

export function RecommendationBoard({ recommendations, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-32 animate-pulse" />
  }

  if (recommendations.length === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-2">
          Recommendations
        </p>
        <p className="text-sm text-white/25">No active recommendations. All signals are within range.</p>
      </Card>
    )
  }

  const high   = recommendations.filter(r => r.tier === 'high')
  const medium = recommendations.filter(r => r.tier === 'medium')
  const low    = recommendations.filter(r => r.tier === 'low')

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">
        Recommendations
      </p>
      <div className="space-y-2">
        {high.length > 0 && (
          <>
            <p className="text-[9px] font-bold text-red-400/60 uppercase tracking-widest">Tier 1 — High risk</p>
            {high.map((r, i) => <RecCard key={i} rec={r} />)}
          </>
        )}
        {medium.length > 0 && (
          <>
            {high.length > 0 && <div className="h-px bg-white/5 my-1" />}
            <p className="text-[9px] font-bold text-amber-400/60 uppercase tracking-widest">Tier 2 — Medium risk</p>
            {medium.map((r, i) => <RecCard key={i} rec={r} />)}
          </>
        )}
        {low.length > 0 && (
          <>
            {(high.length > 0 || medium.length > 0) && <div className="h-px bg-white/5 my-1" />}
            <p className="text-[9px] font-bold text-sky-400/60 uppercase tracking-widest">Tier 3 — Low risk</p>
            {low.map((r, i) => <RecCard key={i} rec={r} />)}
          </>
        )}
      </div>
    </Card>
  )
}

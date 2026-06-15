'use client'

import { Zap, Utensils, Heart, Dumbbell, HelpCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData, LimiterType, Confidence } from './use-goals-data'

type Props = { biggestLimiter: GoalsPageData['biggestLimiter']; loading: boolean }

const LIMITER_CFG: Record<LimiterType, {
  label:  string
  Icon:   typeof Zap
  color:  string
  bg:     string
}> = {
  nutrition: { label: 'Nutrition',   Icon: Utensils, color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' },
  recovery:  { label: 'Recovery',    Icon: Heart,    color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/20' },
  training:  { label: 'Training',    Icon: Dumbbell, color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20' },
  adherence: { label: 'Adherence',   Icon: Zap,      color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20' },
  unknown:   { label: 'No Limiter',  Icon: HelpCircle, color: 'text-white/30', bg: 'bg-white/5 border-white/10' },
}

const CONF_LABEL: Record<Confidence, string> = {
  high:   'High confidence',
  medium: 'Medium confidence',
  low:    'Low confidence',
}

export function BiggestLimiter({ biggestLimiter, loading }: Props) {
  if (loading) {
    return <div className="h-40 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!biggestLimiter) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Biggest Limiter</p>
        </div>
        <p className="text-sm text-white/25">Log workouts and nutrition with Rex to identify your primary limiter.</p>
      </Card>
    )
  }

  const { limiter, why, evidence, confidence } = biggestLimiter
  const cfg = LIMITER_CFG[limiter]
  const { Icon } = cfg

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Biggest Limiter</p>
        <span className="ml-auto text-[10px] text-white/25">{CONF_LABEL[confidence]}</span>
      </div>

      {/* Limiter badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border mb-3 ${cfg.bg}`}>
        <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
        <span className={`text-[12px] font-bold ${cfg.color}`}>{cfg.label}</span>
      </div>

      {/* Why */}
      {why && <p className="text-sm text-white/70 leading-relaxed mb-2">{why}</p>}

      {/* Evidence */}
      {evidence && limiter !== 'unknown' && (
        <p className="text-[11px] text-white/40 leading-relaxed border-t border-white/5 pt-2">{evidence}</p>
      )}
    </Card>
  )
}

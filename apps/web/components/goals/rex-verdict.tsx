'use client'

import { Bot, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData } from './use-goals-data'

type Props = { verdict: GoalsPageData['verdict']; loading: boolean }

const OUTLOOK_CFG = {
  positive: { bar: 'bg-emerald-400', text: 'text-emerald-400', border: 'border-emerald-400/20' },
  neutral:  { bar: 'bg-white/20',   text: 'text-white/40',    border: 'border-white/10' },
  negative: { bar: 'bg-amber-400',  text: 'text-amber-400',   border: 'border-amber-400/20' },
}

const LIMITER_LABELS: Record<string, string> = {
  nutrition:  'Nutrition',
  recovery:   'Recovery',
  training:   'Training',
  adherence:  'Adherence',
}

export function RexVerdict({ verdict, loading }: Props) {
  if (loading) {
    return <div className="h-32 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  const { headline, detail, limiter, outlook } = verdict
  const cfg = OUTLOOK_CFG[outlook]
  const OutlookIcon = outlook === 'positive' ? TrendingUp : outlook === 'negative' ? TrendingDown : Minus

  return (
    <Card className={`border bg-slate-900/50 p-5 ${cfg.border}`}>
      {/* Accent bar */}
      <div className={`w-6 h-1 rounded-full mb-4 ${cfg.bar}`} />

      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-white/40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Rex's Verdict</p>
            <OutlookIcon className={`w-3.5 h-3.5 ${cfg.text} ml-auto`} />
          </div>
          <p className={`text-sm font-bold mb-1 ${cfg.text}`}>{headline}</p>
          <p className="text-[12px] text-white/55 leading-relaxed">{detail}</p>
          {limiter && (
            <p className="text-[10px] text-white/25 mt-2">
              Primary limiter: <span className="text-white/40">{LIMITER_LABELS[limiter] ?? limiter}</span>
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

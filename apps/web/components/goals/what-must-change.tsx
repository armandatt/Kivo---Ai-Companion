'use client'

import { ArrowRight, Lightbulb } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData } from './use-goals-data'

type Props = { whatMustChange: GoalsPageData['whatMustChange']; loading: boolean }

export function WhatMustChange({ whatMustChange, loading }: Props) {
  if (loading) {
    return <div className="h-40 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!whatMustChange) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <ArrowRight className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">What Must Change</p>
        </div>
        <p className="text-sm text-white/25">Set a goal with Rex to see what's required.</p>
      </Card>
    )
  }

  const { requiredRate, currentRate, gap, unit, highestLeverage, context } = whatMustChange
  const unitShort = unit.replace('week', 'wk')
  const fmtRate   = (r: number | null) => r !== null ? `${r > 0 ? '+' : ''}${r}${unitShort}` : '—'
  const gapVal    = gap !== null ? Math.round(Math.abs(gap) * 100) / 100 : null
  const isAhead   = gap !== null && gap <= 0

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <ArrowRight className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">What Must Change</p>
      </div>

      {context && (
        <p className="text-[10px] text-white/30 mb-3">{context}</p>
      )}

      {/* Pace comparison */}
      {(requiredRate !== null || currentRate !== null) && (
        <div className="flex items-center gap-3 mb-4">
          <div className="text-center">
            <p className="text-[10px] text-white/30 mb-0.5">Current</p>
            <p className="text-lg font-bold text-white/70 tabular-nums">{fmtRate(currentRate)}</p>
          </div>
          <ArrowRight className="w-4 h-4 text-white/20 shrink-0" />
          <div className="text-center">
            <p className="text-[10px] text-white/30 mb-0.5">Required</p>
            <p className={`text-lg font-bold tabular-nums ${isAhead ? 'text-emerald-400' : 'text-amber-400'}`}>
              {fmtRate(requiredRate)}
            </p>
          </div>
          {gapVal !== null && (
            <div className="ml-auto text-right">
              <p className="text-[10px] text-white/30 mb-0.5">Gap</p>
              <p className={`text-sm font-bold ${isAhead ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isAhead ? 'On pace ✓' : `${gapVal}${unitShort} short`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Highest leverage action */}
      <div className="flex items-start gap-2 bg-white/4 border border-white/8 rounded-xl p-3">
        <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[12px] text-white/65 leading-relaxed">{highestLeverage}</p>
      </div>
    </Card>
  )
}

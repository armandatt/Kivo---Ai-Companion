'use client'

import { TrendingDown, Lightbulb } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { PlannerPageData } from './use-planner-data'

type Props = {
  plateauReviews: PlannerPageData['plateauReviews']
  loading:        boolean
}

export function PlateauReviews({ plateauReviews, loading }: Props) {
  if (loading || plateauReviews.length === 0) return null

  return (
    <Card className="border-amber-500/20 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-amber-400" />
        <p className="text-[11px] font-semibold text-amber-400/70 uppercase tracking-wider">
          Plateau Alert
        </p>
      </div>

      <div className="space-y-4">
        {plateauReviews.map(item => (
          <div key={item.exercise} className="border-b border-white/5 last:border-0 pb-3 last:pb-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-white">{item.exercise}</span>
              <span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                {item.sessionsStuck} sessions stuck
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <Lightbulb className="w-3 h-3 text-white/30 mt-0.5 shrink-0" />
              <p className="text-[11px] text-white/45 leading-relaxed">{item.suggestedFix}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

'use client'

import { AlertTriangle, Lightbulb } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData } from './use-progress-data'

type Props = { plateauDetector: ProgressPageData['plateauDetector'] }

export function PlateauDetector({ plateauDetector }: Props) {
  if (!plateauDetector || plateauDetector.stalledLifts.length === 0) return null

  return (
    <Card className="border-amber-500/20 bg-linear-to-br from-amber-950/30 to-slate-950 p-5">
      {/* Header — intentionally prominent */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center border border-amber-500/25">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Plateau Detected</p>
          <p className="text-sm font-bold text-amber-400">
            {plateauDetector.stalledLifts.length} exercise{plateauDetector.stalledLifts.length > 1 ? 's' : ''} stalled
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {plateauDetector.stalledLifts.map(lift => (
          <div key={lift.exercise} className="border border-amber-500/15 rounded-xl p-3 bg-amber-500/5">
            {/* Exercise header */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-sm font-bold text-white capitalize">{lift.exercise}</p>
                <p className="text-[10px] text-amber-400/70 mt-0.5">
                  {lift.sessionsStuck}+ sessions at the same weight
                </p>
              </div>
              {lift.currentWeightKg !== null && (
                <div className="text-right shrink-0">
                  <p className="text-base font-bold text-amber-400">{lift.currentWeightKg}kg</p>
                  <p className="text-[9px] text-white/20">current</p>
                </div>
              )}
            </div>

            {/* Suggested fix */}
            <div className="flex items-start gap-2 bg-white/3 rounded-lg p-2.5 border border-white/5">
              <Lightbulb className="w-3.5 h-3.5 text-amber-400/70 shrink-0 mt-0.5" />
              <p className="text-[11px] text-white/50 leading-relaxed">{lift.suggestedFix}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

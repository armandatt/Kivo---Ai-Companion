'use client'

import { MapPin, Flag, CheckCircle2, Circle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData } from './use-goals-data'

type Props = { timeline: GoalsPageData['timeline']; loading: boolean }

function fmt(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function GoalTimeline({ timeline, loading }: Props) {
  if (loading) {
    return <div className="h-44 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!timeline) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Timeline</p>
        </div>
        <p className="text-sm text-white/25">Set a goal with a target date to see your timeline.</p>
      </Card>
    )
  }

  const { startDate, targetDate, progressPct, milestones } = timeline
  const pct = Math.min(Math.max(progressPct, 0), 100)

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Timeline</p>
      </div>

      {/* Progress bar track */}
      <div className="relative mb-4">
        <div className="h-2 rounded-full bg-white/8 overflow-hidden">
          <div
            className="h-full rounded-full bg-linear-to-r from-sky-500 to-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-900"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Date labels */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] text-white/25">Start</p>
          <p className="text-[11px] text-white/50">{fmt(startDate)}</p>
        </div>
        <p className={`text-sm font-bold ${pct >= 75 ? 'text-emerald-400' : pct >= 40 ? 'text-sky-400' : 'text-white/60'}`}>
          {Math.round(pct)}%
        </p>
        {targetDate ? (
          <div className="text-right">
            <p className="text-[10px] text-white/25">Target</p>
            <p className="text-[11px] text-white/50">{fmt(targetDate)}</p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[10px] text-white/25">No deadline</p>
          </div>
        )}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="space-y-2 border-t border-white/5 pt-3">
          {milestones.map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              {m.reached
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                : <Circle className="w-3.5 h-3.5 text-white/20 shrink-0 mt-0.5" />
              }
              <div className="min-w-0">
                <p className={`text-[11px] font-medium ${m.reached ? 'text-white/65' : 'text-white/25'}`}>{m.label}</p>
                <p className="text-[10px] text-white/25">{fmt(m.date)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

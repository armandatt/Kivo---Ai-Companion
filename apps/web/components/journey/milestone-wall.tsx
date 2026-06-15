'use client'

import { CheckCircle2, Circle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { milestones: JourneyPageData['milestones']; loading: boolean }

const TYPE_COLORS: Record<string, { reached: string; ring: string }> = {
  session: { reached: 'text-violet-400', ring: 'border-violet-400/30' },
  streak:  { reached: 'text-orange-400', ring: 'border-orange-400/30' },
  pr:      { reached: 'text-yellow-400', ring: 'border-yellow-400/30' },
  weight:  { reached: 'text-emerald-400',ring: 'border-emerald-400/30'},
  goal:    { reached: 'text-sky-400',    ring: 'border-sky-400/30'   },
}

export function MilestoneWall({ milestones, loading }: Props) {
  if (loading) {
    return <div className="h-48 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (milestones.length === 0) return null

  const reached   = milestones.filter(m => m.reached)
  const unreached = milestones.filter(m => !m.reached)

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Milestone Wall</p>
        <span className="text-[10px] text-white/25">
          {reached.length}/{milestones.length} reached
        </span>
      </div>

      {/* Reached */}
      {reached.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-white/20 uppercase tracking-wider mb-2">Reached</p>
          <div className="grid grid-cols-2 gap-2">
            {reached.map((m) => {
              const cfg = TYPE_COLORS[m.type] ?? TYPE_COLORS['session']!
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-2 bg-white/4 border rounded-lg p-2.5 ${cfg.ring}`}
                >
                  <CheckCircle2 className={`w-4 h-4 shrink-0 ${cfg.reached}`} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white/70 truncate">{m.label}</p>
                    <p className="text-[10px] text-white/30 truncate">{m.detail}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Next up */}
      {unreached.length > 0 && (
        <div>
          <p className="text-[10px] text-white/20 uppercase tracking-wider mb-2">Next up</p>
          <div className="grid grid-cols-2 gap-2">
            {unreached.slice(0, 6).map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 bg-white/2 border border-white/5 rounded-lg p-2.5 opacity-50"
              >
                <Circle className="w-4 h-4 shrink-0 text-white/20" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/40 truncate">{m.label}</p>
                  <p className="text-[10px] text-white/20 truncate">{m.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

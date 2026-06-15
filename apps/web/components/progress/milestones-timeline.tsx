'use client'

import { Trophy, Dumbbell, Flame, Star, Calendar } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData } from './use-progress-data'

type Props = { milestones: ProgressPageData['milestones']; loading: boolean }

const TYPE_CFG = {
  session:     { Icon: Calendar, color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20' },
  pr:          { Icon: Dumbbell, color: 'text-violet-400', bg: 'bg-violet-400/10 border-violet-400/20' },
  streak:      { Icon: Flame,    color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' },
  achievement: { Icon: Trophy,   color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20' },
} as const

function fmt(d: string): string {
  if (d === 'lifetime') return 'Lifetime'
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function MilestonesTimeline({ milestones, loading }: Props) {
  if (loading) {
    return <div className="h-48 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (milestones.length === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Milestones</p>
        </div>
        <p className="text-sm text-white/25">No milestones yet — keep training.</p>
      </Card>
    )
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Milestones</p>
        <span className="ml-auto text-[10px] text-white/20">{milestones.length} total</span>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-white/8" />

        <div className="space-y-4">
          {milestones.map((m, i) => {
            const cfg = TYPE_CFG[m.type]
            return (
              <div key={i} className="flex items-start gap-3 relative">
                {/* Icon bubble */}
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 z-10 ${cfg.bg}`}>
                  <cfg.Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                </div>
                {/* Content */}
                <div className="pt-0.5 min-w-0">
                  <p className="text-[12px] font-semibold text-white/80">{m.title}</p>
                  <p className="text-[11px] text-white/45 leading-relaxed">{m.description}</p>
                  <p className="text-[10px] text-white/20 mt-0.5">{fmt(m.date)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

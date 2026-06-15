'use client'

import { Trophy, Flame, Scale, BarChart2, Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { biggestWins: JourneyPageData['biggestWins']; loading: boolean }

const WIN_CFG = {
  pr:          { icon: Trophy,    color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  streak:      { icon: Flame,     color: 'text-orange-400', bg: 'bg-orange-400/10' },
  weight:      { icon: Scale,     color: 'text-emerald-400',bg: 'bg-emerald-400/10'},
  consistency: { icon: Zap,       color: 'text-violet-400', bg: 'bg-violet-400/10' },
  volume:      { icon: BarChart2, color: 'text-sky-400',    bg: 'bg-sky-400/10'   },
}

export function BiggestWins({ biggestWins, loading }: Props) {
  if (loading) {
    return <div className="h-32 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (biggestWins.length === 0) return null

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">Biggest Wins</p>
      <div className="grid grid-cols-2 gap-3">
        {biggestWins.map((win, i) => {
          const cfg = WIN_CFG[win.type]
          const Icon = cfg.icon
          return (
            <div key={i} className="flex items-start gap-2.5 bg-white/3 rounded-xl p-3 border border-white/5">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
                <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-white/30 truncate">{win.title}</p>
                <p className={`text-sm font-bold ${cfg.color}`}>{win.value}</p>
                <p className="text-[10px] text-white/25 leading-snug mt-0.5 line-clamp-2">{win.detail}</p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

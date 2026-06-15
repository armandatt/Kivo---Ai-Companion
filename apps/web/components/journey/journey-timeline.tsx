'use client'

import {
  Trophy, Dumbbell, TrendingUp, Scale,
  Flag, Zap, RotateCcw, Star, Flame,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData, TimelineEventType } from './use-journey-data'

type Props = { timeline: JourneyPageData['timeline']; loading: boolean }

const EVENT_CFG: Record<TimelineEventType, { icon: React.ElementType; color: string; bg: string }> = {
  joined:              { icon: Flag,        color: 'text-sky-400',     bg: 'bg-sky-400/10'     },
  first_workout:       { icon: Dumbbell,    color: 'text-violet-400',  bg: 'bg-violet-400/10'  },
  pr:                  { icon: Trophy,      color: 'text-yellow-400',  bg: 'bg-yellow-400/10'  },
  weight_milestone:    { icon: Scale,       color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  goal_milestone:      { icon: TrendingUp,  color: 'text-sky-400',     bg: 'bg-sky-400/10'     },
  streak_milestone:    { icon: Flame,       color: 'text-orange-400',  bg: 'bg-orange-400/10'  },
  comeback:            { icon: RotateCcw,   color: 'text-amber-400',   bg: 'bg-amber-400/10'   },
  plateau_breakthrough:{ icon: Zap,         color: 'text-pink-400',    bg: 'bg-pink-400/10'    },
  achievement:         { icon: Star,        color: 'text-yellow-300',  bg: 'bg-yellow-300/10'  },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function JourneyTimeline({ timeline, loading }: Props) {
  if (loading) {
    return <div className="h-64 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (timeline.length === 0) {
    return null
  }

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">Timeline</p>
      <div className="relative">
        {/* vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-white/6" />

        <div className="space-y-4">
          {timeline.map((ev, i) => {
            const cfg = EVENT_CFG[ev.type]
            const Icon = cfg.icon
            return (
              <div key={i} className="flex items-start gap-3">
                {/* Icon bubble sits on the line */}
                <div className={`relative z-10 w-8 h-8 rounded-full border border-white/10 flex items-center justify-center shrink-0 ${cfg.bg}`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-[12px] font-semibold text-white/75">{ev.title}</p>
                  <p className="text-[11px] text-white/35 mt-0.5">{ev.detail}</p>
                  <p className="text-[10px] text-white/20 mt-1">{fmt(ev.date)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

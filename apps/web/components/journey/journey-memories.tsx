'use client'

import { Star, Flag, Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { memories: JourneyPageData['memories']; loading: boolean }

const MEM_CFG = {
  achievement:  { icon: Star, color: 'text-yellow-400', bg: 'bg-yellow-400/8' },
  goal:         { icon: Flag, color: 'text-sky-400',    bg: 'bg-sky-400/8'   },
  breakthrough: { icon: Zap,  color: 'text-pink-400',   bg: 'bg-pink-400/8'  },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function JourneyMemories({ memories, loading }: Props) {
  if (loading) {
    return <div className="h-32 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (memories.length === 0) return null

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">Memories</p>
      <div className="space-y-2.5">
        {memories.map((m, i) => {
          const cfg = MEM_CFG[m.type]
          const Icon = cfg.icon
          return (
            <div key={i} className={`flex items-start gap-2.5 rounded-xl p-3 ${cfg.bg}`}>
              <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${cfg.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-white/65 leading-snug">{m.text}</p>
                <p className="text-[10px] text-white/25 mt-1">{fmt(m.date)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

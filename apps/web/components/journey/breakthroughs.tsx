'use client'

import { Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { breakthroughs: JourneyPageData['breakthroughs']; loading: boolean }

const TYPE_CFG = {
  plateau_resolved:       { label: 'Strength plateau broken', color: 'text-pink-400',    bg: 'bg-pink-400/8 border-pink-400/15'    },
  weight_stall_resolved:  { label: 'Weight plateau broken',   color: 'text-emerald-400', bg: 'bg-emerald-400/8 border-emerald-400/15'},
  consistency_jump:       { label: 'Consistency jump',         color: 'text-violet-400',  bg: 'bg-violet-400/8 border-violet-400/15' },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function Breakthroughs({ breakthroughs, loading }: Props) {
  if (loading) {
    return <div className="h-24 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (breakthroughs.length === 0) return null

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-pink-400" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Breakthroughs</p>
      </div>
      <div className="space-y-3">
        {breakthroughs.map((b, i) => {
          const cfg = TYPE_CFG[b.type]
          return (
            <div key={i} className={`border rounded-xl p-3 ${cfg.bg}`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[11px] font-bold ${cfg.color}`}>{b.title}</span>
                <span className="text-[10px] text-white/20 ml-auto">{fmt(b.date)}</span>
              </div>
              <p className="text-[11px] text-white/40">{b.detail}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

'use client'

import { Bot, ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Props = { rexSnapshot: CoachPageData['rexSnapshot']; loading: boolean }

export function RexSnapshot({ rexSnapshot, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-40 animate-pulse" />
  }

  return (
    <Card className="border-emerald-500/20 bg-linear-to-br from-emerald-950/40 to-slate-950 p-5">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center border border-emerald-500/25">
          <Bot className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">What Rex Would Say</p>
          <p className="text-[10px] text-white/20 mt-0.5">Synthesized from canonical services · No AI generation</p>
        </div>
      </div>

      {/* Observations */}
      <div className="space-y-2 mb-4">
        {rexSnapshot.lines.map((line, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="w-1 h-1 rounded-full bg-emerald-400/50 mt-1.5 shrink-0" />
            <p className="text-sm text-white/70 leading-relaxed">{line}</p>
          </div>
        ))}
      </div>

      {/* Primary action */}
      <div className="flex items-center gap-2 pt-3 border-t border-emerald-500/15">
        <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <p className="text-sm font-semibold text-emerald-400">{rexSnapshot.primaryAction}</p>
      </div>
    </Card>
  )
}

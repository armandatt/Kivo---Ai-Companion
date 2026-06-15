'use client'

import { RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { comebacks: JourneyPageData['comebacks']; loading: boolean }

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function Comebacks({ comebacks, loading }: Props) {
  if (loading) {
    return <div className="h-28 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (comebacks.length === 0) return null

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <RotateCcw className="w-4 h-4 text-amber-400" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Comebacks</p>
      </div>
      <div className="space-y-3">
        {comebacks.map((c, i) => (
          <div key={i} className="bg-amber-400/5 border border-amber-400/10 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold text-amber-300">Back after {c.gapDays} days</span>
              <span className="text-[10px] text-white/25 ml-auto">{fmt(c.date)}</span>
            </div>
            <p className="text-[11px] text-white/40">{c.note}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-white/20 mt-3">
        You came back every time. That&apos;s the hardest part.
      </p>
    </Card>
  )
}

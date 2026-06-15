'use client'

import { Clock, Trophy, Flag, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData } from './use-goals-data'

type Props = { goalHistory: GoalsPageData['goalHistory']; loading: boolean }

function fmt(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

function eventIcon(event: string) {
  if (event === 'Achievement')    return { Icon: Trophy,     color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20' }
  if (event === 'Goal update')    return { Icon: RefreshCw,  color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20' }
  if (event === 'Goal set')       return { Icon: Flag,       color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20' }
  return { Icon: Clock, color: 'text-white/30', bg: 'bg-white/5 border-white/10' }
}

export function GoalHistory({ goalHistory, loading }: Props) {
  if (loading) {
    return <div className="h-36 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Goal History</p>
        {goalHistory.length > 0 && (
          <span className="ml-auto text-[10px] text-white/20">{goalHistory.length} event{goalHistory.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {goalHistory.length === 0 ? (
        <p className="text-sm text-white/25">No goal history yet — start logging with Rex.</p>
      ) : (
        <div className="relative">
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-white/8" />
          <div className="space-y-4">
            {goalHistory.map((h, i) => {
              const { Icon, color, bg } = eventIcon(h.event)
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 z-10 ${bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                  </div>
                  <div className="pt-0.5 min-w-0">
                    <p className="text-[11px] font-semibold text-white/60">{h.event}</p>
                    <p className="text-[11px] text-white/45 leading-relaxed">{h.detail}</p>
                    <p className="text-[10px] text-white/20 mt-0.5">{fmt(h.date)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

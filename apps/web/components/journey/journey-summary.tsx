'use client'

import { Calendar, Dumbbell, TrendingUp, Flame } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { summary: JourneyPageData['summary']; loading: boolean }

function Stat({ icon: Icon, value, label }: { icon: React.ElementType; value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-white/30">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  )
}

export function JourneySummary({ summary, loading }: Props) {
  if (loading) {
    return <div className="h-40 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  const weightStr = summary.weightChangeTotalKg !== null
    ? `${summary.weightChangeTotalKg > 0 ? '+' : ''}${summary.weightChangeTotalKg.toFixed(1)}kg`
    : '—'

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <div className="mb-4">
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Journey</p>
        <p className="text-base font-bold text-white mt-0.5">
          {summary.daysWithKivo} day{summary.daysWithKivo !== 1 ? 's' : ''} with Kivo
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Stat icon={Dumbbell}   value={String(summary.sessionsCompleted)} label="Sessions"       />
        <Stat icon={TrendingUp} value={weightStr}                         label="Weight change"  />
        <Stat icon={Flame}      value={`${summary.longestStreak}d`}       label="Longest streak" />
        <Stat icon={Calendar}   value={`${summary.currentStreak}d`}       label="Current streak" />
      </div>

      {summary.strengthChangeSummary && (
        <p className="mt-4 text-[11px] text-white/35 border-t border-white/6 pt-3">
          <span className="text-white/20">Biggest strength gain:</span>{' '}
          <span className="text-white/55">{summary.strengthChangeSummary}</span>
        </p>
      )}
    </Card>
  )
}

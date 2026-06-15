'use client'

import { CalendarCheck, Flame, Trophy } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { ProgressPageData } from './use-progress-data'

type Props = { consistency: ProgressPageData['consistency']; loading: boolean }

// Build a 13-week (91-day) grid of dates ending today
function buildGrid(): string[] {
  const days: string[] = []
  const today = new Date()
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function ConsistencyHeatmap({ consistency, loading }: Props) {
  if (loading) {
    return <div className="h-56 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  const { sessions, currentStreak, longestStreak, completionRate7d, completionRate30d, totalSessions } = consistency

  if (totalSessions === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <CalendarCheck className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Consistency</p>
        </div>
        <p className="text-sm text-white/25">Start logging workouts to see your training calendar.</p>
      </Card>
    )
  }

  const completedSet = new Set(sessions.map(s => s.date))
  const grid = buildGrid()

  // Pad so grid starts on Monday
  const firstDate    = new Date(grid[0]! + 'T00:00:00')
  const startDow     = (firstDate.getDay() + 6) % 7  // 0=Mon…6=Sun
  const paddedGrid   = [...Array(startDow).fill(null), ...grid] as (string | null)[]

  // Chunk into weeks
  const weeks: (string | null)[][] = []
  for (let i = 0; i < paddedGrid.length; i += 7) {
    weeks.push(paddedGrid.slice(i, i + 7))
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <CalendarCheck className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Consistency</p>
        <span className="ml-auto text-[10px] text-white/20">{totalSessions} total sessions</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: '7-day',  value: `${completionRate7d}%` },
          { label: '30-day', value: `${completionRate30d}%` },
          { label: 'Streak', value: `${currentStreak}d`, icon: <Flame className="w-3 h-3 text-orange-400" /> },
          { label: 'Best',   value: `${longestStreak}d`, icon: <Trophy className="w-3 h-3 text-amber-400" /> },
        ].map(stat => (
          <div key={stat.label} className="bg-white/4 rounded-xl px-2.5 py-2 text-center border border-white/6">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              {stat.icon ?? null}
              <p className="text-sm font-bold text-white">{stat.value}</p>
            </div>
            <p className="text-[9px] text-white/25 uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto">
        {/* Day labels */}
        <div className="flex gap-1 mb-1 pl-0">
          {WEEK_LABELS.map((l, i) => (
            <span key={i} className="w-5 text-center text-[8px] text-white/15">{l}</span>
          ))}
        </div>
        {/* Week columns — render as rows of 7 days */}
        <div className="space-y-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex gap-1">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="w-5 h-5" />
                const done = completedSet.has(day)
                const isToday = day === new Date().toISOString().slice(0, 10)
                return (
                  <div
                    key={day}
                    title={`${day}${done ? ' ✓' : ''}`}
                    className={`w-5 h-5 rounded-sm transition-colors ${
                      done
                        ? 'bg-emerald-500/70 border border-emerald-400/30'
                        : isToday
                        ? 'bg-white/10 border border-white/20'
                        : 'bg-white/5 border border-white/5'
                    }`}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-500/70 border border-emerald-400/30" />
            <span className="text-[9px] text-white/25">Trained</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-white/5 border border-white/5" />
            <span className="text-[9px] text-white/25">Rest</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

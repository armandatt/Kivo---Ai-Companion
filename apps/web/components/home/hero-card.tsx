'use client'

import { Clock, Zap, Moon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { HomePageData, WeekStripDay } from './use-home-data'

type Props = {
  hero:    HomePageData['hero'] | null
  loading: boolean
}

function Strip({ days }: { days: WeekStripDay[] }) {
  return (
    <div className="flex gap-1.5">
      {days.map((day) => (
        <div key={day.dayName} className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-medium text-white/20">{day.dayName}</span>
          <div className={[
            'w-full h-1.5 rounded-full transition-colors',
            day.isTrained  ? 'bg-emerald-500' :
            day.isPlanned  ? 'bg-emerald-500/35 ring-1 ring-emerald-500/40' :
            day.isToday    ? 'bg-white/12' :
                             'bg-white/5',
          ].join(' ')} />
        </div>
      ))}
    </div>
  )
}

export function HeroCard({ hero, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-44 animate-pulse" />
  }

  if (!hero) {
    return (
      <Card className="p-6 border-white/8 bg-slate-900/50">
        <p className="text-sm text-white/40">Connect Rex on Telegram to see your training plan.</p>
      </Card>
    )
  }

  const { todayMuscles, isTrainingDay, gymTimeStr, minutesUntilGym, weekStrip, alertMessage } = hero

  let timeLabel: string | null = null
  if (minutesUntilGym !== null) {
    if (minutesUntilGym > 0) {
      const h = Math.floor(minutesUntilGym / 60)
      const m = minutesUntilGym % 60
      timeLabel = h > 0 ? `${h}h ${m}m until gym` : `${m}m until gym`
    } else if (minutesUntilGym > -120) {
      timeLabel = 'Gym time — go'
    }
  } else if (gymTimeStr) {
    timeLabel = gymTimeStr
  }

  return (
    <Card className="relative overflow-hidden border-white/8 bg-linear-to-br from-slate-900 to-slate-950 p-6">
      {isTrainingDay && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-linear-to-r from-transparent via-emerald-500/60 to-transparent" />
      )}

      {alertMessage && (
        <div className="mb-4 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs text-amber-300 leading-snug">{alertMessage}</p>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-semibold tracking-widest text-white/25 uppercase mb-1">Today</p>
          {isTrainingDay && todayMuscles ? (
            <>
              <h2 className="text-2xl font-bold text-white leading-tight">{todayMuscles}</h2>
              {timeLabel && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400/70" />
                  <span className="text-sm text-emerald-400/70">{timeLabel}</span>
                </div>
              )}
            </>
          ) : (
            <h2 className="text-2xl font-bold text-white/40 leading-tight">Rest Day</h2>
          )}
        </div>
        <div className={`p-2.5 rounded-xl shrink-0 ${isTrainingDay ? 'bg-emerald-500/15' : 'bg-white/5'}`}>
          {isTrainingDay
            ? <Zap  className="w-5 h-5 text-emerald-400" />
            : <Moon className="w-5 h-5 text-white/25" />
          }
        </div>
      </div>

      <Strip days={weekStrip} />
    </Card>
  )
}

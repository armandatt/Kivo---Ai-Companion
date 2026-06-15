'use client'

import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { yearInReview: JourneyPageData['yearInReview']; loading: boolean }

function fmtDelta(d: number | null) {
  if (d === null) return '—'
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}kg`
}

function Section({
  label,
  sessions,
  weightDelta,
  topLiftLabel,
}: {
  label:         string
  sessions:      number
  weightDelta:   number | null
  topLiftLabel:  string | null
}) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/35">Sessions</span>
          <span className="text-[11px] font-semibold text-white/70">{sessions}</span>
        </div>
        {weightDelta !== null && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/35">Weight</span>
            <span className="text-[11px] font-semibold text-white/70">{fmtDelta(weightDelta)}</span>
          </div>
        )}
        {topLiftLabel && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/35">Top lift</span>
            <span className="text-[10px] font-semibold text-white/55 truncate text-right">{topLiftLabel}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function YearInReview({ yearInReview, loading }: Props) {
  if (loading) {
    return <div className="h-36 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">Year In Review</p>
      <div className="flex gap-4 divide-x divide-white/6">
        <Section
          label="This Month"
          sessions={yearInReview.thisMonth.sessions}
          weightDelta={yearInReview.thisMonth.weightDelta}
          topLiftLabel={yearInReview.thisMonth.topLiftLabel}
        />
        <div className="pl-4 flex-1 min-w-0">
          <Section
            label="Last 3 Months"
            sessions={yearInReview.last3Months.sessions}
            weightDelta={yearInReview.last3Months.weightDelta}
            topLiftLabel={yearInReview.last3Months.topLiftLabel}
          />
        </div>
        <div className="pl-4 flex-1 min-w-0">
          <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">All Time</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/35">Sessions</span>
              <span className="text-[11px] font-semibold text-white/70">{yearInReview.allTime.sessions}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/35">Weight</span>
              <span className="text-[11px] font-semibold text-white/70">{fmtDelta(yearInReview.allTime.weightDeltaKg)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/35">Best streak</span>
              <span className="text-[11px] font-semibold text-white/70">{yearInReview.allTime.longestStreak}d</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/35">Total PRs</span>
              <span className="text-[11px] font-semibold text-white/70">{yearInReview.allTime.totalPRs}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

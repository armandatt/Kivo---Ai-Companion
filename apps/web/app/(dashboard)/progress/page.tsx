'use client'

import { useProgressData }        from '@/components/progress/use-progress-data'
import { ProgressScorecard }      from '@/components/progress/progress-scorecard'
import { WeightJourney }          from '@/components/progress/weight-journey'
import { StrengthProgression }    from '@/components/progress/strength-progression'
import { ConsistencyHeatmap }     from '@/components/progress/consistency-heatmap'
import { RecoveryTrend }          from '@/components/progress/recovery-trend'
import { NutritionTrend }         from '@/components/progress/nutrition-trend'
import { PlateauDetector }        from '@/components/progress/plateau-detector'
import { MilestonesTimeline }     from '@/components/progress/milestones-timeline'
import { MonthlyDiff }            from '@/components/progress/monthly-diff'
import { CoachingInsights }       from '@/components/progress/coaching-insights'

export default function ProgressPage() {
  const { data, loading } = useProgressData()

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-4">
      <div className="mb-2">
        <h1 className="text-lg font-bold text-white">Progress</h1>
        <p className="text-xs text-white/30 mt-0.5">Am I actually improving?</p>
      </div>

      {/* S9 — Monthly diff first: most actionable for returning users */}
      <MonthlyDiff
        monthlyDiff={data?.monthlyDiff ?? {
          period: 'Last 30 days',
          weight: { delta: null, label: 'No data', invertColor: false }, strength: { delta: null, label: 'No data' },
          consistency: { delta: null, label: 'No data' }, protein: { delta: null, label: 'No data' },
          burnout: { delta: null, label: 'No data' },
        }}
        loading={loading}
      />

      {/* S1 — Scorecard pulse */}
      <ProgressScorecard
        scorecard={data?.scorecard ?? {
          weight: null, strength: null,
          consistency: { value: '—', direction: 'unknown', delta: null, status: 'unknown' },
          recovery: null, nutrition: null,
        }}
        loading={loading}
      />

      {/* S10 — Coaching insights (high priority) */}
      <CoachingInsights
        coachingInsights={data?.coachingInsights ?? []}
        loading={loading}
      />

      {/* S7 — Plateau detector (only renders when relevant) */}
      {(loading || (data?.plateauDetector && data.plateauDetector.stalledLifts.length > 0)) && (
        <PlateauDetector plateauDetector={data?.plateauDetector ?? null} />
      )}

      {/* S2 — Weight journey */}
      <WeightJourney
        weightJourney={data?.weightJourney ?? null}
        loading={loading}
      />

      {/* S3 — Strength PRs */}
      <StrengthProgression
        strengthProgression={data?.strengthProgression ?? null}
        loading={loading}
      />

      {/* S4 — Consistency heatmap */}
      <ConsistencyHeatmap
        consistency={data?.consistency ?? {
          sessions: [], currentStreak: 0, longestStreak: 0,
          completionRate7d: 0, completionRate30d: 0, totalSessions: 0, daysPerWeek: 3,
        }}
        loading={loading}
      />

      {/* S4 + S5 — Recovery and Nutrition side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RecoveryTrend
          recoveryTrend={data?.recoveryTrend ?? null}
          loading={loading}
        />
        <NutritionTrend
          nutritionTrend={data?.nutritionTrend ?? null}
          loading={loading}
        />
      </div>

      {/* S8 — Milestones */}
      <MilestonesTimeline
        milestones={data?.milestones ?? []}
        loading={loading}
      />
    </div>
  )
}

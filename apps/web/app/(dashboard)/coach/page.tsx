'use client'

import { useCoachData }         from '@/components/coach-brain/use-coach-data'
import { CurrentFocus }         from '@/components/coach-brain/current-focus'
import { ActiveInvestigation }  from '@/components/coach-brain/active-investigation'
import { RecommendationBoard }  from '@/components/coach-brain/recommendation-board'
import { RecoveryAnalysis }     from '@/components/coach-brain/recovery-analysis'
import { NutritionAnalysis }    from '@/components/coach-brain/nutrition-analysis'
import { GoalAnalysis }         from '@/components/coach-brain/goal-analysis'
import { MemoryBoard }          from '@/components/coach-brain/memory-board'
import { RexSnapshot }          from '@/components/coach-brain/rex-snapshot'
import { DecisionTrace }        from '@/components/coach-brain/decision-trace'

export default function CoachPage() {
  const { data, loading } = useCoachData()

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-4">
      <div className="mb-2">
        <h1 className="text-lg font-bold text-white">Coach</h1>
        <p className="text-xs text-white/30 mt-0.5">Rex's current beliefs, reasoning, and recommendations</p>
      </div>

      {/* S1: Current Focus */}
      <CurrentFocus
        currentFocus={data?.currentFocus ?? null}
        loading={loading}
      />

      {/* S8: What Rex Would Say — high visibility, before details */}
      <RexSnapshot
        rexSnapshot={data?.rexSnapshot ?? { lines: [], primaryAction: '' }}
        loading={loading}
      />

      {/* S3: Recommendation Board */}
      <RecommendationBoard
        recommendations={data?.recommendations ?? []}
        loading={loading}
      />

      {/* S2: Active Investigation — only shown when active */}
      {(loading || (data?.activeInvestigation && data.activeInvestigation.status === 'open')) && (
        <ActiveInvestigation
          activeInvestigation={data?.activeInvestigation ?? null}
          loading={loading}
        />
      )}

      {/* S4 + S5: Recovery and Nutrition side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RecoveryAnalysis
          recovery={data?.recovery ?? {
            score: null, status: null, constraintLevel: null, factors: [],
            hardConstraints: {
              noChallenge: false, noAccountability: false, noPlan: false,
              trainingBlocked: false, intensityReduced: false, toneFloor: null,
            },
          }}
          loading={loading}
        />
        <NutritionAnalysis
          nutrition={data?.nutrition ?? null}
          loading={loading}
        />
      </div>

      {/* S6: Goal Analysis */}
      <GoalAnalysis
        goalAnalysis={data?.goalAnalysis ?? null}
        loading={loading}
      />

      {/* S7: Memory Board */}
      <MemoryBoard
        activeMemories={data?.activeMemories ?? []}
        loading={loading}
      />

      {/* S9: Decision Trace — expandable at the bottom */}
      <DecisionTrace
        decisionTrace={data?.decisionTrace ?? {
          steps: [], activeConstraints: [],
          mentorScores: { motivation: 0, consistency: 0, burnoutRisk: 0, capacity: 0, stress: 0, discipline: 0, momentum: 0 },
          activeFlags: [],
        }}
        loading={loading}
      />
    </div>
  )
}

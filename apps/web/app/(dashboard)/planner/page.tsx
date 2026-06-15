'use client'

import { usePlannerData }      from '@/components/planner/use-planner-data'
import { TodayCard }           from '@/components/planner/today-card'
import { WeekTimeline }        from '@/components/planner/week-timeline'
import { WorkoutPlan }         from '@/components/planner/workout-plan'
import { WeightChecks }        from '@/components/planner/weight-checks'
import { NutritionReviews }    from '@/components/planner/nutrition-reviews'
import { GoalReviews }         from '@/components/planner/goal-reviews'
import { PlateauReviews }      from '@/components/planner/plateau-reviews'
import { CustomReminders }     from '@/components/planner/custom-reminders'

export default function PlannerPage() {
  const { data, loading } = usePlannerData()

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-4">
      <div className="mb-2">
        <h1 className="text-lg font-bold text-white">Planner</h1>
        <p className="text-xs text-white/30 mt-0.5">What is happening next</p>
      </div>

      <TodayCard
        today={data?.today ?? null}
        telegramConnected={data?.telegramConnected ?? false}
        loading={loading}
      />

      <WeekTimeline
        next7Days={data?.next7Days ?? []}
        loading={loading}
      />

      <WorkoutPlan
        workoutPlan={data?.workoutPlan ?? null}
        loading={loading}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <WeightChecks
          weightChecks={data?.weightChecks ?? { lastEntries: [], nextDueDateISO: null, frequencyDays: null, currentKg: null, weeklyRateKg: null, trend: null }}
          loading={loading}
        />
        <NutritionReviews
          nutritionReviews={data?.nutritionReviews ?? null}
          loading={loading}
        />
      </div>

      <GoalReviews
        goalReview={data?.goalReview ?? null}
        loading={loading}
      />

      <PlateauReviews
        plateauReviews={data?.plateauReviews ?? []}
        loading={loading}
      />

      <CustomReminders />
    </div>
  )
}

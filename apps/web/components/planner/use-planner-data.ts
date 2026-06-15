'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types mirror apps/api/planner/route.ts: PlannerPageData ──────────────────
// No component may compute scheduling, recovery, or nutrition logic locally.

export type TrainingDayStatus =
  | "due"
  | "completed"
  | "skipped"
  | "pending_confirmation"
  | "upcoming"
  | "unknown"

export type ReviewType = "weight" | "nutrition" | "goal" | "plateau"

export type TimelineEntry = {
  dateISO:  string
  dayName:  string
  isToday:  boolean
  isPast:   boolean
  isFuture: boolean
  workout: { muscles: string; status: "completed" | "planned" | "skipped" } | null
  reviews: Array<{ type: ReviewType; label: string }>
}

export type SplitDay = {
  dayNumber: number
  muscles:   string
  isNext:    boolean
  isDone:    boolean
}

export type WeighInEntry = {
  dateISO:  string
  weightKg: number
}

export type PlannerPageData = {
  telegramConnected: boolean
  isRexUser:         boolean

  today: {
    muscles:             string | null
    trainingStatus:      TrainingDayStatus
    gymTimeStr:          string | null
    minutesUntilGym:     number | null
    avgDurationMin:      number
    recoveryScore:       number | null
    recoveryStatusLabel: "ready" | "limited" | "rest" | null
    recoveryFactors:     string[]
    rexDirective:        string
    consecutiveMisses:   number
  }

  next7Days: TimelineEntry[]

  workoutPlan: {
    splitName:       string
    days:            SplitDay[]
    daysPerWeek:     number
    totalSessions:   number
    lastSessionDate: string | null
  } | null

  weightChecks: {
    lastEntries:    WeighInEntry[]
    nextDueDateISO: string | null
    frequencyDays:  number | null
    currentKg:      number | null
    weeklyRateKg:   number | null
    trend:          "gaining" | "losing" | "stable" | null
  }

  nutritionReviews: {
    primaryLimiter:    "recovery" | "training" | "nutrition" | "adherence" | "unknown"
    overallStatus:     "on_track" | "behind" | "critical" | "unknown"
    proteinTargetG:    number
    proteinAvgG:       number | null
    proteinDaysLogged: number
    calorieBalance:    "surplus" | "deficit" | "maintenance" | "unclear" | null
    actionNeeded:      boolean
    reason:            string
  } | null

  goalReview: {
    goalType:        string
    exercise:        string | null
    progressPercent: number
    status:          "ahead" | "on_track" | "behind" | "unknown"
    currentValue:    number | null
    targetValue:     number | null
    unit:            string
    startDate:       string
    targetDate:      string | null
    overallStatus:   "on_track" | "behind" | "critical" | "unknown"
    narrative:       string
  } | null

  plateauReviews: Array<{
    exercise:      string
    sessionsStuck: number
    suggestedFix:  string
  }>

  customReminders: never[]
}

export function usePlannerData() {
  const [data, setData]       = useState<PlannerPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/planner')
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json() as PlannerPageData
      setData(json)
      setError(null)
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 30_000)
    return () => clearInterval(interval)
  }, [load])

  return { data, loading, error, refresh: load }
}

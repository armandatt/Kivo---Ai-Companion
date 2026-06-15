'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types mirror apps/api/coach/route.ts: CoachPageData ──────────────────────

type Limiter    = "recovery" | "training" | "nutrition" | "adherence" | "unknown"
type Status     = "on_track" | "behind" | "critical" | "unknown"
type RecovLevel = "ready" | "limited" | "rest"
type Confidence = "low" | "moderate" | "high"
type StepStatus = "positive" | "warning" | "critical" | "neutral"
type Importance = "high" | "medium" | "low"

export type CoachPageData = {
  telegramConnected: boolean
  isRexUser:         boolean

  currentFocus: {
    limiter:       Limiter
    overallStatus: Status
    why:           string
    evidence:      string[]
    confidence:    Confidence
  } | null

  activeInvestigation: {
    topic:             string
    hypotheses:        string[]
    missingData:       string[]
    evidenceCollected: Record<string, string>
    attemptCount:      number
    maxAttempts:       3
    status:            "open" | "resolved" | "abandoned"
    daysOpen:          number
  } | null

  recommendations: Array<{
    tier:          "low" | "medium" | "high"
    text:          string
    evidence:      string[]
    confidence:    Confidence
    blocked:       boolean
    blockedReason: string | null
  }>

  recovery: {
    score:           number | null
    status:          RecovLevel | null
    constraintLevel: "training_blocked" | "intensity_reduced" | "unrestricted" | null
    factors:         string[]
    hardConstraints: {
      noChallenge:      boolean
      noAccountability: boolean
      noPlan:           boolean
      trainingBlocked:  boolean
      intensityReduced: boolean
      toneFloor:        "gentle" | "supportive" | null
    }
  }

  nutrition: {
    tier:                   1 | 2
    proteinTargetG:         number
    proteinAvgG:            number | null
    proteinDaysLogged:      number
    proteinTrend:           "up" | "down" | "stable" | null
    proteinConfidence:      Confidence | null
    calorieBalance:         "surplus" | "deficit" | "maintenance" | "unclear" | null
    calorieAlignedWithGoal: boolean | null
    calorieNarrative:       string | null
    calorieConfidence:      Confidence | null
    adherence:              "positive" | "negative" | null
    topFoods:               string[]
    actionNeeded:           boolean
    summary:                string
  } | null

  goalAnalysis: {
    goalType:          string
    exercise:          string | null
    progressPercent:   number
    status:            "ahead" | "on_track" | "behind" | "unknown"
    currentValue:      number | null
    targetValue:       number | null
    unit:              string
    startDate:         string
    targetDate:        string | null
    weeklyRateKg:      number | null
    weightTrend:       "gaining" | "losing" | "stable" | null
    weightStalled:     boolean
    whyProgressStatus: string
    etaLabel:          string | null
    overallStatus:     Status
  } | null

  activeMemories: Array<{
    id:              string
    type:            string
    key:             string
    value:           string
    confidence:      number
    ageHours:        number
    importanceLabel: Importance
    whySurfaced:     string
  }>

  rexSnapshot: {
    lines:         string[]
    primaryAction: string
  }

  decisionTrace: {
    steps:         Array<{ label: string; value: string; status: StepStatus }>
    activeConstraints: string[]
    mentorScores:  {
      motivation:  number
      consistency: number
      burnoutRisk: number
      capacity:    number
      stress:      number
      discipline:  number
      momentum:    number
    }
    activeFlags: string[]
  }
}

export function useCoachData() {
  const [data, setData]       = useState<CoachPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coach')
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json() as CoachPageData
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

'use client'

import { useState, useEffect, useCallback } from 'react'

export type HealthStatus  = 'healthy' | 'watch' | 'limiting'
export type LimiterType   = 'nutrition' | 'recovery' | 'training' | 'adherence' | 'unknown'
export type GoalStatus    = 'ahead' | 'on_track' | 'behind' | 'unknown'
export type Confidence    = 'low' | 'medium' | 'high'
export type ScenarioLever = 'current' | 'consistency' | 'nutrition' | 'combined'

export type GoalsPageData = {
  telegramConnected: boolean
  isRexUser:         boolean
  hasGoal:           boolean
  hasSessions:       boolean
  goalCategory:      string | null

  primaryGoal: {
    type:          string
    targetValue:   number | null
    currentValue:  number | null
    baselineValue: number | null
    unit:          string
    progressPct:   number | null
    status:        GoalStatus
    targetDate:    string | null
    daysRemaining: number | null
  } | null

  forecast: {
    currentPace:      number | null
    requiredPace:     number | null
    paceUnit:         string
    projectedWeeks:   number | null
    projectedDate:    string | null
    onTrack:          boolean
    confidence:       Confidence
    confidenceReason: string
  } | null

  goalHealth: {
    recovery:    { status: HealthStatus; note: string }
    nutrition:   { status: HealthStatus; note: string }
    consistency: { status: HealthStatus; note: string }
    training:    { status: HealthStatus; note: string }
  }

  biggestLimiter: {
    limiter:    LimiterType
    why:        string
    evidence:   string
    confidence: Confidence
  } | null

  whatMustChange: {
    requiredRate:    number | null
    currentRate:     number | null
    gap:             number | null
    unit:            string
    highestLeverage: string
    context:         string
  } | null

  risks: {
    title:    string
    detail:   string
    severity: 'high' | 'medium' | 'low'
    source:   string
  }[]

  timeline: {
    startDate:   string
    currentDate: string
    targetDate:  string | null
    progressPct: number
    milestones: { date: string; label: string; reached: boolean }[]
  } | null

  scenarios: {
    label:          string
    description:    string
    projectedWeeks: number | null
    projectedDate:  string | null
    deltaWeeks:     number | null
    lever:          ScenarioLever
  }[]

  goalHistory: { date: string; event: string; detail: string }[]

  verdict: {
    headline: string
    detail:   string
    limiter:  string | null
    outlook:  'positive' | 'neutral' | 'negative'
  }
}

export function useGoalsData() {
  const [data, setData]       = useState<GoalsPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/goals')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, 60_000)
    return () => clearInterval(id)
  }, [fetch_])

  return { data, loading, error }
}

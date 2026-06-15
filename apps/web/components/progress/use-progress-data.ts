'use client'

import { useState, useEffect, useCallback } from 'react'

export type ScorecardCard = {
  value:     string
  direction: 'up' | 'down' | 'stable' | 'unknown'
  delta:     string | null
  status:    'positive' | 'neutral' | 'warning' | 'unknown'
}

export type LiftSummary = {
  exercise:  string
  currentKg: number
  reps:      number
  date:      string
  prevKg:    number | null
  changeKg:  number | null
  prHistory: { date: string; weightKg: number }[]
}

export type MentorSnapshot = {
  timestamp:   string
  burnoutRisk: number
  motivation:  number
  capacity:    number
}

export type ProgressPageData = {
  telegramConnected: boolean
  isRexUser:         boolean

  scorecard: {
    weight:      ScorecardCard | null
    strength:    ScorecardCard | null
    consistency: ScorecardCard
    recovery:    ScorecardCard | null
    nutrition:   ScorecardCard | null
  }

  weightJourney: {
    entries:       { date: string; weightKg: number }[]
    currentWeight: number
    weeklyRate:    number
    trend:         'gaining' | 'losing' | 'stable'
    stalled:       boolean
    insight:       string
  } | null

  strengthProgression: {
    lifts:          LiftSummary[]
    totalCurrentKg: number
    biggestPR:      string
  } | null

  consistency: {
    sessions:          { date: string; completed: boolean; muscles: string[] }[]
    currentStreak:     number
    longestStreak:     number
    completionRate7d:  number
    completionRate30d: number
    totalSessions:     number
    daysPerWeek:       number
  }

  recoveryTrend: {
    currentScore:    number
    status:          'ready' | 'limited' | 'rest'
    constraintLevel: 'training_blocked' | 'intensity_reduced' | 'unrestricted'
    factors:         string[]
    history:         MentorSnapshot[]
    burnoutRisk:     number
    motivation:      number
    momentum:        number
  } | null

  nutritionTrend: {
    currentAvgG:     number | null
    targetG:         number
    daysLogged:      number
    trend:           'up' | 'down' | 'stable' | null
    confidence:      'low' | 'moderate' | 'high' | null
    prevAvgG:        number | null
    daysAboveTarget: number
    topFoods:        string[]
    adherence:       'positive' | 'negative' | null
    calorieBalance:  string | null
    calorieAligned:  boolean | null
  } | null

  plateauDetector: {
    stalledLifts: {
      exercise:        string
      sessionsStuck:   number
      currentWeightKg: number | null
      suggestedFix:    string
    }[]
  } | null

  milestones: {
    date:        string
    type:        'session' | 'pr' | 'streak' | 'achievement'
    title:       string
    description: string
  }[]

  monthlyDiff: {
    period:      string
    weight:      { delta: number | null; label: string; invertColor: boolean }
    strength:    { delta: number | null; label: string }
    consistency: { delta: number | null; label: string }
    protein:     { delta: number | null; label: string }
    burnout:     { delta: number | null; label: string }
  }

  coachingInsights: {
    text:     string
    source:   string
    priority: 'high' | 'medium' | 'low'
  }[]
}

export function useProgressData() {
  const [data, setData]       = useState<ProgressPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/progress')
      if (!res.ok) { setError('Failed to load'); return }
      const json: ProgressPageData = await res.json()
      setData(json)
      setError(null)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, 60_000)  // refresh every 60s
    return () => clearInterval(id)
  }, [fetch_])

  return { data, loading, error }
}

'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types mirror apps/api/home/route.ts: HomePageData ────────────────────────
// These are the ONLY types the home page components may depend on.
// No component may compute scheduling, overload, bottleneck, or stats locally.

export type WeekStripDay = {
  dayName:   string
  label:     string
  isToday:   boolean
  isTrained: boolean
  isPlanned: boolean
}

export type OverloadTarget = {
  exercise:     string
  nextWeightKg: number
  note:         string
  flag:         string | null
}

export type MainLiftEntry = {
  exercise:  string
  currentKg: number
  deltaKg:   number
  isPR:      boolean
  isStalled: boolean
  trend:     number[]
}

export type HomePageData = {
  user:               { name: string | null; email: string; image: string | null }
  telegramConnected:  boolean
  isRexUser:          boolean

  hero: {
    todayMuscles:    string | null
    isTrainingDay:   boolean
    gymTimeStr:      string | null
    minutesUntilGym: number | null
    weekStrip:       WeekStripDay[]
    alertMessage:    string | null
  }

  mission: {
    nextMuscles: string | null
    targets:     OverloadTarget[]
    phase1Note:  string | null
  }

  bottleneck: {
    primaryLimiter:      "recovery" | "training" | "nutrition" | "adherence" | "unknown"
    overallStatus:       "on_track" | "behind" | "critical" | "unknown"
    narrative:           string
    recoveryScore:       number | null
    recoveryStatusLabel: "ready" | "limited" | "rest" | null
    recoveryFactors:     string[]
  } | null

  momentum: {
    streakDays:   number
    mainLifts:    MainLiftEntry[]
    goalProgress: {
      goalType:        string
      exercise:        string | null
      progressPercent: number
      status:          "ahead" | "on_track" | "behind" | "unknown"
      currentValue:    number | null
      targetValue:     number | null
      unit:            string
    } | null
  }

  stats: {
    sessionsThisWeek:  number
    plannedThisWeek:   number
    consistencyScore:  number
    volumeThisWeekKg:  number
    rpeTrend:          "overtrained" | "undertrained" | "optimal" | "unknown"
    weightTrend: {
      currentKg:    number
      weeklyRateKg: number
      trend:        "gaining" | "losing" | "stable"
      stalled:      boolean
    } | null
  }

  chat: {
    lastMessage: { text: string; timestamp: string } | null
  }
}

export function useHomeData() {
  const [data, setData]       = useState<HomePageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/home')
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json() as HomePageData
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

'use client'

import { useState, useEffect, useCallback } from 'react'

export type TimelineEventType =
  | 'joined' | 'first_workout' | 'pr' | 'weight_milestone'
  | 'goal_milestone' | 'streak_milestone' | 'comeback'
  | 'plateau_breakthrough' | 'achievement'

export type ChapterType =
  | 'start' | 'consistency' | 'strength' | 'bulk' | 'cut'
  | 'comeback' | 'recovery' | 'maintenance'

export type JourneyPageData = {
  telegramConnected: boolean
  isRexUser:         boolean
  hasAnyData:        boolean

  summary: {
    daysWithKivo:          number
    sessionsCompleted:     number
    weightChangeTotalKg:   number | null
    strengthChangeSummary: string | null
    longestStreak:         number
    currentStreak:         number
    joinedDate:            string
    latestSessionDate:     string | null
  }

  timeline: {
    date:   string
    type:   TimelineEventType
    title:  string
    detail: string
  }[]

  chapters: {
    title:     string
    startDate: string
    endDate:   string
    summary:   string
    type:      ChapterType
  }[]

  biggestWins: {
    title:  string
    value:  string
    detail: string
    type:   'pr' | 'streak' | 'weight' | 'consistency' | 'volume'
  }[]

  comebacks: {
    date:          string
    gapDays:       number
    sessionsAfter: number
    note:          string
  }[]

  breakthroughs: {
    date:   string
    type:   'plateau_resolved' | 'weight_stall_resolved' | 'consistency_jump'
    title:  string
    detail: string
  }[]

  milestones: {
    id:      string
    label:   string
    detail:  string
    date:    string | null
    reached: boolean
    type:    'session' | 'pr' | 'streak' | 'weight' | 'goal'
  }[]

  yearInReview: {
    thisMonth:   { sessions: number; weightDelta: number | null; topLiftLabel: string | null }
    last3Months: { sessions: number; weightDelta: number | null; topLiftLabel: string | null }
    allTime:     { sessions: number; weightDeltaKg: number | null; longestStreak: number; totalPRs: number }
  }

  memories: {
    date:   string
    type:   'achievement' | 'goal' | 'breakthrough'
    text:   string
    weight: number
  }[]

  story: { lines: string[] }
}

export function useJourneyData() {
  const [data, setData]       = useState<JourneyPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/journey')
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

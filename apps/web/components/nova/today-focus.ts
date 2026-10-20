'use client'

import { useCallback, useState } from 'react'

// The subject the learner chose to work on today, kept in this browser for
// the rest of their day and sent with every Today and Planner request. The
// server checks it against their own subjects and plans only that one; the
// page plans nothing itself. A new day starts with every subject again.

const KEY = 'kivo-today-focus'

// The device's calendar day, "YYYY-MM-DD".
export const deviceDay = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

// The stored choice, if it was made today.
export function focusFromStorage(raw: string | null, today: string): string | null {
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as { day?: unknown; subject?: unknown }
    return stored.day === today && typeof stored.subject === 'string' && stored.subject.trim() ? stored.subject : null
  } catch {
    return null
  }
}

// "?minutes=40&subject=DSA", or "" when there is neither.
export function planQuery(minutes: number | null, subject: string | null): string {
  const params = new URLSearchParams()
  if (minutes) params.set('minutes', String(minutes))
  if (subject) params.set('subject', subject)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useTodayFocus(): [string | null, (subject: string | null) => void] {
  const [subject, setSubject] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try { return focusFromStorage(window.localStorage.getItem(KEY), deviceDay()) } catch { return null }
  })
  const choose = useCallback((next: string | null) => {
    setSubject(next)
    try {
      if (next) window.localStorage.setItem(KEY, JSON.stringify({ day: deviceDay(), subject: next }))
      else window.localStorage.removeItem(KEY)
    } catch { /* storage unavailable: the choice lasts for this page */ }
  }, [])
  return [subject, choose]
}

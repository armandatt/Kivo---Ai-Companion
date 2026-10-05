// Wording for values Nova's engines produce. Labels only: nothing here ranks,
// filters or decides.

import type { TodayActivity, TodayUrgency } from '@repo/api/nova/product/today.types'

export const URGENCY_LABEL: Record<TodayUrgency, string> = {
  critical: 'Critical today',
  high:     'High impact',
  normal:   'On plan',
  optional: 'Optional',
}

export const ACTIVITY_LABEL: Record<TodayActivity, string> = {
  review:       'Review',
  practice:     'Practice',
  new_material: 'New material',
  exam_prep:    'Exam prep',
}

export function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first ? first : null
}

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// 23:14, or 1:02:03 past the hour.
export function clock(totalSeconds: number): string {
  const s  = Math.max(0, Math.floor(totalSeconds))
  const h  = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function inDays(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export function daysAgo(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// A YYYY-MM-DD day key, as the server drew it in the student's timezone.
export function weekdayOf(dayKey: string, style: 'short' | 'long' = 'short'): string {
  return new Date(`${dayKey}T12:00:00Z`).toLocaleDateString(undefined, { weekday: style, timeZone: 'UTC' })
}

export function dayOfMonth(dayKey: string): string {
  return String(Number(dayKey.slice(8, 10)))
}

export function calendarDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone })
}

// "today", "yesterday", "5 days ago" for a past instant; "tomorrow",
// "in 4 days" for a future one. Calendar days in the viewer's own timezone.
export function relativeDay(iso: string, now: Date = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(new Date(iso)) - startOf(now)) / 86_400_000)
  return diff >= 0 ? inDays(diff) : daysAgo(-diff)
}

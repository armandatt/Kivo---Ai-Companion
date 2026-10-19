// The calendar page's arithmetic: which days a view shows, and where each item
// goes. Pure: no React, no fetch, no clock but the day given. Every day is a
// "YYYY-MM-DD" string in the learner's timezone (the server's NovaCalendarReady
// says which), so nothing here depends on the device's own zone.

import type { CalendarDeadlineItem, CalendarEventItem, CalendarTaskItem } from '@repo/api/nova/product/calendar.types'

export type CalendarMode = 'month' | 'week' | 'agenda'
export const CALENDAR_MODES: readonly CalendarMode[] = ['month', 'week', 'agenda']
export const AGENDA_DAYS = 28

const DAY_MS = 86_400_000
const toNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
const fromNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

export const addDays = (day: string, n: number): string => fromNumber(toNumber(day) + n)
export const daysBetween = (from: string, to: string): number => toNumber(to) - toNumber(from)
// 0 = Monday … 6 = Sunday.
export const weekdayIndex = (day: string): number => (new Date(toNumber(day) * DAY_MS).getUTCDay() + 6) % 7
export const mondayOf = (day: string): string => addDays(day, -weekdayIndex(day))
export const firstOfMonth = (day: string): string => `${day.slice(0, 7)}-01`

export function isDay(value: unknown): value is string {
  return typeof value === 'string' && value.length === 10 && fromNumber(toNumber(value)) === value
}

// The days a view shows, first and last, inclusive.
export function rangeFor(mode: CalendarMode, anchor: string): { from: string; to: string } {
  if (mode === 'week') { const from = mondayOf(anchor); return { from, to: addDays(from, 6) } }
  if (mode === 'agenda') return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) }
  // A month is drawn as whole weeks, six of them, so the grid never jumps.
  const from = mondayOf(firstOfMonth(anchor))
  return { from, to: addDays(from, 41) }
}

// The anchor one period earlier (-1) or later (+1).
export function shift(mode: CalendarMode, anchor: string, by: -1 | 1): string {
  if (mode === 'week') return addDays(anchor, 7 * by)
  if (mode === 'agenda') return addDays(anchor, AGENDA_DAYS * by)
  const [y, m] = anchor.split('-').map(Number) as [number, number]
  const month = new Date(Date.UTC(y, m - 1 + by, 1))
  return month.toISOString().slice(0, 10)
}

export function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let n = toNumber(from); n <= toNumber(to); n++) out.push(fromNumber(n))
  return out
}

const fmt = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' })

export const monthTitle = (day: string) => fmt(day, { month: 'long', year: 'numeric' })
export const dayTitle = (day: string) => fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDay = (day: string) => fmt(day, { weekday: 'short', day: 'numeric' })
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function periodTitle(mode: CalendarMode, anchor: string): string {
  if (mode === 'month') return monthTitle(anchor)
  const { from, to } = rangeFor(mode, anchor)
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  return sameMonth
    ? `${fmt(from, { day: 'numeric' })} – ${fmt(to, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

// The calendar day and clock minute of an instant, in a zone.
export function dayIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
export function minuteIn(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  return (get('hour') % 24) * 60 + get('minute')
}
export function timeLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

// The days an event covers in the learner's zone. An all-day event is its own
// days; a timed one the days its start and end fall on there (an end exactly
// at midnight belongs to the day before).
export function eventDays(event: CalendarEventItem, timezone: string): { first: string; last: string } {
  if (event.allDay || !event.startAt) return { first: event.startDay, last: event.endDay }
  const first = dayIn(event.startAt, timezone)
  if (!event.endAt) return { first, last: first }
  const end = new Date(Date.parse(event.endAt) - 1).toISOString()
  const last = dayIn(end, timezone)
  return { first, last: last < first ? first : last }
}

export interface DayItems {
  allDay:    CalendarEventItem[]
  timed:     CalendarEventItem[]
  tasks:     CalendarTaskItem[]
  deadlines: CalendarDeadlineItem[]
}

export const emptyDay = (): DayItems => ({ allDay: [], timed: [], tasks: [], deadlines: [] })

// Every item filed under each day it falls on, from..to. A timed event that
// runs over midnight is listed (and drawn) on each day it covers.
export function itemsByDay(
  view: { events: CalendarEventItem[]; tasks: CalendarTaskItem[]; deadlines: CalendarDeadlineItem[] },
  from: string, to: string, timezone: string,
): Map<string, DayItems> {
  const days = new Map<string, DayItems>()
  const at = (day: string) => { let d = days.get(day); if (!d) { d = emptyDay(); days.set(day, d) } return d }
  for (const e of view.events) {
    const { first, last } = eventDays(e, timezone)
    const start = first < from ? from : first
    const end = last > to ? to : last
    for (const day of start <= end ? daysOf(start, end) : []) {
      if (e.allDay || !e.startAt) at(day).allDay.push(e)
      else at(day).timed.push(e)
    }
  }
  for (const t of view.tasks) if (t.dueDay >= from && t.dueDay <= to) at(t.dueDay).tasks.push(t)
  for (const d of view.deadlines) if (d.day >= from && d.day <= to) at(d.day).deadlines.push(d)
  for (const d of days.values()) d.timed.sort((a, b) => Date.parse(a.startAt!) - Date.parse(b.startAt!))
  return days
}

// How many things are on a day, for a cell that cannot show them all.
export const countOf = (d: DayItems | undefined): number =>
  d ? d.allDay.length + d.timed.length + d.tasks.length + d.deadlines.length : 0

export interface PlacedEvent { event: CalendarEventItem; top: number; height: number; column: number; columns: number }

// Timed events on one day of the week grid: minutes from midnight to top and
// height (clipped to the day, at least 20 minutes tall so a title fits), and
// side-by-side columns where they overlap.
export function placeTimed(events: CalendarEventItem[], day: string, timezone: string): PlacedEvent[] {
  const boxes = events.map(event => {
    const startDay = dayIn(event.startAt!, timezone)
    const start = startDay < day ? 0 : minuteIn(event.startAt!, timezone)
    let end = start + 30
    if (event.endAt) {
      const endDay = dayIn(new Date(Date.parse(event.endAt) - 1).toISOString(), timezone)
      end = endDay > day ? 1440 : Math.max(start, minuteIn(event.endAt, timezone) || 1440)
    }
    return { event, top: start, height: Math.max(20, Math.min(1440, end) - start) }
  }).sort((a, b) => a.top - b.top || b.height - a.height)

  const placed: PlacedEvent[] = []
  let cluster: PlacedEvent[] = []
  let clusterEnd = -1
  const close = () => {
    const columns = Math.max(1, ...cluster.map(p => p.column + 1))
    for (const p of cluster) p.columns = columns
    cluster = []
  }
  for (const box of boxes) {
    if (box.top >= clusterEnd && cluster.length > 0) close()
    const taken = new Set(cluster.filter(p => p.top + p.height > box.top).map(p => p.column))
    let column = 0
    while (taken.has(column)) column++
    const p: PlacedEvent = { ...box, column, columns: 1 }
    cluster.push(p); placed.push(p)
    clusterEnd = Math.max(clusterEnd, box.top + box.height)
  }
  if (cluster.length > 0) close()
  return placed
}

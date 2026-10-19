// The calendar page's arithmetic. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CalendarEventItem } from '@repo/api/nova/product/calendar.types'
import { addDays, eventDays, itemsByDay, mondayOf, periodTitle, placeTimed, rangeFor, shift } from './calendar-grid'

const event = (over: Partial<CalendarEventItem>): CalendarEventItem => ({
  id: 'e', title: 'E', description: null, category: 'other', allDay: false, startDay: '2026-11-03', endDay: '2026-11-03',
  startAt: null, endAt: null, startTime: null, endTime: null, timezone: 'Asia/Kolkata', reminderMinutes: null, reminder: null,
  task: null, subject: null, ...over,
})

test('a month is six whole weeks from the Monday on or before the 1st', () => {
  assert.deepEqual(rangeFor('month', '2026-11-17'), { from: '2026-10-26', to: '2026-12-06' })
  assert.equal(mondayOf('2026-11-01'), '2026-10-26')   // a Sunday
  assert.equal(mondayOf('2026-11-02'), '2026-11-02')
})

test('a week is Monday to Sunday; the agenda is four weeks from the day shown', () => {
  assert.deepEqual(rangeFor('week', '2026-11-05'), { from: '2026-11-02', to: '2026-11-08' })
  assert.deepEqual(rangeFor('agenda', '2026-11-05'), { from: '2026-11-05', to: '2026-12-02' })
})

test('previous and next move by a whole period, across years and short months', () => {
  assert.equal(shift('month', '2026-01-31', 1), '2026-02-01')
  assert.equal(shift('month', '2026-01-15', -1), '2025-12-01')
  assert.equal(shift('week', '2026-12-30', 1), '2027-01-06')
  assert.equal(shift('agenda', '2026-11-05', -1), addDays('2026-11-05', -28))
  assert.equal(periodTitle('month', '2026-11-17'), 'November 2026')
})

test('every range a view asks for fits the server limit of 62 days', () => {
  for (const mode of ['month', 'week', 'agenda'] as const) {
    const { from, to } = rangeFor(mode, '2026-02-15')
    assert.ok((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 <= 62, mode)
  }
})

test('an all-day event is its own days; a timed one the days it falls on in the learner zone', () => {
  assert.deepEqual(eventDays(event({ allDay: true, startDay: '2026-11-03', endDay: '2026-11-05' }), 'UTC'), { first: '2026-11-03', last: '2026-11-05' })
  // 00:30 in Kolkata is the day before in UTC; it is shown on the Kolkata day.
  const early = event({ startAt: '2026-11-03T19:00:00.000Z', endAt: '2026-11-03T20:00:00.000Z' })
  assert.deepEqual(eventDays(early, 'Asia/Kolkata'), { first: '2026-11-04', last: '2026-11-04' })
  // An end at midnight belongs to the day before.
  const toMidnight = event({ startAt: '2026-11-03T16:30:00.000Z', endAt: '2026-11-03T18:30:00.000Z' })
  assert.deepEqual(eventDays(toMidnight, 'Asia/Kolkata'), { first: '2026-11-03', last: '2026-11-03' })
})

test('items are filed under each day they cover, inside the range only', () => {
  const view = {
    events: [event({ id: 'trip', allDay: true, startDay: '2026-10-30', endDay: '2026-11-02' })],
    tasks: [{ id: 't', title: 'T', dueDay: '2026-11-01', status: 'todo' as const, priority: null, subjectName: null, overdue: false }],
    deadlines: [{ id: 'd', title: 'D', kind: 'exam' as const, kindLabel: 'Exam', day: '2026-12-25', subjectName: null }],
  }
  const days = itemsByDay(view, '2026-11-01', '2026-11-30', 'UTC')
  assert.deepEqual([...days.keys()].sort(), ['2026-11-01', '2026-11-02'])
  assert.equal(days.get('2026-11-01')!.tasks.length, 1)
  assert.equal(days.get('2026-11-02')!.allDay[0]!.id, 'trip')
})

test('overlapping timed events sit side by side; separate ones take the full width', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 3, h, m)).toISOString()
  const placed = placeTimed([
    event({ id: 'a', startAt: at(9), endAt: at(10) }),
    event({ id: 'b', startAt: at(9, 30), endAt: at(11) }),
    event({ id: 'c', startAt: at(13), endAt: at(14) }),
  ], '2026-11-03', 'UTC')
  const byId = Object.fromEntries(placed.map(p => [p.event.id, p]))
  assert.equal(byId.a!.columns, 2)
  assert.notEqual(byId.a!.column, byId.b!.column)
  assert.equal(byId.c!.columns, 1)
  assert.equal(byId.a!.top, 540)
  assert.equal(byId.b!.height, 90)
})

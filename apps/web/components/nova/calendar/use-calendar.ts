'use client'

import { useCallback, useState } from 'react'
import type { CalendarEventInput, CalendarEventResponse, NovaCalendarView } from '@repo/api/nova/product/calendar.types'
import { useNovaView } from '../use-nova-view'

const FAILED = 'Could not reach Kivo. Check your connection and try again.'

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<CalendarEventResponse | { ok: true }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body:    body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 401) { window.location.href = '/signin?from=/calendar'; return { ok: false, error: 'unauthenticated', message: FAILED } }
    return await res.json() as CalendarEventResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

// The calendar for the days the page shows, and the three things that can be
// done to an event. Every change is sent to the server and the range is read
// back from it: the page never keeps an event the server did not accept.
export function useCalendar(range: { from: string; to: string }) {
  const { view, loading, refreshing, error: loadError, refresh } =
    useNovaView<NovaCalendarView>(`/api/nova/calendar?from=${range.from}&to=${range.to}`)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (request: Promise<CalendarEventResponse | { ok: true }>): Promise<boolean> => {
    setError(null)
    const result = await request
    const failed = 'error' in result && !result.ok
    if (failed) setError(result.message)
    await refresh()
    return !failed
  }, [refresh])

  // One key per submission: a double click or a retry makes one event.
  const create = useCallback((input: CalendarEventInput) =>
    run(send('/api/nova/calendar', 'POST', { ...input, clientKey: input.clientKey ?? `web:${crypto.randomUUID()}` })), [run])
  const update = useCallback((id: string, changes: CalendarEventInput) =>
    run(send(`/api/nova/calendar/${encodeURIComponent(id)}`, 'PATCH', changes)), [run])
  const remove = useCallback((id: string) =>
    run(send(`/api/nova/calendar/${encodeURIComponent(id)}`, 'DELETE')), [run])
  // One date of a repeating event, by the day it starts.
  const removeOccurrence = useCallback((id: string, day: string) =>
    run(send(`/api/nova/calendar/${encodeURIComponent(id)}?occurrence=${encodeURIComponent(day)}`, 'DELETE')), [run])

  return { view, loading, refreshing, loadError, error, clearError: () => setError(null), create, update, remove, removeOccurrence, refresh }
}

// A dated deadline, added through the one writer of deadlines.
export async function addDeadline(input: { title: string; date: string; kind: string; subjectName: string | null }): Promise<{ ok: true; status: 'added' | 'exists' } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/nova/exams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    const data = await res.json().catch(() => null) as { ok?: boolean; status?: 'added' | 'exists'; message?: string } | null
    if (res.ok && data?.ok && data.status) return { ok: true, status: data.status }
    return { ok: false, message: data?.message ?? "That date wasn't added. Try again." }
  } catch {
    return { ok: false, message: FAILED }
  }
}

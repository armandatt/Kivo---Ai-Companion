'use client'

import { useCallback, useState } from 'react'
import type { NovaTaskItem, NovaTasksView, TaskInput, TaskResponse } from '@repo/api/nova/product/tasks.types'
import { useNovaView } from '../use-nova-view'

const FAILED = 'Could not reach Nova. Check your connection and try again.'

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<TaskResponse | { ok: true }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body:    body === undefined ? undefined : JSON.stringify(body),
    })
    return await res.json() as TaskResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

// The learner's tasks, and the three things that can be done to them. Every
// change is sent to the server and the list is read back from it: the page
// shows a move at once, and takes it back if the server did not accept it.
export function useTasks() {
  const { view, loading, refreshing, error: loadError, refresh } = useNovaView<NovaTasksView>('/api/nova/tasks')
  // Changes shown before the server has answered, by task id.
  const [pending, setPending] = useState<Record<string, Partial<NovaTaskItem>>>({})
  const [error, setError]     = useState<string | null>(null)

  const tasks: NovaTaskItem[] = view?.status === 'ready'
    ? view.tasks.map(t => (pending[t.id] ? { ...t, ...pending[t.id] } : t))
    : []

  const settle = useCallback(async (id: string | null) => {
    await refresh()
    if (id) setPending(p => { const rest = { ...p }; delete rest[id]; return rest })
  }, [refresh])

  const create = useCallback(async (input: TaskInput): Promise<boolean> => {
    setError(null)
    // One key per submission: a double click or a retry makes one task.
    const result = await send('/api/nova/tasks', 'POST', { ...input, clientKey: input.clientKey ?? `web:${crypto.randomUUID()}` })
    if ('error' in result && !result.ok) { setError(result.message); return false }
    await settle(null)
    return true
  }, [settle])

  const update = useCallback(async (id: string, changes: TaskInput): Promise<boolean> => {
    setError(null)
    setPending(p => ({ ...p, [id]: { ...p[id], ...changes } as Partial<NovaTaskItem> }))
    const result = await send(`/api/nova/tasks/${encodeURIComponent(id)}`, 'PATCH', changes)
    const failed = 'error' in result && !result.ok
    if (failed) setError(result.message)
    await settle(id)
    return !failed
  }, [settle])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    setError(null)
    const result = await send(`/api/nova/tasks/${encodeURIComponent(id)}`, 'DELETE')
    const failed = 'error' in result && !result.ok
    if (failed) setError(result.message)
    await settle(null)
    return !failed
  }, [settle])

  return { view, tasks, loading, refreshing, loadError, error, clearError: () => setError(null), create, update, remove, refresh }
}

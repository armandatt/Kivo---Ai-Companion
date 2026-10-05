'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TodayAction } from '@repo/api/nova/product/today.types'
import { sendSessionCommand } from './nova-api'

// Starting a block Nova planned, from anywhere in the app: one command to the
// session route, then the focus screen. While a start is in flight no second
// one is sent.
export function useStartSession() {
  const router = useRouter()
  const [starting, setStarting] = useState<string | null>(null)   // key of the block being started
  const [error, setError]       = useState<string | null>(null)
  const inFlight = useRef(false)

  const start = useCallback(async (action: Pick<TodayAction, 'topicName' | 'subjectName' | 'durationMinutes'>, key: string = action.topicName) => {
    if (inFlight.current) return
    inFlight.current = true
    setStarting(key)
    setError(null)
    const res = await sendSessionCommand({
      action:         'start',
      topicName:      action.topicName,
      subjectName:    action.subjectName,
      plannedMinutes: action.durationMinutes,
    })
    if (res.ok && res.session) {
      router.push('/focus')
      return   // stay locked until the page changes
    }
    inFlight.current = false
    setStarting(null)
    setError(res.ok ? 'The session did not start. Try again.' : res.message)
  }, [router])

  return { start, starting, error }
}

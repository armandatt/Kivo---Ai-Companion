'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TelegramConnection } from '@repo/api/nova/product/telegram-connection'

const POLL_MS = 4000

// Whether this account has a Telegram chat, and the one way to add one: the
// server issues a short-lived link (POST /api/telegram/generate-token), the
// learner opens it and presses Start, and the server reports the chat as
// connected (GET /api/telegram/check-connection). The page holds the link
// only to open it; it is never shown as text or stored.
export function useTelegramLink(onPoll?: () => void) {
  const [connection, setConnection] = useState<TelegramConnection | null>(null)   // null: not known yet
  const [deeplink, setDeeplink]     = useState<string | null>(null)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/check-connection', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as Partial<TelegramConnection>
      setConnection({ connected: data.connected === true, botUrl: typeof data.botUrl === 'string' ? data.botUrl : null })
    } catch {
      // Left as it was: a failed check is not a disconnection.
    }
  }, [])

  useEffect(() => { void check() }, [check])

  // Once the link is out, keep looking until the chat is there.
  const waiting = deeplink !== null && connection?.connected !== true
  useEffect(() => {
    if (!waiting) return
    const interval = setInterval(() => { void check(); onPoll?.() }, POLL_MS)
    return () => clearInterval(interval)
  }, [waiting, check, onPoll])

  const connect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res  = await fetch('/api/telegram/generate-token', { method: 'POST' })
      if (res.status === 401) { window.location.href = '/signin'; return }
      const data = await res.json() as { deeplink?: string; error?: string }
      if (data.deeplink) setDeeplink(data.deeplink)
      else setError('Could not create a link. Try again.')
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [])

  return { connection, deeplink, waiting, busy, error, connect }
}

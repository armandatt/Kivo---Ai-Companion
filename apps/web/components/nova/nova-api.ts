// The web app's calls to Nova. Contracts live in
// packages/api/src/nova/product/today.types.ts.

import type {
  NovaMessageResponse,
  NovaSessionCommand,
  NovaSessionResponse,
} from '@repo/api/nova/product/today.types'

const FAILED = 'Could not reach Nova. Check your connection and try again.'

export async function sendSessionCommand(command: NovaSessionCommand): Promise<NovaSessionResponse> {
  try {
    const res = await fetch('/api/nova/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(command),
    })
    return await res.json() as NovaSessionResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

export async function fetchSession(): Promise<NovaSessionResponse> {
  try {
    const res = await fetch('/api/nova/session', { cache: 'no-store' })
    return await res.json() as NovaSessionResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

export async function sendNovaMessage(text: string): Promise<NovaMessageResponse> {
  try {
    const res = await fetch('/api/nova/message', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    })
    return await res.json() as NovaMessageResponse
  } catch {
    return { ok: false, error: 'failed', message: FAILED }
  }
}

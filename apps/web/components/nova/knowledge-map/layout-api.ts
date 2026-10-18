// The web app's calls for where the learner put their map's cards.
// Contract: packages/api/src/nova/product/map-layout.types.ts.

import type {
  MapLayoutResetResponse, MapLayoutSaveResponse, MapLayoutView, MapPosition,
} from '@repo/api/nova/product/map-layout.types'

const PATH = '/api/nova/knowledge-map/layout'
const OFFLINE = 'Could not reach the server. Check your connection and try again.'

async function call<T extends { ok: boolean }>(init: RequestInit, fallback: string): Promise<T | { ok: false; error: 'failed'; message: string }> {
  try {
    const res = await fetch(PATH, { cache: 'no-store', ...init })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'failed', message: fallback } }
    const json = await res.json().catch(() => null) as T | null
    if (json && typeof json === 'object' && 'ok' in json) return json
    return { ok: false, error: 'failed', message: fallback }
  } catch {
    return { ok: false, error: 'failed', message: OFFLINE }
  }
}

export const fetchLayout = () => call<MapLayoutView>({ method: 'GET' }, "Couldn't load where your cards are.")

// keepalive: a save made as the page closes still reaches the server.
export const saveLayout = (positions: MapPosition[], keepalive = false) => call<MapLayoutSaveResponse>({
  method: 'PUT', keepalive, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ positions }),
}, "Your layout didn't save.")

export const resetLayout = () => call<MapLayoutResetResponse>({ method: 'DELETE' }, "The layout wasn't reset.")

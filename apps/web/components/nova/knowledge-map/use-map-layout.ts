'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLayout, resetLayout, saveLayout } from './layout-api'
import { LayoutSaver, type SaverState } from './layout-saver'

export type Positions = ReadonlyMap<string, { x: number; y: number }>

// Where the learner put their cards: loaded once, changed by moving a card,
// saved in batches, and removed by Reset. When the saved layout cannot be
// loaded, the map still draws its own layout and says so; cards moved
// meanwhile are still saved, and a later load does not move them back.
export function useMapLayout() {
  const [positions, setPositions] = useState<Positions>(new Map())
  const [load, setLoad]           = useState<'loading' | 'ready' | 'failed'>('loading')
  const [saver, setSaverState]    = useState<SaverState>({ status: 'saved', unsaved: 0, message: null })
  const [reset, setReset]         = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  // Cards moved in this visit: a late load never puts them back.
  const movedHere = useRef(new Set<string>())
  // Bumped when the positions change by a load or a reset (not by a move),
  // so the map can fit itself to them once.
  const [generation, setGeneration] = useState(0)

  const positionsRef = useRef<Positions>(positions)
  positionsRef.current = positions

  const saverRef = useRef<LayoutSaver | null>(null)
  if (saverRef.current === null) {
    saverRef.current = new LayoutSaver(async positions => {
      const out = await saveLayout(positions)
      return out.ok ? { ok: true } : { ok: false, message: out.message }
    }, setSaverState)
  }

  const loadPositions = useCallback(async () => {
    setLoad('loading')
    const out = await fetchLayout()
    if (!out.ok) { setLoad('failed'); return }
    setPositions(current => {
      const next = new Map(out.positions.map(p => [p.node, { x: p.x, y: p.y }]))
      for (const id of movedHere.current) { const p = current.get(id); if (p) next.set(id, p) }
      return next
    })
    setLoad('ready')
    setGeneration(g => g + 1)
  }, [])

  useEffect(() => { void loadPositions() }, [loadPositions])

  // Leaving the page sends what is still queued. As the tab closes, with
  // keepalive so the request outlives it.
  useEffect(() => {
    const s = saverRef.current!
    const onHide = () => { const left = s.pending(); if (left.length > 0) void saveLayout(left, true) }
    window.addEventListener('pagehide', onHide)
    return () => { window.removeEventListener('pagehide', onHide); void s.flush() }
  }, [])

  const move = useCallback((node: string, x: number, y: number) => {
    movedHere.current.add(node)
    setPositions(current => new Map(current).set(node, { x, y }))
    saverRef.current!.queue(node, x, y)
  }, [])

  const retrySave = useCallback(() => { void saverRef.current!.retry() }, [])

  // Removes the saved positions only. Until the server says it has, the
  // cards stay where they are.
  const resetPositions = useCallback(async () => {
    setReset({ busy: true, error: null })
    await saverRef.current!.discard()
    const out = await resetLayout()
    if (!out.ok) {
      // Nothing was removed: what was moved here is queued again, so the
      // failed reset loses no move that had not been saved yet.
      for (const id of movedHere.current) { const p = positionsRef.current.get(id); if (p) saverRef.current!.queue(id, p.x, p.y) }
      setReset({ busy: false, error: out.message })
      return false
    }
    movedHere.current.clear()
    setPositions(new Map())
    setReset({ busy: false, error: null })
    setGeneration(g => g + 1)
    return true
  }, [])

  return { positions, load, retryLoad: loadPositions, saver, retrySave, move, reset, resetPositions, generation }
}

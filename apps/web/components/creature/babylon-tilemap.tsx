'use client'

import { useEffect, useRef } from 'react'
import { BabylonVoxelEngine } from '@/lib/creature/babylon-voxel-engine'
import { BiomeType } from '@/lib/creature/game-state'
import type { PlaceId } from '@/lib/creature/places'

export interface EngineApi {
  startIntroReveal: () => void
  setTime: (hour: number) => void
  // Send the creature to a place; where it is and which way the camera faces.
  goTo: (place: PlaceId, walkText?: string) => void
  getPosition: () => { x: number; z: number }
  getCameraYaw: () => number
}

interface Props {
  userSeed: string
  unlockedBiomes: BiomeType[]
  worldHealth: number
  playerX: number
  playerY: number
  currentTime: number
  cameraYaw?: number
  onEngineReady?: (api: EngineApi) => void
  onActivityChange?: (text: string) => void
  // The places the creature may go on its own, and where it has arrived.
  allowedPlaces?: PlaceId[]
  onPlaceChange?: (place: PlaceId) => void
}

export function BabylonTilemap({
  userSeed, unlockedBiomes, worldHealth, currentTime,
  cameraYaw = 0, onEngineReady, onActivityChange, allowedPlaces, onPlaceChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<BabylonVoxelEngine | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    let cancelled = false; let raf: number

    const init = () => {
      if (cancelled) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) { raf = requestAnimationFrame(init); return }
      try {
        const engine = new BabylonVoxelEngine(canvas, userSeed, unlockedBiomes, worldHealth)
        engineRef.current = engine
        if (allowedPlaces) engine.setAllowedPlaces(allowedPlaces)
        if (onPlaceChange) engine.onPlaceChange = onPlaceChange

        if (onActivityChange) {
          engine.onActivityChange = onActivityChange
          // Surface initial activity
          onActivityChange(engine.getActivity())
        }
        if (onEngineReady) {
          onEngineReady({
            startIntroReveal: () => engine.startIntroReveal(),
            setTime: (h: number) => engine.setTime(h),
            goTo: (place, walkText) => engine.goTo(place, walkText),
            getPosition: () => engine.getPosition(),
            getCameraYaw: () => engine.getCameraYaw(),
          })
        }
      } catch (e) { console.error('[creature]', e) }
    }
    raf = requestAnimationFrame(init)
    return () => {
      cancelled = true; cancelAnimationFrame(raf)
      engineRef.current?.dispose(); engineRef.current = null
    }
  }, [userSeed, worldHealth])

  useEffect(() => { engineRef.current?.updateTime(currentTime) }, [currentTime])
  useEffect(() => { engineRef.current?.updateCameraYaw(cameraYaw) }, [cameraYaw])
  useEffect(() => { engineRef.current?.updateWorldHealth(worldHealth) }, [worldHealth])
  useEffect(() => { if (allowedPlaces) engineRef.current?.setAllowedPlaces(allowedPlaces) }, [allowedPlaces])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

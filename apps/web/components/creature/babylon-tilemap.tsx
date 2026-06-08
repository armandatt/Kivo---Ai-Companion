'use client'

import { useEffect, useRef } from 'react'
import { BabylonVoxelEngine } from '@/lib/creature/babylon-voxel-engine'
import { BiomeType } from '@/lib/creature/game-state'

interface Props {
  userSeed: string
  unlockedBiomes: BiomeType[]
  worldHealth: number
  playerX: number
  playerY: number
  currentTime: number
  cameraYaw?: number
}

export function BabylonTilemap({ userSeed, unlockedBiomes, worldHealth, currentTime, cameraYaw = 0 }: Props) {
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
        engineRef.current = new BabylonVoxelEngine(canvas, userSeed, unlockedBiomes, worldHealth)
      } catch (e) { console.error('[creature]', e) }
    }
    raf = requestAnimationFrame(init)
    return () => { cancelled = true; cancelAnimationFrame(raf); engineRef.current?.dispose(); engineRef.current = null }
  }, [userSeed, worldHealth])   // intentionally excludes unlockedBiomes

  useEffect(() => { engineRef.current?.updateTime(currentTime) }, [currentTime])
  useEffect(() => { engineRef.current?.updateCameraYaw(cameraYaw) }, [cameraYaw])
  useEffect(() => { engineRef.current?.updateWorldHealth(worldHealth) }, [worldHealth])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

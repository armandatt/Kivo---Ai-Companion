'use client'

import { useEffect, useRef } from 'react'
import { BabylonVoxelEngine } from '@/lib/creature/babylon-voxel-engine'
import { BiomeType } from '@/lib/creature/game-state'

interface BabylonTilemapProps {
  userSeed: string
  unlockedBiomes: BiomeType[]
  worldHealth: number
  playerX: number
  playerY: number
  currentTime: number
}

export function BabylonTilemap({
  userSeed,
  unlockedBiomes,
  worldHealth,
  playerX,
  playerY,
  currentTime,
}: BabylonTilemapProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const engineRef  = useRef<BabylonVoxelEngine | null>(null)

  // Init engine — wait one rAF so the canvas has real CSS dimensions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let raf: number

    const init = () => {
      if (cancelled) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        // Layout not ready yet — retry next frame
        raf = requestAnimationFrame(init)
        return
      }
      try {
        const engine = new BabylonVoxelEngine(canvas, userSeed, unlockedBiomes, worldHealth)
        engineRef.current = engine
      } catch (err) {
        console.error('[creature] engine init failed:', err)
      }
    }

    raf = requestAnimationFrame(init)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [userSeed, unlockedBiomes, worldHealth])

  // Player position
  useEffect(() => {
    engineRef.current?.updatePlayerPosition(playerX * 2, playerY * 2)
  }, [playerX, playerY])

  // Time
  useEffect(() => {
    engineRef.current?.updateTime(currentTime)
  }, [currentTime])

  // World health
  useEffect(() => {
    engineRef.current?.updateWorldHealth(worldHealth)
  }, [worldHealth])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}

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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<BabylonVoxelEngine | null>(null)

  // Initialize Babylon.js engine
  useEffect(() => {
    if (!canvasRef.current) return

    try {
      // Ensure canvas has proper dimensions
      const parent = canvasRef.current.parentElement
      if (parent) {
        canvasRef.current.width = parent.clientWidth
        canvasRef.current.height = parent.clientHeight
      }

      const engine = new BabylonVoxelEngine(
        canvasRef.current,
        userSeed,
        unlockedBiomes,
        worldHealth,
      )
      engineRef.current = engine

      // Handle window resize
      const handleResize = () => {
        if (parent && canvasRef.current) {
          canvasRef.current.width = parent.clientWidth
          canvasRef.current.height = parent.clientHeight
        }
      }
      window.addEventListener('resize', handleResize)

      return () => {
        window.removeEventListener('resize', handleResize)
        engine.dispose()
      }
    } catch (error) {
      console.error('[v0] Failed to initialize Babylon engine:', error)
    }
  }, [userSeed, unlockedBiomes, worldHealth])

  // Update player position and chunk loading
  useEffect(() => {
    if (engineRef.current) {
      const worldX = playerX * 2
      const worldZ = playerY * 2
      engineRef.current.updatePlayerPosition(worldX, worldZ)
    }
  }, [playerX, playerY])

  // Update time and lighting
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateTime(currentTime)
    }
  }, [currentTime])

  // Update world health
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateWorldHealth(worldHealth)
    }
  }, [worldHealth])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  )
}

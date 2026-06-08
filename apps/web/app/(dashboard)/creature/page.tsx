'use client'

import React, { useState, useEffect } from 'react'
import { BabylonTilemap } from '@/components/creature/babylon-tilemap'
import { GameHUD } from '@/components/creature/game-hud'
import { GameOverlay } from '@/components/creature/game-overlay'
import { BIOME_UNLOCKS, STRUCTURE_UNLOCKS, type BiomeType } from '@/lib/creature/game-state'

export default function CreaturePage() {
  // Mock data - in production, fetch from database
  const mockStreak = 47
  const mockTotalDays = 180
  const mockPlayerLevel = 12
  const mockWorldHealth = 85

  // Calculate unlocked biomes and structures
  const unlockedBiomes = (Object.entries(BIOME_UNLOCKS) as Array<[BiomeType, number]>)
    .filter(([_, days]) => mockStreak >= days)
    .map(([biome]) => biome)

  const unlockedStructures = Object.entries(STRUCTURE_UNLOCKS)
    .filter(([_, days]) => mockStreak >= days)
    .map(([structure]) => structure)

  // Game state
  const [playerX, setPlayerX] = useState(0)
  const [playerY, setPlayerY] = useState(0)
  const [currentTime, setCurrentTime] = useState(14) // Start at 2 PM

  // Simulate day/night cycle
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime((prev) => (prev + 0.05) % 24)
    }, 100)
    return () => clearInterval(timer)
  }, [])

  // Handle arrow key movement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const moveDistance = 1
      switch (e.key) {
        case 'ArrowUp':
          setPlayerY((prev) => prev - moveDistance)
          e.preventDefault()
          break
        case 'ArrowDown':
          setPlayerY((prev) => prev + moveDistance)
          e.preventDefault()
          break
        case 'ArrowLeft':
          setPlayerX((prev) => prev - moveDistance)
          e.preventDefault()
          break
        case 'ArrowRight':
          setPlayerX((prev) => prev + moveDistance)
          e.preventDefault()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* Game Canvas - 3D Babylon.js */}
      <BabylonTilemap
        userSeed={`user-${mockTotalDays}`}
        unlockedBiomes={unlockedBiomes}
        worldHealth={mockWorldHealth}
        playerX={playerX}
        playerY={playerY}
        currentTime={currentTime}
      />

      {/* Game HUD */}
      <GameHUD
        playerLevel={mockPlayerLevel}
        currentStreak={mockStreak}
        worldHealth={mockWorldHealth}
        currentTime={currentTime}
        playerX={playerX}
        playerY={playerY}
      />

      {/* Game Overlay (Quotes & Notifications) */}
      <GameOverlay
        currentStreak={mockStreak}
        totalDays={mockTotalDays}
        unlockedStructures={unlockedStructures}
      />

      {/* Instructions overlay (mobile/first-time) */}
      <div className="fixed bottom-6 right-6 z-20 bg-slate-900/80 border border-slate-700 rounded p-4 max-w-xs text-xs text-foreground/70 backdrop-blur-sm">
        <p className="font-semibold text-foreground mb-2">Use arrow keys to explore</p>
        <p>Your streak keeps the world alive. Every day, the biome grows richer.</p>
      </div>
    </div>
  )
}

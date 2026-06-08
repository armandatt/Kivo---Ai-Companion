'use client'

import React, { useState, useEffect } from 'react'
import { BabylonTilemap } from '@/components/creature/babylon-tilemap'
import { GameHUD } from '@/components/creature/game-hud'
import { GameOverlay } from '@/components/creature/game-overlay'
import { BIOME_UNLOCKS, STRUCTURE_UNLOCKS, type BiomeType } from '@/lib/creature/game-state'

export default function CreaturePage() {
  const mockStreak      = 47
  const mockTotalDays   = 180
  const mockPlayerLevel = 12
  const mockWorldHealth = 85

  const unlockedBiomes = (Object.entries(BIOME_UNLOCKS) as Array<[BiomeType, number]>)
    .filter(([_, days]) => mockStreak >= days).map(([b]) => b)
  const unlockedStructures = Object.entries(STRUCTURE_UNLOCKS)
    .filter(([_, days]) => mockStreak >= days).map(([s]) => s)

  // Camera yaw — arrow keys rotate around Kivo
  const [cameraYaw, setCameraYaw] = useState(0)
  const [currentTime, setCurrentTime] = useState(14)

  useEffect(() => {
    const tick = () => {
      const n = new Date(); setCurrentTime(n.getHours() + n.getMinutes() / 60)
    }
    tick(); const t = setInterval(tick, 60_000); return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { setCameraYaw(y => y - 0.18); e.preventDefault() }
      if (e.key === 'ArrowRight') { setCameraYaw(y => y + 0.18); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      <BabylonTilemap
        userSeed={`kivo-${mockTotalDays}`}
        unlockedBiomes={unlockedBiomes}
        worldHealth={mockWorldHealth}
        playerX={0}
        playerY={0}
        currentTime={currentTime}
        cameraYaw={cameraYaw}
      />

      <GameHUD
        playerLevel={mockPlayerLevel}
        currentStreak={mockStreak}
        worldHealth={mockWorldHealth}
        currentTime={currentTime}
        playerX={0}
        playerY={0}
      />

      <GameOverlay
        currentStreak={mockStreak}
        totalDays={mockTotalDays}
        unlockedStructures={unlockedStructures}
      />

      {/* Hint */}
      <div className="fixed bottom-5 right-5 z-20 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white/60">
        <span className="text-white/80 font-medium">← →</span> rotate camera &nbsp;·&nbsp; Kivo roams the village
      </div>
    </div>
  )
}

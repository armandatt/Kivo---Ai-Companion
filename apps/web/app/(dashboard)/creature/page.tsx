'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { BabylonTilemap } from '@/components/creature/babylon-tilemap'
import type { EngineApi } from '@/components/creature/babylon-tilemap'
import { GameHUD } from '@/components/creature/game-hud'
import { GameOverlay } from '@/components/creature/game-overlay'
import { CreatureIntro } from '@/components/creature/creature-intro'
import { AmbientOverlay } from '@/components/creature/ambient-overlay'
import { BIOME_UNLOCKS, STRUCTURE_UNLOCKS, type BiomeType } from '@/lib/creature/game-state'

const MOCK_STREAK       = 47
const MOCK_TOTAL_DAYS   = 180
const MOCK_LEVEL        = 12
const MOCK_WORLD_HEALTH = 85
const INTRO_KEY         = 'kivo_intro_v3'

function hasSeenIntro() {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(INTRO_KEY) === '1'
}
function markIntroSeen() {
  if (typeof window !== 'undefined') localStorage.setItem(INTRO_KEY, '1')
}

export default function CreaturePage() {
  const unlockedBiomes = (Object.entries(BIOME_UNLOCKS) as Array<[BiomeType, number]>)
    .filter(([, days]) => MOCK_STREAK >= days).map(([b]) => b)
  const unlockedStructures = Object.entries(STRUCTURE_UNLOCKS)
    .filter(([, days]) => MOCK_STREAK >= days).map(([s]) => s)

  const [cameraYaw, setCameraYaw]     = useState(0)
  const [currentTime, setCurrentTime] = useState(14)
  const [showIntro, setShowIntro]     = useState(false)
  const [introReady, setIntroReady]   = useState(false)
  const [hudVisible, setHudVisible]   = useState(false)
  const [activity, setActivity]       = useState('...')
  const [creatureName, setCreatureName] = useState('Kivo') // fallback until fetched

  const engineApiRef = useRef<EngineApi | null>(null)

  // Fetch creature name from the user's profile
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => { if (d.creatureName) setCreatureName(d.creatureName) })
      .catch(() => {})
  }, [])

  // Replace hardcoded "Kivo" in activity text with the user's chosen name
  const displayActivity = activity.replace(/\bKivo\b/g, creatureName)

  // Real clock for time
  useEffect(() => {
    const tick = () => { const n = new Date(); setCurrentTime(n.getHours() + n.getMinutes() / 60) }
    tick(); const t = setInterval(tick, 60_000); return () => clearInterval(t)
  }, [])

  // Arrow keys rotate camera
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { setCameraYaw(y => y - 0.18); e.preventDefault() }
      if (e.key === 'ArrowRight') { setCameraYaw(y => y + 0.18); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Check intro on mount
  useEffect(() => {
    if (!hasSeenIntro()) {
      setShowIntro(true)
    } else {
      setHudVisible(true)
    }
  }, [])

  const handleEngineReady = useCallback((api: EngineApi) => {
    engineApiRef.current = api
    setIntroReady(true)
  }, [])

  const handleReveal = useCallback(() => {
    engineApiRef.current?.startIntroReveal()
  }, [])

  const handleIntroComplete = useCallback(() => {
    markIntroSeen()
    setShowIntro(false)
    setHudVisible(true)
  }, [])

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* 3D world — always mounted so it loads during intro */}
      <BabylonTilemap
        userSeed={`kivo-${MOCK_TOTAL_DAYS}`}
        unlockedBiomes={unlockedBiomes}
        worldHealth={MOCK_WORLD_HEALTH}
        playerX={0}
        playerY={0}
        currentTime={currentTime}
        cameraYaw={cameraYaw}
        onEngineReady={handleEngineReady}
        onActivityChange={setActivity}
      />

      {/* Ambient life — birds, butterflies, fireflies, leaves */}
      <AmbientOverlay currentTime={currentTime} worldHealth={MOCK_WORLD_HEALTH} />

      {/* HUD */}
      {hudVisible && (
        <GameHUD
          playerLevel={MOCK_LEVEL}
          currentStreak={MOCK_STREAK}
          worldHealth={MOCK_WORLD_HEALTH}
          currentTime={currentTime}
          playerX={0}
          playerY={0}
        />
      )}

      {/* Milestone overlay */}
      {hudVisible && (
        <GameOverlay
          currentStreak={MOCK_STREAK}
          totalDays={MOCK_TOTAL_DAYS}
          unlockedStructures={unlockedStructures}
        />
      )}

      {/* Activity card */}
      {hudVisible && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-black/45 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-2.5 shadow-xl">
            <p className="text-xs text-white/65 tracking-wide font-light text-center">{displayActivity}</p>
          </div>
        </div>
      )}

      {/* Camera hint */}
      {hudVisible && (
        <div className="fixed bottom-5 right-5 z-20 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 text-xs text-white/50">
          <span className="text-white/70 font-medium">← →</span> rotate
        </div>
      )}

      {/* Cinematic intro */}
      {showIntro && introReady && (
        <CreatureIntro
          creatureName={creatureName}
          level={MOCK_LEVEL}
          streak={MOCK_STREAK}
          onReveal={handleReveal}
          onComplete={handleIntroComplete}
        />
      )}

      {/* Loading state while babylon initialises before intro starts */}
      {showIntro && !introReady && (
        <div className="fixed inset-0 z-99 bg-black flex items-center justify-center">
          <p style={{
            fontSize: 'clamp(4rem,13vw,10rem)', fontWeight: 900,
            color: '#bfff00', opacity: 0.3, letterSpacing: '0.35em',
            fontFamily: 'system-ui, sans-serif',
          }}>
            {creatureName.toUpperCase()}
          </p>
        </div>
      )}
    </div>
  )
}

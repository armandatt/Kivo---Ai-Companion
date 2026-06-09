'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { BabylonTilemap } from '@/components/creature/babylon-tilemap'
import type { EngineApi } from '@/components/creature/babylon-tilemap'
import { GameHUD } from '@/components/creature/game-hud'
import { GameOverlay } from '@/components/creature/game-overlay'
import { CreatureIntro } from '@/components/creature/creature-intro'
import { AmbientOverlay } from '@/components/creature/ambient-overlay'
import { BIOME_UNLOCKS, STRUCTURE_UNLOCKS, type BiomeType } from '@/lib/creature/game-state'
import { Sun, Moon } from 'lucide-react'

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
  const [creatureName, setCreatureName] = useState<string>('')
  const [timeOverride, setTimeOverride] = useState<number | null>(null)

  const engineApiRef = useRef<EngineApi | null>(null)

  // Effective time: user override takes priority over real clock
  const displayTime = timeOverride ?? currentTime
  const isNight     = displayTime > 20 || displayTime < 6

  const toggleDayNight = useCallback(() => {
    const next = isNight ? 14 : 22
    setTimeOverride(next)
    engineApiRef.current?.setTime(next)
  }, [isNight])

  // Fetch creature name — don't show intro until this resolves
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setCreatureName(d.creatureName || 'Kivo'))
      .catch(() => setCreatureName('Kivo'))
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
        currentTime={displayTime}
        cameraYaw={cameraYaw}
        onEngineReady={handleEngineReady}
        onActivityChange={setActivity}
      />

      {/* Ambient life — birds, butterflies, fireflies, leaves */}
      <AmbientOverlay currentTime={displayTime} worldHealth={MOCK_WORLD_HEALTH} />

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

      {/* Bottom-right controls */}
      {hudVisible && (
        <div className="fixed bottom-5 right-5 z-20 flex flex-col items-end gap-2">
          {/* Day / Night toggle */}
          <button
            onClick={toggleDayNight}
            className="flex items-center gap-2 bg-black/45 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 text-xs text-white/60 hover:text-white/90 hover:border-white/20 transition-all"
            title={isNight ? 'Switch to day' : 'Switch to night'}
          >
            {isNight
              ? <><Sun  className="w-3.5 h-3.5 text-amber-300" /><span>Day</span></>
              : <><Moon className="w-3.5 h-3.5 text-indigo-300" /><span>Night</span></>
            }
          </button>
          {/* Camera hint */}
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 text-xs text-white/50">
            <span className="text-white/70 font-medium">← →</span> rotate
          </div>
        </div>
      )}

      {/* Cinematic intro */}
      {showIntro && introReady && !!creatureName && (
        <CreatureIntro
          creatureName={creatureName}
          level={MOCK_LEVEL}
          streak={MOCK_STREAK}
          onReveal={handleReveal}
          onComplete={handleIntroComplete}
        />
      )}

      {/* Loading state while babylon initialises / name fetches before intro starts */}
      {showIntro && (!introReady || !creatureName) && (
        <div className="fixed inset-0 z-99 bg-black flex items-center justify-center">
          {creatureName && (
            <p style={{
              fontSize: 'clamp(2rem,5vw,4.5rem)', fontWeight: 900,
              color: '#bfff00', opacity: 0.25, letterSpacing: '0.06em',
              fontFamily: 'system-ui, sans-serif', maxWidth: '90vw', overflow: 'hidden',
            }}>
              {creatureName.toUpperCase()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

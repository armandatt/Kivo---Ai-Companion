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
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'

const MOCK_STREAK       = 47
const MOCK_TOTAL_DAYS   = 180
const MOCK_LEVEL        = 12
const MOCK_WORLD_HEALTH = 85
const INTRO_KEY         = 'kivo_intro_v3'

// The numbers the world is drawn from.
type World = { seed: string; streak: number; totalDays: number; level: number; health: number }

// Rex's world still runs on these fixed figures.
const REX_WORLD: World = {
  seed: `kivo-${MOCK_TOTAL_DAYS}`, streak: MOCK_STREAK, totalDays: MOCK_TOTAL_DAYS, level: MOCK_LEVEL, health: MOCK_WORLD_HEALTH,
}
// A Nova learner with nothing on record yet: the world as it starts.
const NEW_WORLD: World = { seed: 'nova-new', streak: 0, totalDays: 0, level: 1, health: 40 }

// A Nova learner's world comes from their own study record, worked out on
// the server. Any other account gets Rex's.
function worldFrom(view: NovaCreatureView): World {
  if (view.status === 'not_nova') return REX_WORLD
  if (view.status !== 'ready') return NEW_WORLD
  return { seed: view.seed, streak: view.streakDays, totalDays: view.activeDays, level: view.level, health: view.worldHealth }
}

function hasSeenIntro() {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(INTRO_KEY) === '1'
}
function markIntroSeen() {
  if (typeof window !== 'undefined') localStorage.setItem(INTRO_KEY, '1')
}

export default function CreaturePage() {
  // null until the server has said whose world this is. The engine is built
  // once from these numbers, so nothing mounts before they are known.
  const [world, setWorld]   = useState<World | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/nova/creature', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((view: NovaCreatureView) => setWorld(worldFrom(view)))
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

  // Whose world this is could not be read: show no numbers at all.
  if (failed) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black p-6" role="alert">
        <div className="max-w-sm text-center">
          <p className="text-base font-medium text-white/90">Couldn&apos;t load your world</p>
          <p className="mt-2 text-sm text-white/55">The server didn&apos;t answer. Nothing is lost.</p>
          <button
            type="button"
            onClick={load}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-white/15 px-5 text-sm font-medium text-white/85 transition-colors hover:bg-white/5"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
  if (!world) return <div className="h-screen w-full bg-black" aria-busy="true" />
  return <CreatureWorld world={world} />
}

function CreatureWorld({ world }: { world: World }) {
  const unlockedBiomes = (Object.entries(BIOME_UNLOCKS) as Array<[BiomeType, number]>)
    .filter(([, days]) => world.streak >= days).map(([b]) => b)
  const unlockedStructures = Object.entries(STRUCTURE_UNLOCKS)
    .filter(([, days]) => world.streak >= days).map(([s]) => s)

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
        userSeed={world.seed}
        unlockedBiomes={unlockedBiomes}
        worldHealth={world.health}
        playerX={0}
        playerY={0}
        currentTime={displayTime}
        cameraYaw={cameraYaw}
        onEngineReady={handleEngineReady}
        onActivityChange={setActivity}
      />

      {/* Ambient life — birds, butterflies, fireflies, leaves */}
      <AmbientOverlay currentTime={displayTime} worldHealth={world.health} />

      {/* HUD */}
      {hudVisible && (
        <GameHUD
          playerLevel={world.level}
          currentStreak={world.streak}
          worldHealth={world.health}
          currentTime={currentTime}
          playerX={0}
          playerY={0}
        />
      )}

      {/* Milestone overlay */}
      {hudVisible && (
        <GameOverlay
          currentStreak={world.streak}
          totalDays={world.totalDays}
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
          level={world.level}
          streak={world.streak}
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

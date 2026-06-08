'use client'

import React from 'react'
import { motion } from 'framer-motion'

interface GameHUDProps {
  playerLevel: number
  currentStreak: number
  worldHealth: number
  currentTime: number
  playerX: number
  playerY: number
}

export function GameHUD({
  playerLevel,
  currentStreak,
  worldHealth,
  currentTime,
  playerX,
  playerY,
}: GameHUDProps) {
  // Format time as HH:MM
  const hours = Math.floor(currentTime)
  const minutes = Math.round((currentTime - hours) * 60)
  const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`

  // Calculate health and hunger bars
  const healthPercent = Math.max(0, Math.min(100, (currentStreak / 60) * 100))
  const hungerPercent = worldHealth

  return (
    <>
      {/* Bottom-left HUD */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed bottom-6 left-6 z-20 space-y-4"
      >
        {/* Health Bar */}
        <div>
          <p className="text-xs text-foreground/60 mb-1">STREAK</p>
          <div className="w-40 h-5 bg-slate-900/60 border border-slate-700 rounded px-1 flex items-center gap-0.5">
            <div
              className="h-full bg-red-500 transition-all duration-300"
              style={{ width: `${healthPercent}%` }}
            />
          </div>
          <p className="text-xs text-foreground/50 mt-1">{currentStreak} days</p>
        </div>

        {/* Hunger Bar */}
        <div>
          <p className="text-xs text-foreground/60 mb-1">WORLD HEALTH</p>
          <div className="w-40 h-5 bg-slate-900/60 border border-slate-700 rounded px-1 flex items-center gap-0.5">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${hungerPercent}%` }}
            />
          </div>
          <p className="text-xs text-foreground/50 mt-1">{Math.round(hungerPercent)}%</p>
        </div>

        {/* Level */}
        <div className="pt-2 border-t border-slate-700">
          <p className="text-xs text-foreground/60">LEVEL</p>
          <p className="text-2xl font-bold text-lime-400">{playerLevel}</p>
        </div>
      </motion.div>

      {/* Top-right HUD */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed top-6 right-6 z-20 text-right space-y-3"
      >
        {/* Time */}
        <div>
          <p className="text-xs text-foreground/60 mb-1">TIME</p>
          <p className="text-2xl font-mono font-bold text-cyan-400">{timeString}</p>
        </div>

        {/* Coordinates */}
        <div className="pt-2 border-t border-slate-700">
          <p className="text-xs text-foreground/60 mb-1">POSITION</p>
          <p className="text-sm font-mono text-lime-400">
            X: {Math.round(playerX)} Y: {Math.round(playerY)}
          </p>
        </div>
      </motion.div>

      {/* Center bottom - Hotbar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20"
      >
        <div className="flex gap-1 bg-slate-900/80 border border-slate-700 p-2 rounded">
          {[...Array(9)].map((_, i) => (
            <div
              key={i}
              className={`w-8 h-8 border-2 rounded ${
                i === 0
                  ? 'bg-lime-500/20 border-lime-400'
                  : 'bg-slate-700 border-slate-600'
              }`}
            />
          ))}
        </div>
      </motion.div>

      {/* Compass/Biome indicator top-left */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed top-6 left-6 z-20"
      >
        <div className="bg-slate-900/60 border border-slate-700 rounded p-3 backdrop-blur-sm">
          <p className="text-xs text-foreground/60 mb-2">BIOME</p>
          <p className="text-sm font-semibold text-cyan-400">Forest</p>
          <p className="text-xs text-foreground/50 mt-1">↑ North</p>
        </div>
      </motion.div>
    </>
  )
}

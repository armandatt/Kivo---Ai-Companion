'use client'

import { motion } from 'framer-motion'

interface GameHUDProps {
  playerLevel: number
  currentStreak: number
  worldHealth: number
  currentTime: number
  playerX: number
  playerY: number
}

function StreakFlame({ streak }: { streak: number }) {
  const tier = streak >= 100 ? 'legendary' : streak >= 30 ? 'epic' : streak >= 7 ? 'rare' : 'common'
  const colors = {
    common   : 'from-orange-400 to-yellow-300',
    rare     : 'from-blue-400 to-cyan-300',
    epic     : 'from-purple-400 to-pink-300',
    legendary: 'from-yellow-300 to-orange-200',
  }
  return (
    <div className={`text-5xl font-black bg-linear-to-b ${colors[tier]} bg-clip-text text-transparent leading-none`}>
      {streak}
    </div>
  )
}

export function GameHUD({ playerLevel, currentStreak, worldHealth, currentTime }: GameHUDProps) {
  const worldTier  = playerLevel >= 20 ? 'Ancient' : playerLevel >= 10 ? 'Elder' : playerLevel >= 5 ? 'Growing' : 'Newborn'
  const worldColor = playerLevel >= 20 ? 'text-yellow-300' : playerLevel >= 10 ? 'text-purple-300' : playerLevel >= 5 ? 'text-cyan-300' : 'text-green-300'
  const isDay      = currentTime >= 6 && currentTime < 20

  return (
    <>
      {/* ── Top-left: Kivo identity card ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3 }}
        className="fixed top-5 left-5 z-20"
      >
        <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 space-y-1 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] animate-pulse" />
            <span className="text-white/90 text-sm font-semibold tracking-wide">Kivo</span>
          </div>
          <div className={`text-xs font-medium ${worldColor}`}>{worldTier} World · Lv {playerLevel}</div>
          <div className="w-28 h-1 rounded-full bg-white/10 mt-1">
            <div
              className="h-full rounded-full bg-linear-to-r from-emerald-400 to-cyan-400 transition-all duration-700"
              style={{ width: `${Math.min(100, (playerLevel % 10) * 10 || 100)}%` }}
            />
          </div>
        </div>
      </motion.div>

      {/* ── Top-right: Streak ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3 }}
        className="fixed top-5 right-5 z-20 text-right"
      >
        <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-3 shadow-xl">
          <div className="text-[10px] text-white/50 uppercase tracking-widest mb-1">Current Streak</div>
          <StreakFlame streak={currentStreak} />
          <div className="text-white/50 text-xs mt-1">
            {currentStreak === 1 ? 'day' : 'days'} &nbsp;·&nbsp; {isDay ? '☀️' : '🌙'}
          </div>
        </div>
      </motion.div>

      {/* ── Bottom-left: World vitality ───────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="fixed bottom-5 left-5 z-20"
      >
        <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 space-y-2 shadow-xl">
          <div className="text-[10px] text-white/50 uppercase tracking-widest">World Vitality</div>
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${worldHealth}%`,
                  background: worldHealth > 60
                    ? 'linear-gradient(to right, #34d399, #6ee7b7)'
                    : worldHealth > 30
                    ? 'linear-gradient(to right, #fbbf24, #f59e0b)'
                    : 'linear-gradient(to right, #f87171, #ef4444)',
                }}
              />
            </div>
            <span className="text-white/70 text-xs">{worldHealth}%</span>
          </div>
          <div className="text-[10px] text-white/40">Keep your streak to keep the world alive</div>
        </div>
      </motion.div>
    </>
  )
}

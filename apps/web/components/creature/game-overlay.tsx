'use client'

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface GameOverlayProps {
  currentStreak: number
  totalDays: number
  unlockedStructures: string[]
}

export function GameOverlay({
  currentStreak,
  totalDays,
  unlockedStructures,
}: GameOverlayProps) {
  const [displayQuote, setDisplayQuote] = useState<string | null>(null)

  // Show quote when major milestone is hit
  useEffect(() => {
    if (currentStreak === 7) {
      setDisplayQuote('You showed up. Every single day. That takes discipline.')
    } else if (currentStreak === 30) {
      setDisplayQuote('30 days. The world is noticing. More importantly, you are.')
    } else if (currentStreak === 60) {
      setDisplayQuote('Two months. You\'re not trying anymore. You\'re becoming.')
    } else if (currentStreak === 90) {
      setDisplayQuote('Three months of showing up. The fortress is built.')
    }

    const timer = setTimeout(() => {
      setDisplayQuote(null)
    }, 6000)

    return () => clearTimeout(timer)
  }, [currentStreak])

  return (
    <>
      {/* Center quote overlay */}
      <AnimatePresence>
        {displayQuote && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 flex items-center justify-center z-30 pointer-events-none"
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              exit={{ y: -20 }}
              className="max-w-2xl mx-4 text-center"
            >
              <p className="text-3xl md:text-4xl font-bold text-lime-400 drop-shadow-lg">
                {displayQuote}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top center - Milestone achievement */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-20 left-1/2 -translate-x-1/2 z-20 text-center"
      >
        {unlockedStructures.length > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring' }}
            className="inline-block px-4 py-2 bg-lime-500/20 border border-lime-400 rounded text-lime-400 text-sm font-semibold"
          >
            Unlocked: {unlockedStructures[unlockedStructures.length - 1]}
          </motion.div>
        )}
      </motion.div>
    </>
  )
}

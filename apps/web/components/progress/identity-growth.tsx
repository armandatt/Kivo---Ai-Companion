'use client'

import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2 } from 'lucide-react'

interface Identity {
  day1: string
  today: string
  category: string
}

const identities: Identity[] = [
  {
    category: 'Commitment',
    day1: '"I want to get strong someday"',
    today: '"I am someone who shows up every morning"',
  },
  {
    category: 'Challenge',
    day1: '"2 weeks is my limit"',
    today: '"I have 47-day streaks"',
  },
  {
    category: 'Recovery',
    day1: '"I should rest more"',
    today: '"Rest is part of my training"',
  },
  {
    category: 'Strength',
    day1: '"I\'ll never deadlift my bodyweight"',
    today: '"170kg deadlift is just the start"',
  },
  {
    category: 'Accountability',
    day1: '"Motivation comes and goes"',
    today: '"Structure is my superpower"',
  },
  {
    category: 'Identity',
    day1: '"I\'m not a gym person"',
    today: '"I am an athlete"',
  },
]

export function IdentityGrowth() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="space-y-6"
    >
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Who You&apos;ve Become</h2>
        <p className="text-foreground/60">
          The shift from belief to identity is the transformation.
        </p>
      </div>

      <div className="space-y-4">
        {identities.map((item, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + idx * 0.1 }}
            className="p-5 rounded-lg bg-gradient-to-r from-slate-900/60 to-slate-800/30 border border-slate-700/50 hover:border-lime-500/30 transition-colors"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-1">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-lime-500/20 border border-lime-500/40">
                  <CheckCircle2 className="w-4 h-4 text-lime-400" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-lime-400 mb-3">{item.category}</p>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-foreground/50 mb-1">Day 1</p>
                    <p className="text-sm text-foreground/70 italic">{item.day1}</p>
                  </div>
                  <div className="flex items-center justify-center py-2">
                    <ArrowRight className="w-4 h-4 text-lime-400/60" />
                  </div>
                  <div>
                    <p className="text-xs text-foreground/50 mb-1">Today</p>
                    <p className="text-sm font-semibold text-foreground">{item.today}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Final insight */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1 }}
        className="p-6 rounded-lg bg-gradient-to-r from-lime-500/10 to-transparent border border-lime-500/20 mt-8"
      >
        <p className="text-sm text-foreground/70 leading-relaxed">
          <span className="font-semibold text-lime-400">The Real Progress:</span> You didn&apos;t just
          get stronger. You became someone who&apos;s capable of being strong. That identity is
          permanent.
        </p>
      </motion.div>
    </motion.div>
  )
}

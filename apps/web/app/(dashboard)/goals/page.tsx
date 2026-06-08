'use client'

import { motion } from 'framer-motion'
import { GoalCard } from '@/components/goals/goal-card'

const goals = [
  {
    id: 'goal-1',
    title: '100kg Squat',
    description: 'Hit a 100kg one-rep max squat',
    progress: 92.5,
    deadline: '18 days left',
    risk: 'low' as const,
    daysLeft: 18,
    relatedMoments: ['First 30-day streak', 'Morning training success'],
    relatedBreakthroughs: ['Discovered consistent morning training', 'Hit 120kg squat PR'],
  },
  {
    id: 'goal-2',
    title: '60 Day Streak',
    description: 'Maintain consecutive training days',
    progress: 78,
    deadline: '32 days left',
    risk: 'medium' as const,
    daysLeft: 32,
    relatedMoments: ['Returned after 8-day silence', 'Current 47-day streak'],
    relatedBreakthroughs: ['Became comeback person', 'Extended streak pattern'],
  },
  {
    id: 'goal-3',
    title: 'Bodyweight +10kg',
    description: 'Gain quality mass to 95kg',
    progress: 65,
    deadline: '45 days left',
    risk: 'medium' as const,
    daysLeft: 45,
    relatedMoments: ['Volume increase Phase', 'Nutrition consistency'],
    relatedBreakthroughs: ['Improved recovery', 'Morning nutrition protocol'],
  },
  {
    id: 'goal-4',
    title: '1000lb Powerlifting Total',
    description: 'Combined Bench + Squat + Deadlift',
    progress: 58,
    deadline: '90 days left',
    risk: 'medium' as const,
    daysLeft: 90,
    relatedMoments: [
      'Strength progression phase',
      'Competition prep mindset',
    ],
    relatedBreakthroughs: ['All three lifts improving', 'Commitment to program'],
  },
]

export default function GoalsPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-foreground mb-2">Your Goals</h1>
        <p className="text-foreground/60 max-w-2xl">
          Commitments you&apos;ve made to yourself. Deadlines you&apos;ve chosen. Progress you&apos;re tracking.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-4 rounded-lg bg-slate-900/40 border border-slate-700/50"
        >
          <p className="text-xs text-foreground/60 mb-1">Active Goals</p>
          <p className="text-3xl font-bold text-lime-400">{goals.length}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-4 rounded-lg bg-slate-900/40 border border-slate-700/50"
        >
          <p className="text-xs text-foreground/60 mb-1">Average Progress</p>
          <p className="text-3xl font-bold text-cyan-400">
            {Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length)}%
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-4 rounded-lg bg-slate-900/40 border border-slate-700/50"
        >
          <p className="text-xs text-foreground/60 mb-1">Low Risk</p>
          <p className="text-3xl font-bold text-orange-400">
            {goals.filter((g) => g.risk === 'low').length} of {goals.length}
          </p>
        </motion.div>
      </div>

      {/* Goals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {goals.map((goal, idx) => (
          <GoalCard key={goal.id} {...goal} index={idx} />
        ))}
      </div>

      {/* Insight Footer */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="p-6 rounded-lg bg-gradient-to-r from-lime-500/10 to-transparent border border-lime-500/20"
      >
        <h3 className="text-lg font-semibold text-foreground mb-2">About Your Goals</h3>
        <p className="text-foreground/70 text-sm leading-relaxed">
          Your goals aren&apos;t wishes. They&apos;re commitments with deadlines and accountability. Each
          one is connected to moments in your journey—breakthroughs that prove you can achieve them.
          Trust the process.
        </p>
      </motion.div>
    </motion.div>
  )
}

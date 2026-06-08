'use client'

import { motion } from 'framer-motion'
import { CoachFlag } from '@/components/coach/coach-flag'
import { WhatRexSees } from '@/components/coach/what-rex-sees'

const currentFlags = [
  {
    id: 'flag-1',
    type: 'struggle' as const,
    title: 'Friday Dropout Pattern',
    description: 'You&apos;ve missed 3 of the last 4 Fridays.',
    insight:
      'This isn\'t motivation. This is scheduling. Your Friday energy dips because of work stress, not willpower.',
    metric: '75% miss rate',
    action: 'Adjust Friday',
  },
  {
    id: 'flag-2',
    type: 'breakthrough' as const,
    title: 'Morning Training Success',
    description: 'Your morning sessions have 95% consistency.',
    insight:
      'You find success when you move the decision earlier. Your willpower is strongest before 9am.',
    metric: '19/20 completed',
    action: 'Lean into this',
  },
  {
    id: 'flag-3',
    type: 'risk' as const,
    title: 'Recovery Signal Declining',
    description: 'Sleep quality dropped 12% this week.',
    insight:
      'You\'re not recovering from training. This precedes injury or burnout. Rest is training.',
    metric: '-12% sleep quality',
    action: 'Schedule rest day',
  },
  {
    id: 'flag-4',
    type: 'insight' as const,
    title: 'Your Commitment Style',
    description: 'You respond best to structured commitments with accountability.',
    insight:
      'You need external structure, not motivation. Give yourself rules, not reasons.',
    metric: 'Pattern detected',
  },
]

export default function CoachPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-foreground mb-2">Coach</h1>
        <p className="text-foreground/60">
          Real-time observations from Rex about your patterns and potential
        </p>
      </div>

      {/* What Rex Sees - Main insight */}
      <WhatRexSees
        mainInsight="You're stronger than you think, but weaker than you could be. Your consistency proves capability—your schedule sabotages it."
        subInsights={[
          'Your best work happens between 6am-9am',
          'Friday is your vulnerability window—not your failure',
          'You respond to structure, not motivation',
          'Recovery gaps are your next growth frontier',
        ]}
        timestamp="Updated today at 6:42 AM"
      />

      {/* Current Observations */}
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-6">
          What&apos;s Happening Right Now
        </h2>
        <div className="space-y-4">
          {currentFlags.map((flag, idx) => (
            <CoachFlag key={flag.id} flag={flag} index={idx} />
          ))}
        </div>
      </div>

      {/* Call to action */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="p-6 rounded-lg bg-foreground/5 border border-foreground/10"
      >
        <p className="text-sm text-foreground/70 mb-4">
          <span className="font-semibold text-foreground">Next action:</span>{' '}
          Shift one Friday session to Thursday morning. Your body will thank you.
        </p>
        <button className="text-sm px-4 py-2 rounded-lg bg-lime-500 text-black font-semibold hover:bg-lime-400 transition-colors">
          Update Schedule
        </button>
      </motion.div>
    </motion.div>
  )
}

'use client'

import { motion } from 'framer-motion'
import { MomentTimeline } from '@/components/journey/moment-timeline'

const journeyEvents = [
  {
    id: 'moment-1',
    type: 'struggle' as const,
    title: 'I always quit after 2 weeks',
    description:
      'Pattern of starting strong but fading by day 14. Blamed it on willpower.',
    date: 'Dec 2023',
    context:
      'This was your baseline story—the one you told yourself about why you couldn\'t change.',
  },
  {
    id: 'moment-2',
    type: 'breakthrough' as const,
    title: 'Discovered morning consistency',
    description:
      'Shifted training to 6am instead of evening. Suddenly, shows were non-negotiable.',
    date: 'Jan 2024',
    context:
      'Breakthrough came from changing the environment, not fixing willpower. The time of day mattered more than motivation.',
  },
  {
    id: 'moment-3',
    type: 'achievement' as const,
    title: 'First 30-day streak',
    description: 'Completed 30 consecutive days of training. First time.',
    date: 'Feb 2024',
    context:
      'This proved the quit pattern was circumstantial, not personality. You could sustain effort.',
  },
  {
    id: 'moment-4',
    type: 'comeback' as const,
    title: 'Returned after 8-day silence',
    description:
      'Life interrupted. You took 8 days off. Instead of restarting, you came back mid-week.',
    date: 'Mar 2024',
    context:
      'This shifted your identity. You weren\'t someone who never misses. You were someone who returns.',
  },
  {
    id: 'moment-5',
    type: 'promise' as const,
    title: 'Committed to 100kg squat',
    description:
      'Set a specific strength goal. Made it public to someone who would hold you accountable.',
    date: 'Apr 2024',
    context:
      'Promise changed everything. You needed external structure, not internal motivation.',
  },
  {
    id: 'moment-6',
    type: 'achievement' as const,
    title: 'Hit 100kg squat',
    description:
      'Achieved the goal 16 weeks after committing. Bodyweight up 4kg, strength up 35%.',
    date: 'Jul 2024',
    context:
      'You didn\'t just lift heavier. You became someone who follows through. That\'s the real achievement.',
  },
]

export default function JourneyPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-foreground mb-2">Your Journey</h1>
        <p className="text-foreground/60 max-w-2xl">
          The story of your transformation isn&apos;t written in numbers. It&apos;s
          written in moments. In breakthroughs. In comebacks. In who you&apos;re
          becoming.
        </p>
      </div>

      {/* Timeline */}
      <MomentTimeline events={journeyEvents} title="Key Moments" />

      {/* Insight footer */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="p-6 rounded-lg bg-gradient-to-r from-lime-500/10 to-transparent border border-lime-500/20 mt-12"
      >
        <h3 className="text-lg font-semibold text-foreground mb-2">
          What This Timeline Shows
        </h3>
        <p className="text-foreground/70 text-sm leading-relaxed mb-3">
          Your superpower isn&apos;t consistency. It&apos;s comebacks. Your strength
          isn&apos;t willpower. It&apos;s structure. Your growth isn&apos;t motivation.
          It&apos;s commitment.
        </p>
        <p className="text-foreground/60 text-sm italic">
          Every moment on this timeline is proof that you&apos;re not meant to be
          motivated. You&apos;re meant to be accountable.
        </p>
      </motion.div>
    </motion.div>
  )
}

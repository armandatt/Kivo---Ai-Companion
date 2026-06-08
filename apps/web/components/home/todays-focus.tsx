'use client'

import { motion } from 'framer-motion'
import { Zap, Target } from 'lucide-react'
import { Card } from '@/components/ui/card'

// Mock data
const mockFocus = {
  todaysMuscles: ['Chest', 'Triceps'],
  targetLifts: ['Bench Press', 'Incline Dumbbell Press', 'Dips'],
  targetProgression: '+5 lbs on Bench Press',
  motivation:
    'Shoulders are recovered. Push hard today—this is your moment to break through.',
}

export function TodaysFocus() {
  const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: { delay: i * 0.05 },
    }),
  }

  return (
    <Card className="border border-foreground/10 bg-gradient-to-br from-card to-card/50">
      <div className="p-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex items-center gap-3 mb-6"
        >
          <div className="p-2 rounded-lg bg-green-500/20">
            <Zap className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Today&apos;s Focus</h3>
            <p className="text-xs text-foreground/60">What Rex sees for today</p>
          </div>
        </motion.div>

        {/* Motivation */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="mb-6 p-4 rounded-lg bg-foreground/5 border border-green-500/20"
        >
          <p className="text-sm text-foreground/80 italic">
            &quot;{mockFocus.motivation}&quot;
          </p>
        </motion.div>

        {/* Muscles */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-2">
            Focus Areas
          </h4>
          <div className="flex flex-wrap gap-2">
            {mockFocus.todaysMuscles.map((muscle, i) => (
              <motion.span
                key={muscle}
                custom={i}
                variants={itemVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="px-3 py-1.5 rounded-md bg-green-500/20 text-green-200 text-xs font-medium border border-green-500/30"
              >
                {muscle}
              </motion.span>
            ))}
          </div>
        </div>

        {/* Target Lifts */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-3">
            Priority Lifts
          </h4>
          <div className="space-y-2">
            {mockFocus.targetLifts.map((lift, i) => (
              <motion.div
                key={lift}
                custom={i}
                variants={itemVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="flex items-center gap-2 p-2 rounded-md bg-foreground/5 hover:bg-foreground/10 transition-colors"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-sm text-foreground/80">{lift}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Target Progression */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="p-3 rounded-lg bg-green-500/10 border border-green-500/30"
        >
          <p className="text-xs font-semibold text-green-400 mb-1">Next Milestone</p>
          <p className="text-sm text-foreground/80">{mockFocus.targetProgression}</p>
        </motion.div>
      </div>
    </Card>
  )
}

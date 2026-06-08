'use client'

import { motion } from 'framer-motion'
import { AlertCircle, Brain, TrendingDown, Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'

// Mock patterns detected
const mockPatterns = [
  {
    id: 1,
    title: 'Friday Skip Pattern',
    description: 'You skip workouts 67% of Fridays. Why?',
    severity: 'medium' as const,
    insight: 'Work stress peaks on Fridays. Consider mobility-only sessions instead.',
  },
  {
    id: 2,
    title: 'Low Recovery Signals',
    description: 'Sleep dropped 47 min this week',
    severity: 'high' as const,
    insight: 'Your body is telling you to rest. Listen.',
  },
  {
    id: 3,
    title: 'Positive: Protein Consistency',
    description: 'You hit protein targets 82% of days',
    severity: 'low' as const,
    insight: 'This is working. Keep it up.',
  },
]

const severityConfig = {
  low: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    badge: 'bg-green-500/20 text-green-200',
    icon: Zap,
  },
  medium: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    badge: 'bg-yellow-500/20 text-yellow-200',
    icon: AlertCircle,
  },
  high: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    badge: 'bg-red-500/20 text-red-200',
    icon: TrendingDown,
  },
}

export function PatternDetector() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: {
      opacity: 1,
      x: 0,
    },
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
          <div className="p-2 rounded-lg bg-purple-500/20">
            <Brain className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Pattern Detector</h3>
            <p className="text-xs text-foreground/60">What Rex learned about you</p>
          </div>
        </motion.div>

        {/* Patterns Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="space-y-4"
        >
          {mockPatterns.map((pattern) => {
            const config = severityConfig[pattern.severity]
            const IconComponent = config.icon

            return (
              <motion.div
                key={pattern.id}
                variants={itemVariants}
                className={`p-4 rounded-lg border ${config.bg} ${config.border}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1">
                    <IconComponent className="w-4 h-4 text-foreground/60 flex-shrink-0 mt-0.5" />
                    <h4 className="font-semibold text-sm text-foreground">
                      {pattern.title}
                    </h4>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${config.badge}`}>
                    {pattern.severity === 'low'
                      ? 'Positive'
                      : pattern.severity === 'medium'
                        ? 'Watch'
                        : 'Critical'}
                  </span>
                </div>

                <p className="text-xs text-foreground/70 mb-2">{pattern.description}</p>

                <div className="flex items-start gap-2">
                  <span className="text-purple-400 font-bold text-xs mt-0.5">→</span>
                  <p className="text-xs text-foreground/60 italic">{pattern.insight}</p>
                </div>
              </motion.div>
            )
          })}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-6 p-3 rounded-lg bg-foreground/5 border border-foreground/10 text-center"
        >
          <p className="text-xs text-foreground/60">
            <span className="font-semibold text-foreground">5 patterns detected</span> in the last 30 days
          </p>
        </motion.div>
      </div>
    </Card>
  )
}

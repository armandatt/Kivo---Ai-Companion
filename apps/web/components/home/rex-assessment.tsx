'use client'

import { motion } from 'framer-motion'
import { TrendingUp, AlertCircle, Activity } from 'lucide-react'
import { Card } from '@/components/ui/card'

// Mock data - in production this comes from backend
const mockAssessment = {
  momentumScore: 78,
  consistencyScore: 85,
  recoveryScore: 62,
  riskLevel: 'medium', // low, medium, high
  topPriority: 'Recovery Improvement',
  insight:
    'You&apos;re pushing hard, but Rex noticed you need more rest. Your consistency is excellent—this next week is about quality over quantity.',
}

export function RexAssessment() {
  const scoreVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: (i: number) => ({
      opacity: 1,
      scale: 1,
      transition: {
        delay: i * 0.1,
        type: 'spring' as const,
        stiffness: 300,
        damping: 30,
      },
    }),
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'bg-green-500/20 border-green-500/30 text-green-200'
      case 'medium':
        return 'bg-yellow-500/20 border-yellow-500/30 text-yellow-200'
      case 'high':
        return 'bg-red-500/20 border-red-500/30 text-red-200'
      default:
        return 'bg-blue-500/20 border-blue-500/30 text-blue-200'
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'from-green-400 to-emerald-500'
    if (score >= 60) return 'from-yellow-400 to-orange-500'
    return 'from-red-400 to-pink-500'
  }

  const ScoreCard = ({
    label,
    score,
    index,
  }: {
    label: string
    score: number
    index: number
  }) => (
    <motion.div
      custom={index}
      variants={scoreVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      className="flex flex-col items-center"
    >
      <div className="relative w-24 h-24 mb-3">
        {/* Background Circle */}
        <motion.svg
          className="w-full h-full transform -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-card"
            opacity="0.2"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="3"
            stroke="url(#gradient)"
            strokeDasharray={`${2 * Math.PI * 45}`}
            initial={{ strokeDashoffset: 2 * Math.PI * 45 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 45 * (1 - score / 100) }}
            transition={{ duration: 1.5, delay: index * 0.1 }}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient
              id="gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
        </motion.svg>

        {/* Center Text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="text-2xl font-bold text-green-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 + index * 0.1 }}
          >
            {score}
          </motion.span>
        </div>
      </div>

      <p className="text-xs font-medium text-foreground/60 text-center">{label}</p>
    </motion.div>
  )

  return (
    <Card className="relative overflow-hidden border border-green-500/20 bg-gradient-to-br from-card to-card/50">
      {/* Glow effect */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-green-500/5 rounded-full blur-3xl -z-10" />

      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-1">
                Rex Assessment
              </h2>
              <p className="text-sm text-foreground/60">
                Generated from your last 30 days
              </p>
            </div>

            <motion.div
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${getRiskColor(
                mockAssessment.riskLevel
              )}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
            >
              {mockAssessment.riskLevel === 'low'
                ? '✓ Low Risk'
                : mockAssessment.riskLevel === 'medium'
                  ? '⚠ Medium Risk'
                  : '⚠ High Risk'}
            </motion.div>
          </div>

          {/* Insight */}
          <motion.div
            className="bg-foreground/5 border border-foreground/10 rounded-lg p-4 mb-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <p className="text-sm text-foreground/80 leading-relaxed">
              <span className="font-semibold text-green-400">
                {mockAssessment.topPriority} →{' '}
              </span>
              {mockAssessment.insight}
            </p>
          </motion.div>
        </div>

        {/* Score Grid */}
        <div className="grid grid-cols-3 gap-6 text-center">
          <ScoreCard label="Momentum" score={mockAssessment.momentumScore} index={0} />
          <ScoreCard
            label="Consistency"
            score={mockAssessment.consistencyScore}
            index={1}
          />
          <ScoreCard label="Recovery" score={mockAssessment.recoveryScore} index={2} />
        </div>
      </div>
    </Card>
  )
}

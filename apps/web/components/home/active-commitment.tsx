'use client'

import { motion } from 'framer-motion'
import { Flag, Calendar, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/card'

// Mock data
const mockCommitment = {
  goal: 'Build chest strength to 225 lb bench',
  deadline: '45 days',
  currentProgress: 75,
  riskScore: 12, // low risk
  daysRemaining: 45,
  lastUpdate: 'Today at 2:34 PM',
}

export function ActiveCommitment() {
  const progressVariants = {
    hidden: { width: 0 as number | string },
    visible: {
      width: `${mockCommitment.currentProgress}%` as number | string,
      transition: {
        duration: 1.5,
        ease: 'easeOut' as const,
        delay: 0.2,
      },
    },
  }

  const getRiskColor = (risk: number) => {
    if (risk < 20) return 'text-green-400'
    if (risk < 50) return 'text-yellow-400'
    return 'text-red-400'
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
          <div className="p-2 rounded-lg bg-blue-500/20">
            <Flag className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Active Commitment</h3>
            <p className="text-xs text-foreground/60">Your primary goal</p>
          </div>
        </motion.div>

        {/* Goal */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="mb-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20"
        >
          <p className="text-sm font-semibold text-foreground">{mockCommitment.goal}</p>
        </motion.div>

        {/* Progress Bar */}
        <div className="mb-6">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="flex items-center justify-between mb-2"
          >
            <h4 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">
              Progress to Goal
            </h4>
            <span className="text-sm font-bold text-blue-400">
              {mockCommitment.currentProgress}%
            </span>
          </motion.div>

          <div className="w-full h-2 bg-foreground/10 rounded-full overflow-hidden">
            <motion.div
              variants={progressVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full"
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="p-3 rounded-lg bg-foreground/5"
          >
            <p className="text-xs text-foreground/60 mb-1">Days Remaining</p>
            <p className="text-lg font-bold text-blue-400">
              {mockCommitment.daysRemaining}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 }}
            className="p-3 rounded-lg bg-foreground/5"
          >
            <p className="text-xs text-foreground/60 mb-1">Risk Level</p>
            <p className={`text-lg font-bold ${getRiskColor(mockCommitment.riskScore)}`}>
              {mockCommitment.riskScore}%
            </p>
          </motion.div>
        </div>

        {/* Last Update */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="text-xs text-foreground/50 text-center"
        >
          Updated {mockCommitment.lastUpdate}
        </motion.p>
      </div>
    </Card>
  )
}

'use client'

import { motion } from 'framer-motion'
import { RexAssessment } from '@/components/home/rex-assessment'
import { TodaysFocus } from '@/components/home/todays-focus'
import { ActiveCommitment } from '@/components/home/active-commitment'
import { PatternDetector } from '@/components/home/pattern-detector'
import { RexQuote } from '@/components/home/rex-quote'
import { TelegramConnect } from '@/components/home/telegram-connect'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 30,
    },
  },
}

export default function HomePage() {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="w-full"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="px-6 pt-6 pb-4">
        <h1 className="text-3xl font-bold text-foreground">
          What does Rex think right now?
        </h1>
        <p className="text-sm text-foreground/60 mt-1">
          Your personalized coaching insights
        </p>
      </motion.div>

      {/* Main Content */}
      <div className="px-6 pb-12 space-y-6">
        {/* Telegram connect — always visible, collapses when connected */}
        <motion.div variants={itemVariants}>
          <TelegramConnect />
        </motion.div>

        {/* Rex Assessment - Hero Card */}
        <motion.div variants={itemVariants}>
          <RexAssessment />
        </motion.div>

        {/* Two Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <motion.div variants={itemVariants}>
            <TodaysFocus />
          </motion.div>

          {/* Right Column */}
          <motion.div variants={itemVariants}>
            <ActiveCommitment />
          </motion.div>
        </div>

        {/* Pattern Detector */}
        <motion.div variants={itemVariants}>
          <PatternDetector />
        </motion.div>

        {/* Rex Quote Section */}
        <motion.div variants={itemVariants}>
          <RexQuote />
        </motion.div>
      </div>
    </motion.div>
  )
}

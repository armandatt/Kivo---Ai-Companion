'use client'

import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'

const quotes = [
  {
    text: 'You said you&apos;d quit when it got hard. You didn&apos;t.',
    source: 'Your commitment',
  },
  {
    text: 'The weight moved because you did.',
    source: 'Your consistency',
  },
  {
    text: 'You won&apos;t be at 225 next month. But you&apos;ll be closer.',
    source: 'Your journey',
  },
  {
    text: 'Rest is not weakness. It&apos;s strategy.',
    source: 'Your recovery patterns',
  },
  {
    text: 'You showed up 47 times. That&apos;s 47 decisions.',
    source: 'Your habits',
  },
]

// For now, use the first quote - in production, this is generated from backend
const currentQuote = quotes[0]

export function RexQuote() {
  return (
    <Card className="relative overflow-hidden border border-green-500/20 bg-gradient-to-br from-card via-card to-green-950/20">
      {/* Background effects */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.3 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="absolute top-0 right-0 w-80 h-80 bg-green-500/5 rounded-full blur-3xl"
        />
      </div>

      <div className="relative p-8 lg:p-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          {/* Quote Text */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              whileInView={{ opacity: 0.3, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-6xl font-bold text-green-400/30 mb-4"
            >
              "
            </motion.div>

            <motion.blockquote
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-2xl lg:text-3xl font-bold text-foreground leading-relaxed mb-6"
            >
              {currentQuote.text}
            </motion.blockquote>

            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="text-sm text-green-400 font-semibold"
            >
              — From {currentQuote.source}
            </motion.p>
          </motion.div>

          {/* Silhouette - Animated illustration */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative h-80 hidden lg:block"
          >
            <svg
              viewBox="0 0 200 300"
              className="w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Head */}
              <motion.circle
                cx="100"
                cy="50"
                r="25"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-green-400/50"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
              />

              {/* Shoulders */}
              <motion.line
                x1="75"
                y1="75"
                x2="125"
                y2="75"
                stroke="currentColor"
                strokeWidth="2"
                className="text-green-400/50"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
              />

              {/* Body */}
              <motion.path
                d="M 100 75 L 100 180"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                className="text-green-400/50"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
              />

              {/* Left Arm (bent, lifting motion) */}
              <motion.path
                d="M 75 90 L 45 100 L 60 130"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                className="text-green-400/50"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.35 }}
              />

              {/* Right Arm (lifting) */}
              <motion.path
                d="M 125 90 L 155 80 L 140 120"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                className="text-green-400/50"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.35 }}
              />

              {/* Left Leg */}
              <motion.line
                x1="85"
                y1="180"
                x2="80"
                y2="260"
                stroke="currentColor"
                strokeWidth="2"
                className="text-green-400/50"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
              />

              {/* Right Leg */}
              <motion.line
                x1="115"
                y1="180"
                x2="120"
                y2="260"
                stroke="currentColor"
                strokeWidth="2"
                className="text-green-400/50"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
              />

              {/* Glow around silhouette */}
              <motion.circle
                cx="100"
                cy="150"
                r="80"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="text-green-400/20"
                initial={{ r: 60, opacity: 0 }}
                whileInView={{ r: 90, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.5, delay: 0.3 }}
              />
            </svg>
          </motion.div>
        </div>
      </div>
    </Card>
  )
}

'use client'

import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Eye } from 'lucide-react'

interface WhatRexSeesProps {
  mainInsight: string
  subInsights: string[]
  timestamp?: string
}

export function WhatRexSees({
  mainInsight,
  subInsights,
  timestamp,
}: WhatRexSeesProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <Card className="relative overflow-hidden border-lime-500/30 bg-gradient-to-br from-lime-500/5 via-background to-background p-8 backdrop-blur-sm">
        {/* Animated background accent */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -top-32 -right-32 w-64 h-64 bg-lime-500/10 rounded-full blur-3xl"
            animate={{
              x: [0, 30, 0],
              y: [0, -30, 0],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>

        <div className="relative z-10">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-2 rounded-lg bg-lime-500/20 border border-lime-500/50">
              <Eye className="w-6 h-6 text-lime-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground">What Rex Sees</h2>
              {timestamp && (
                <p className="text-xs text-foreground/50 mt-1">{timestamp}</p>
              )}
            </div>
          </div>

          {/* Main insight */}
          <div className="bg-background/80 border border-lime-500/20 rounded-lg p-6 mb-6">
            <p className="text-lg text-foreground leading-relaxed font-medium">
              {mainInsight}
            </p>
          </div>

          {/* Sub-insights */}
          {subInsights.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subInsights.map((insight, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + idx * 0.1 }}
                  className="bg-lime-500/5 border border-lime-500/20 rounded-lg p-4"
                >
                  <p className="text-sm text-foreground/80">{insight}</p>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

'use client'

import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import {
  Trophy,
  Zap,
  RotateCcw,
  Handshake,
  AlertCircle,
} from 'lucide-react'

export type MomentType = 'achievement' | 'breakthrough' | 'comeback' | 'promise' | 'struggle'

interface TimelineEvent {
  id: string
  type: MomentType
  title: string
  description: string
  date: string
  context?: string
}

interface MomentTimelineProps {
  events: TimelineEvent[]
  title?: string
}

function getMomentIcon(type: MomentType) {
  const icons = {
    achievement: Trophy,
    breakthrough: Zap,
    comeback: RotateCcw,
    promise: Handshake,
    struggle: AlertCircle,
  }
  return icons[type]
}

function getMomentColor(type: MomentType) {
  const colors = {
    achievement: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    breakthrough: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    comeback: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    promise: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
    struggle: 'text-red-400 bg-red-500/10 border-red-500/30',
  }
  return colors[type]
}

function getMomentLabel(type: MomentType) {
  const labels = {
    achievement: 'Achievement',
    breakthrough: 'Breakthrough',
    comeback: 'Comeback',
    promise: 'Promise',
    struggle: 'Struggle',
  }
  return labels[type]
}

export function MomentTimeline({ events, title }: MomentTimelineProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full"
    >
      {title && (
        <h2 className="text-2xl font-bold text-foreground mb-8">{title}</h2>
      )}

      <div className="relative">
        {/* Timeline line */}
        <motion.div
          className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-lime-500/0 via-lime-500/50 to-lime-500/0"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 1.2, delay: 0.2 }}
          style={{ originY: 0 }}
        />

        {/* Timeline events */}
        <div className="space-y-12">
          {events.map((event, idx) => {
            const Icon = getMomentIcon(event.type)
            const colorClass = getMomentColor(event.type)
            const label = getMomentLabel(event.type)

            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.15, duration: 0.4 }}
                className="relative flex gap-6"
              >
                {/* Timeline dot */}
                <div className="relative pt-1">
                  <motion.div
                    className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${colorClass} bg-background`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Icon className="w-5 h-5" />
                  </motion.div>
                </div>

                {/* Content */}
                <div className="flex-1 pt-2">
                  <Card className="border-foreground/10 bg-background/50 hover:bg-foreground/5 transition-colors p-5">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {event.title}
                        </h3>
                        <p className="text-xs text-foreground/50 mt-1">
                          {event.date}
                        </p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${colorClass}`}
                      >
                        {label}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-foreground/70 mb-3">
                      {event.description}
                    </p>

                    {/* Context */}
                    {event.context && (
                      <div className="text-xs text-foreground/50 italic border-l-2 border-foreground/20 pl-3 py-2">
                        {event.context}
                      </div>
                    )}
                  </Card>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}

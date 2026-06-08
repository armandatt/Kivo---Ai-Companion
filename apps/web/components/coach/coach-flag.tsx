'use client'

import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { AlertTriangle, TrendingUp, MessageSquare } from 'lucide-react'

interface CoachFlag {
  id: string
  type: 'struggle' | 'breakthrough' | 'risk' | 'insight'
  title: string
  description: string
  insight: string
  metric?: string
  action?: string
}

interface CoachFlagProps {
  flag: CoachFlag
  index: number
}

export function CoachFlag({ flag, index }: CoachFlagProps) {
  const typeConfig = {
    struggle: {
      icon: AlertTriangle,
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      accentColor: 'text-red-400',
    },
    breakthrough: {
      icon: TrendingUp,
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/30',
      accentColor: 'text-emerald-400',
    },
    risk: {
      icon: AlertTriangle,
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      accentColor: 'text-amber-400',
    },
    insight: {
      icon: MessageSquare,
      bgColor: 'bg-cyan-500/10',
      borderColor: 'border-cyan-500/30',
      accentColor: 'text-cyan-400',
    },
  }

  const config = typeConfig[flag.type]
  const IconComponent = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
    >
      <Card
        className={`${config.bgColor} border ${config.borderColor} p-6 backdrop-blur-sm hover:border-foreground/40 transition-all duration-300`}
      >
        <div className="flex gap-4">
          <div className={`${config.accentColor} pt-1`}>
            <IconComponent className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {flag.title}
            </h3>
            <p className="text-foreground/70 text-sm mb-3">{flag.description}</p>

            <div className="bg-background/50 rounded-lg p-3 border border-foreground/5 mb-3">
              <p className={`text-sm ${config.accentColor} font-medium italic`}>
                {flag.insight}
              </p>
            </div>

            <div className="flex items-center justify-between">
              {flag.metric && (
                <span className="text-xs text-foreground/50 font-mono">
                  {flag.metric}
                </span>
              )}
              {flag.action && (
                <button className="text-xs px-3 py-1 rounded-md bg-foreground/10 hover:bg-foreground/20 text-foreground/80 transition-colors">
                  {flag.action}
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

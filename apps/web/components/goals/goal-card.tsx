'use client'

import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, TrendingUp } from 'lucide-react'

interface GoalCardProps {
  title: string
  description: string
  progress: number
  deadline: string
  risk: 'low' | 'medium' | 'high'
  daysLeft: number
  relatedMoments: string[]
  relatedBreakthroughs: string[]
  index: number
}

export function GoalCard({
  title,
  description,
  progress,
  deadline,
  risk,
  daysLeft,
  relatedMoments,
  relatedBreakthroughs,
  index,
}: GoalCardProps) {
  const riskColor = {
    low: 'text-lime-400 border-lime-500/30 bg-lime-500/10',
    medium: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
    high: 'text-red-400 border-red-500/30 bg-red-500/10',
  }

  const riskBgColor = {
    low: 'bg-lime-500/10',
    medium: 'bg-orange-500/10',
    high: 'bg-red-500/10',
  }

  const progressColor = progress >= 90 ? 'bg-lime-500' : progress >= 70 ? 'bg-cyan-400' : 'bg-orange-400'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 * index }}
      className="rounded-lg border border-slate-700/50 bg-gradient-to-br from-slate-900/60 to-slate-800/30 p-6 hover:border-slate-600/80 transition-colors"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground mb-1">{title}</h3>
          <p className="text-sm text-foreground/60">{description}</p>
        </div>
        <div className={`px-3 py-1 rounded-lg text-xs font-semibold border ${riskColor[risk]}`}>
          {risk === 'low' ? 'Low Risk' : risk === 'medium' ? 'Medium Risk' : 'High Risk'}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground">{progress}% Complete</span>
          <span className="text-xs text-foreground/60">{daysLeft} days left</span>
        </div>
        <div className="h-3 bg-slate-800/50 rounded-full overflow-hidden border border-slate-700/50">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ delay: 0.2 + 0.1 * index, duration: 0.8 }}
            className={`h-full ${progressColor} rounded-full`}
          />
        </div>
      </div>

      {/* Deadline */}
      <div className="mb-6 p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
        <p className="text-xs text-foreground/60 mb-1">Deadline</p>
        <p className="text-sm font-semibold text-foreground">{deadline}</p>
      </div>

      {/* Related Content */}
      <div className="space-y-4">
        {relatedMoments.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <p className="text-xs font-semibold text-foreground">Related Moments</p>
            </div>
            <ul className="space-y-1">
              {relatedMoments.map((moment, idx) => (
                <li key={idx} className="text-xs text-foreground/60 flex items-start gap-2">
                  <span className="text-cyan-400/60">→</span>
                  <span>{moment}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {relatedBreakthroughs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-lime-400" />
              <p className="text-xs font-semibold text-foreground">Breakthroughs</p>
            </div>
            <ul className="space-y-1">
              {relatedBreakthroughs.map((breakthrough, idx) => (
                <li key={idx} className="text-xs text-foreground/60 flex items-start gap-2">
                  <span className="text-lime-400/60">✓</span>
                  <span>{breakthrough}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* CTA */}
      <button className="w-full mt-6 px-4 py-2 rounded-lg bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm transition-colors">
        Update Progress
      </button>
    </motion.div>
  )
}

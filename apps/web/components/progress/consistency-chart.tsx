'use client'

import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

const consistencyData = [
  { month: 'Jan', completion: 65 },
  { month: 'Feb', completion: 72 },
  { month: 'Mar', completion: 58 },
  { month: 'Apr', completion: 85 },
  { month: 'May', completion: 88 },
  { month: 'Jun', completion: 92 },
]

export function ConsistencyChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-slate-900/40 border border-slate-700/50 rounded-lg p-6"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Consistency Improvement
        </h3>
        <p className="text-sm text-foreground/60">
          Monthly workout completion rate
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={consistencyData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
          <XAxis dataKey="month" stroke="rgba(148, 163, 184, 0.6)" style={{ fontSize: 12 }} />
          <YAxis stroke="rgba(148, 163, 184, 0.6)" style={{ fontSize: 12 }} domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '8px',
            }}
            labelStyle={{ color: 'rgba(148, 163, 184, 0.8)' }}
            formatter={(value) => `${value}%`}
          />
          <Bar dataKey="completion" radius={[8, 8, 0, 0]}>
            {consistencyData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.completion >= 85 ? '#a3e635' : '#06b6d4'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Streak Info */}
      <div className="grid grid-cols-3 gap-4 mt-8">
        <div className="p-4 rounded-lg bg-lime-500/10 border border-lime-500/30">
          <p className="text-xs text-foreground/60 mb-2">Current Streak</p>
          <p className="text-2xl font-bold text-lime-400">47 days</p>
          <p className="text-xs text-lime-400/70 mt-1">→ 67 in 20 days</p>
        </div>
        <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
          <p className="text-xs text-foreground/60 mb-2">Best Streak</p>
          <p className="text-2xl font-bold text-cyan-400">47 days</p>
          <p className="text-xs text-cyan-400/70 mt-1">Current season</p>
        </div>
        <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <p className="text-xs text-foreground/60 mb-2">This Month</p>
          <p className="text-2xl font-bold text-orange-400">92%</p>
          <p className="text-xs text-orange-400/70 mt-1">25/27 sessions</p>
        </div>
      </div>
    </motion.div>
  )
}

'use client'

import { motion } from 'framer-motion'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const volumeData = [
  { week: 'Week 1', sessions: 3, sets: 36, tonnage: 2400 },
  { week: 'Week 5', sessions: 4, sets: 48, tonnage: 3200 },
  { week: 'Week 10', sessions: 4, sets: 56, tonnage: 4100 },
  { week: 'Week 15', sessions: 5, sets: 70, tonnage: 5400 },
  { week: 'Week 20', sessions: 5, sets: 75, tonnage: 6200 },
  { week: 'Week 25', sessions: 5, sets: 80, tonnage: 7100 },
]

export function VolumeChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-slate-900/40 border border-slate-700/50 rounded-lg p-6"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Training Volume
        </h3>
        <p className="text-sm text-foreground/60">
          Weekly tonnage progression shows increasing capacity
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={volumeData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="colorTonnage" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a3e635" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#a3e635" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
          <XAxis dataKey="week" stroke="rgba(148, 163, 184, 0.6)" style={{ fontSize: 12 }} />
          <YAxis stroke="rgba(148, 163, 184, 0.6)" style={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '8px',
            }}
            labelStyle={{ color: 'rgba(148, 163, 184, 0.8)' }}
            formatter={(value: number) => {
              if (value > 1000) return `${(value / 1000).toFixed(1)}k kg`
              return `${value} kg`
            }}
          />
          <Area
            type="monotone"
            dataKey="tonnage"
            stroke="#a3e635"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorTonnage)"
            name="Tonnage (kg)"
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Volume Stats */}
      <div className="grid grid-cols-3 gap-4 mt-8">
        <div className="p-4 rounded-lg bg-slate-800/30 border border-lime-500/20">
          <p className="text-xs text-foreground/60 mb-2">Sessions/Week</p>
          <p className="text-2xl font-bold text-lime-400">5</p>
          <p className="text-xs text-lime-400/70 mt-1">+67% from start</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/30 border border-cyan-500/20">
          <p className="text-xs text-foreground/60 mb-2">Sets/Week</p>
          <p className="text-2xl font-bold text-cyan-400">80</p>
          <p className="text-xs text-cyan-400/70 mt-1">+122% from start</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/30 border border-orange-500/20">
          <p className="text-xs text-foreground/60 mb-2">Weekly Tonnage</p>
          <p className="text-2xl font-bold text-orange-400">7.1k</p>
          <p className="text-xs text-orange-400/70 mt-1">+196% from start</p>
        </div>
      </div>
    </motion.div>
  )
}

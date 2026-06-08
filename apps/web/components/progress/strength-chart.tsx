'use client'

import { motion } from 'framer-motion'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Bar,
} from 'recharts'

const strengthData = [
  { week: 'Week 1', bench: 60, squat: 80, deadlift: 100, ohp: 40 },
  { week: 'Week 5', bench: 65, squat: 90, deadlift: 115, ohp: 45 },
  { week: 'Week 10', bench: 72, squat: 100, deadlift: 130, ohp: 50 },
  { week: 'Week 15', bench: 78, squat: 110, deadlift: 145, ohp: 55 },
  { week: 'Week 20', bench: 82, squat: 120, deadlift: 160, ohp: 58 },
  { week: 'Week 25', bench: 85, squat: 125, deadlift: 170, ohp: 60 },
]

export function StrengthChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-slate-900/40 border border-slate-700/50 rounded-lg p-6"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Strength Progression
        </h3>
        <p className="text-sm text-foreground/60">
          Your one-rep max improvement over time
        </p>
      </div>

      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={strengthData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
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
          />
          <Legend wrapperStyle={{ color: 'rgba(148, 163, 184, 0.8)' }} />
          <Line
            type="monotone"
            dataKey="bench"
            stroke="#a3e635"
            strokeWidth={2}
            dot={{ fill: '#a3e635', r: 4 }}
            activeDot={{ r: 6 }}
            name="Bench (kg)"
          />
          <Line
            type="monotone"
            dataKey="squat"
            stroke="#06b6d4"
            strokeWidth={2}
            dot={{ fill: '#06b6d4', r: 4 }}
            activeDot={{ r: 6 }}
            name="Squat (kg)"
          />
          <Line
            type="monotone"
            dataKey="deadlift"
            stroke="#f97316"
            strokeWidth={2}
            dot={{ fill: '#f97316', r: 4 }}
            activeDot={{ r: 6 }}
            name="Deadlift (kg)"
          />
          <Line
            type="monotone"
            dataKey="ohp"
            stroke="#ec4899"
            strokeWidth={2}
            dot={{ fill: '#ec4899', r: 4 }}
            activeDot={{ r: 6 }}
            name="OHP (kg)"
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Gains Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
        <div className="p-4 rounded-lg bg-slate-800/30 border border-lime-500/20">
          <p className="text-xs text-foreground/60 mb-1">Bench</p>
          <p className="text-lg font-bold text-lime-400">60kg → 85kg</p>
          <p className="text-xs text-lime-400/70">+25kg (+42%)</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/30 border border-cyan-500/20">
          <p className="text-xs text-foreground/60 mb-1">Squat</p>
          <p className="text-lg font-bold text-cyan-400">80kg → 125kg</p>
          <p className="text-xs text-cyan-400/70">+45kg (+56%)</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/30 border border-orange-500/20">
          <p className="text-xs text-foreground/60 mb-1">Deadlift</p>
          <p className="text-lg font-bold text-orange-400">100kg → 170kg</p>
          <p className="text-xs text-orange-400/70">+70kg (+70%)</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/30 border border-pink-500/20">
          <p className="text-xs text-foreground/60 mb-1">OHP</p>
          <p className="text-lg font-bold text-pink-400">40kg → 60kg</p>
          <p className="text-xs text-pink-400/70">+20kg (+50%)</p>
        </div>
      </div>
    </motion.div>
  )
}

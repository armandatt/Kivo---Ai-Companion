'use client'

import { motion } from 'framer-motion'
import { StrengthChart } from '@/components/progress/strength-chart'
import { ConsistencyChart } from '@/components/progress/consistency-chart'
import { VolumeChart } from '@/components/progress/volume-chart'
import { IdentityGrowth } from '@/components/progress/identity-growth'

export default function ProgressPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-foreground mb-2">Your Transformation</h1>
        <p className="text-foreground/60 max-w-2xl">
          Charts show the metrics. But identity transformation is the real progress.
        </p>
      </div>

      {/* Strength Growth */}
      <section>
        <h2 className="text-2xl font-bold text-foreground mb-6">Strength Growth</h2>
        <StrengthChart />
      </section>

      {/* Consistency */}
      <section>
        <h2 className="text-2xl font-bold text-foreground mb-6">Consistency</h2>
        <ConsistencyChart />
      </section>

      {/* Volume */}
      <section>
        <h2 className="text-2xl font-bold text-foreground mb-6">Training Volume</h2>
        <VolumeChart />
      </section>

      {/* Identity Growth */}
      <section>
        <IdentityGrowth />
      </section>
    </motion.div>
  )
}

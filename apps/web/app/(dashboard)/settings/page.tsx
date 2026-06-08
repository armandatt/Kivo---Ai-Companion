'use client'

import { motion } from 'framer-motion'

export default function SettingsPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6"
    >
      <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
      <p className="text-foreground/60">Configure Rex and your preferences</p>
      {/* Components will go here */}
    </motion.div>
  )
}

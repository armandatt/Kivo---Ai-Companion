'use client'

// The hero's sparkles, as the original hero drew them, and none for a
// visitor who asked for reduced motion.

import { useReducedMotion } from 'framer-motion'
import { SparklesCore } from '@/components/ui/sparkles'

export function HeroSparkles() {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <SparklesCore id="hero-sparkles" background="transparent" particleColor="#00E5A0" particleDensity={30} minSize={0.3} maxSize={1.2} speed={1}
      className="pointer-events-none absolute inset-0 h-full w-full" />
  )
}

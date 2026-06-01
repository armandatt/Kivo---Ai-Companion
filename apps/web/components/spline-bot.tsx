'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false })

function Loader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="w-7 h-7 rounded-full border-2 animate-spin"
        style={{ borderColor: 'rgba(0,229,160,0.15)', borderTopColor: '#00E5A0' }}
      />
    </div>
  )
}

export function SplineBot({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative ${className}`}
      style={{
        width: '100%',
        height: '100%',
        WebkitMaskImage: `radial-gradient(
          ellipse 90% 85% at 50% 44%,
          black 28%,
          rgba(0,0,0,0.92) 48%,
          rgba(0,0,0,0.35) 66%,
          transparent 80%
        )`,
        maskImage: `radial-gradient(
          ellipse 90% 85% at 50% 44%,
          black 28%,
          rgba(0,0,0,0.92) 48%,
          rgba(0,0,0,0.35) 66%,
          transparent 80%
        )`,
      }}
    >
      <Suspense fallback={<Loader />}>
        <Spline
          scene="https://prod.spline.design/ll0kRxoRtVCNpOQO/scene.splinecode"
          style={{ width: '100%', height: '100%', background: 'transparent' }}
        />
      </Suspense>

      {/* Hard watermark kill — gradient from background colour over the bottom-right corner */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `
            linear-gradient(to top,  #060810 0%, #060810 12%, transparent 32%),
            linear-gradient(to left, #060810 0%, #060810 8%,  transparent 28%)
          `,
        }}
      />
    </div>
  )
}

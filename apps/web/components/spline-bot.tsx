'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false })

function RobotPlaceholder() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg
        viewBox="0 0 200 280"
        width="260"
        height="340"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: 0.18 }}
      >
        {/* Head */}
        <rect x="65" y="20" width="70" height="60" rx="14" stroke="#00E5A0" strokeWidth="2.5" />
        {/* Eyes */}
        <rect x="82" y="38" width="14" height="10" rx="3" fill="#00E5A0" opacity="0.7" />
        <rect x="104" y="38" width="14" height="10" rx="3" fill="#00E5A0" opacity="0.7" />
        {/* Neck */}
        <rect x="90" y="80" width="20" height="14" rx="4" stroke="#00E5A0" strokeWidth="2" />
        {/* Body */}
        <rect x="50" y="94" width="100" height="90" rx="16" stroke="#00E5A0" strokeWidth="2.5" />
        {/* Chest panel */}
        <rect x="72" y="112" width="56" height="36" rx="8" stroke="#00E5A0" strokeWidth="1.5" opacity="0.5" />
        <circle cx="100" cy="130" r="8" stroke="#00E5A0" strokeWidth="1.5" opacity="0.5" />
        {/* Left arm */}
        <rect x="18" y="98" width="28" height="72" rx="12" stroke="#00E5A0" strokeWidth="2" />
        {/* Right arm */}
        <rect x="154" y="98" width="28" height="72" rx="12" stroke="#00E5A0" strokeWidth="2" />
        {/* Left leg */}
        <rect x="60" y="186" width="32" height="74" rx="12" stroke="#00E5A0" strokeWidth="2" />
        {/* Right leg */}
        <rect x="108" y="186" width="32" height="74" rx="12" stroke="#00E5A0" strokeWidth="2" />
      </svg>
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
      <Suspense fallback={<RobotPlaceholder />}>
        <Spline
          scene="https://prod.spline.design/ll0kRxoRtVCNpOQO/scene.splinecode"
          style={{ width: '100%', height: '100%', background: 'transparent' }}
        />
      </Suspense>

      {/* Hard watermark kill */}
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

'use client'

import { useEffect, useState } from 'react'

export default function WelcomeSplash({ name }: { name: string | null }) {
  const [phase, setPhase] = useState<'hidden' | 'in' | 'hold' | 'out'>('hidden')

  useEffect(() => {
    if (sessionStorage.getItem('kevo_welcomed')) return
    sessionStorage.setItem('kevo_welcomed', '1')

    setPhase('in')
    const t1 = setTimeout(() => setPhase('hold'), 600)
    const t2 = setTimeout(() => setPhase('out'), 2800)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (phase === 'hidden') return null

  const opacity = phase === 'in' ? 0 : phase === 'out' ? 0 : 1
  const scale   = phase === 'in' ? 0.94 : phase === 'out' ? 1.04 : 1
  const dur     = phase === 'in' ? '0.6s' : '0.5s'

  const displayName = name?.split(' ')[0] ?? 'back'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(8, 10, 18, 0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        opacity, transition: `opacity ${dur} ease, transform ${dur} ease`,
        pointerEvents: phase === 'out' ? 'none' : 'auto',
      }}
    >
      <div style={{ textAlign: 'center', transform: `scale(${scale})`, transition: `transform ${dur} ease` }}>
        {/* Glow ring */}
        <div style={{
          position: 'absolute', inset: '-60px',
          background: 'radial-gradient(ellipse 60% 55% at 50% 50%, rgba(0,229,160,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <p style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '4px',
          textTransform: 'uppercase', color: '#00E5A0',
          margin: '0 0 14px', opacity: 0.7,
        }}>
          Welcome to
        </p>

        <h1 style={{
          fontSize: 'clamp(2.4rem, 6vw, 3.6rem)',
          fontWeight: 900, margin: 0, lineHeight: 1.05,
          background: 'linear-gradient(135deg, #e8eaf0 30%, #00E5A0 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          filter: 'drop-shadow(0 0 24px rgba(0,229,160,0.35))',
        }}>
          Kivo
        </h1>

        <p style={{
          marginTop: '16px', fontSize: '15px',
          color: 'rgba(255,255,255,0.45)', fontWeight: 400,
        }}>
          Good to see you, {displayName}
        </p>

        {/* Bottom pulse line */}
        <div style={{
          margin: '22px auto 0',
          width: '40px', height: '2px',
          background: 'linear-gradient(90deg, transparent, #00E5A0, transparent)',
          borderRadius: '2px',
          animation: 'splashPulse 1.2s ease-in-out infinite',
        }} />
      </div>

      <style>{`
        @keyframes splashPulse {
          0%, 100% { opacity: 0.4; transform: scaleX(0.6); }
          50%       { opacity: 1;   transform: scaleX(1.4); }
        }
      `}</style>
    </div>
  )
}

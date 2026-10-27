'use client'

import { useEffect, useRef, useState } from 'react'

interface AmbientOverlayProps {
  currentTime: number
  worldHealth: number
}

interface Particle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  type: 'bird' | 'butterfly' | 'firefly' | 'leaf'
  phase: number
}

let _nextId = 0
const mkId = () => _nextId++

function makeBird(): Particle {
  return { id: mkId(), x: -4, y: 8 + Math.random() * 28, vx: 0.14 + Math.random() * 0.18, vy: (Math.random() - 0.5) * 0.03, size: 7 + Math.random() * 5, opacity: 0.45 + Math.random() * 0.35, type: 'bird', phase: Math.random() * Math.PI * 2 }
}
function makeButterfly(): Particle {
  return { id: mkId(), x: 10 + Math.random() * 80, y: 30 + Math.random() * 40, vx: (Math.random() - 0.5) * 0.07, vy: (Math.random() - 0.5) * 0.07, size: 9 + Math.random() * 6, opacity: 0.55 + Math.random() * 0.3, type: 'butterfly', phase: Math.random() * Math.PI * 2 }
}
function makeFirefly(): Particle {
  return { id: mkId(), x: 5 + Math.random() * 90, y: 40 + Math.random() * 50, vx: (Math.random() - 0.5) * 0.04, vy: (Math.random() - 0.5) * 0.04, size: 3 + Math.random() * 3, opacity: 0, type: 'firefly', phase: Math.random() * Math.PI * 2 }
}
function makeLeaf(): Particle {
  return { id: mkId(), x: 5 + Math.random() * 90, y: -3, vx: (Math.random() - 0.5) * 0.05, vy: 0.05 + Math.random() * 0.06, size: 5 + Math.random() * 5, opacity: 0.35 + Math.random() * 0.3, type: 'leaf', phase: Math.random() * Math.PI * 2 }
}

export function AmbientOverlay({ currentTime, worldHealth }: AmbientOverlayProps) {
  const [particles, setParticles] = useState<Particle[]>([])
  const frameRef = useRef<number>(undefined)
  const tickRef  = useRef(0)

  // Someone who asked their device for less motion gets a still sky: no
  // drifting particles and no meteors. The world itself is unchanged.
  const [still, setStill] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setStill(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  // A meteor now and then on a clear night. One timer, set again after each
  // fall; nothing is asked of the server, and none falls while the page is
  // hidden or the sky is still.
  const [meteor, setMeteor] = useState<{ id: number; x: number; y: number } | null>(null)

  const isNight = currentTime > 20 || currentTime < 6
  const isDusk  = (currentTime >= 18 && currentTime <= 21) || (currentTime >= 5 && currentTime <= 7)
  const isDay   = !isNight

  // Seed initial particles
  useEffect(() => {
    const init: Particle[] = []
    for (let i = 0; i < 4; i++) init.push(makeBird())
    for (let i = 0; i < 4; i++) init.push(makeButterfly())
    setParticles(init)
  }, [])

  useEffect(() => {
    if (!isNight || still) { setMeteor(null); return }
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        if (!document.hidden) setMeteor({ id: Date.now(), x: 12 + Math.random() * 60, y: 4 + Math.random() * 22 })
        schedule()
      }, 45_000 + Math.random() * 105_000)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [isNight, still])

  // Animation loop
  useEffect(() => {
    if (still) { setParticles([]); return }
    const animate = () => {
      // A hidden page draws nothing, so nothing is worked out for it.
      if (document.hidden) { frameRef.current = requestAnimationFrame(animate); return }
      tickRef.current++
      const tick = tickRef.current

      setParticles(prev => {
        let next = prev.map(p => {
          let { x, y, vx, vy, opacity, phase } = p
          phase += 0.018

          if (p.type === 'bird') {
            x += vx
            y += vy + Math.sin(phase * 4) * 0.055
            if (x > 106) return null
          } else if (p.type === 'butterfly') {
            x += vx + Math.sin(phase * 2.1) * 0.07
            y += vy + Math.cos(phase * 1.8) * 0.07
            if (x < -2 || x > 102 || y < 3 || y > 97) return { ...makeButterfly(), id: p.id }
          } else if (p.type === 'firefly') {
            x += vx + Math.sin(phase * 1.6) * 0.055
            y += vy + Math.cos(phase * 2.1) * 0.055
            opacity = isNight ? Math.max(0, Math.sin(phase * 3.2) * 0.85) : Math.max(0, opacity - 0.02)
            if (x < -2 || x > 102 || y < 15 || y > 99) return { ...makeFirefly(), id: p.id }
          } else if (p.type === 'leaf') {
            x += vx + Math.sin(phase * 2) * 0.045
            y += vy
            opacity = 0.25 + Math.sin(phase * 1.5) * 0.18
            if (y > 106) return null
          }

          return { ...p, x, y, vx, vy, opacity, phase }
        }).filter(Boolean) as Particle[]

        // Spawn schedule
        if (tick % 190 === 0 && isDay) next.push(makeBird())
        if (tick % 250 === 0 && worldHealth > 50) next.push(makeLeaf())
        if (isNight && next.filter(p => p.type === 'firefly').length < 14 && tick % 55 === 0) next.push(makeFirefly())
        if (isDay && next.filter(p => p.type === 'butterfly').length < 5 && tick % 130 === 0) next.push(makeButterfly())
        if (next.length > 45) next = next.slice(-40)

        return next
      })

      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [isNight, isDay, worldHealth, still])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {particles.map(p => {
        if (p.type === 'bird') return (
          <svg key={p.id} width="22" height="11" viewBox="0 0 22 11"
            style={{ position:'absolute', left:`${p.x}%`, top:`${p.y}%`, opacity:p.opacity, transform:`scale(${p.size/10})`, transformOrigin:'left center' }}>
            <path d="M0 5.5 Q5.5 0 11 5.5 Q16.5 0 22 5.5" stroke="rgba(20,20,20,0.65)" strokeWidth="1.5" fill="none" />
          </svg>
        )

        if (p.type === 'butterfly') {
          const c = worldHealth > 70 ? '#f472b6' : '#a78bfa'
          return (
            <svg key={p.id} width="18" height="14" viewBox="0 0 18 14"
              style={{ position:'absolute', left:`${p.x}%`, top:`${p.y}%`, opacity:p.opacity, transform:`scale(${p.size/10}) rotate(${Math.sin(p.phase)*18}deg)` }}>
              <ellipse cx="4.5" cy="6" rx="4" ry="6" fill={c} opacity="0.82" />
              <ellipse cx="13.5" cy="6" rx="4" ry="6" fill={c} opacity="0.82" />
              <line x1="9" y1="0" x2="9" y2="14" stroke="#666" strokeWidth="0.8" />
            </svg>
          )
        }

        if (p.type === 'firefly') return (
          <div key={p.id} style={{
            position:'absolute', left:`${p.x}%`, top:`${p.y}%`,
            width:p.size, height:p.size, borderRadius:'50%',
            background:`rgba(170,255,80,${p.opacity})`,
            boxShadow:`0 0 ${p.size*2}px ${p.size}px rgba(130,255,60,${p.opacity*0.55})`,
          }} />
        )

        if (p.type === 'leaf') return (
          <div key={p.id} style={{
            position:'absolute', left:`${p.x}%`, top:`${p.y}%`,
            width:p.size, height:p.size*1.5, opacity:p.opacity,
            background:'rgba(55,130,35,0.72)', borderRadius:'50% 0 50% 0',
            transform:`rotate(${p.phase*28}deg)`,
          }} />
        )

        return null
      })}

      {meteor && (
        <span
          key={meteor.id} aria-hidden onAnimationEnd={() => setMeteor(null)}
          style={{
            position: 'absolute', left: `${meteor.x}%`, top: `${meteor.y}%`, width: 120, height: 2, borderRadius: 2,
            background: 'linear-gradient(to left, rgba(255,255,255,0.95), rgba(180,215,255,0.35) 40%, transparent)',
            transformOrigin: 'right center', animation: 'kivo-meteor 1.1s ease-out forwards',
          }}
        />
      )}
      <style>{`@keyframes kivo-meteor { from { transform: rotate(-24deg) translateX(-60px); opacity: 0 } 15% { opacity: 1 } to { transform: rotate(-24deg) translateX(260px); opacity: 0 } }`}</style>

      {/* Low world health fog */}
      {worldHealth < 70 && (
        <div style={{ position:'absolute', inset:0, background:`linear-gradient(to top, rgba(140,145,150,${(70-worldHealth)/300}) 0%, transparent 55%)`, pointerEvents:'none' }} />
      )}

      {/* Dusk warm overlay */}
      {isDusk && (
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, rgba(200,110,35,0.07) 0%, rgba(170,75,15,0.05) 100%)', pointerEvents:'none' }} />
      )}
    </div>
  )
}

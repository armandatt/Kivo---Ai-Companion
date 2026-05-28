'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

const STAGES = [
  { day: 'Day 1',  label: 'Egg',      emoji: '🥚', desc: 'Your journey begins',          color: '#8B8FA8' },
  { day: 'Day 3',  label: 'Hatchling', emoji: '🐣', desc: 'First streak unlocked',        color: '#FCD34D' },
  { day: 'Day 7',  label: 'Creature',  emoji: '🦎', desc: 'One week. Real momentum.',     color: '#6EE7B7' },
  { day: 'Day 21', label: 'Beast',     emoji: '🐲', desc: 'You\'re unstoppable now.',     color: '#00E5A0' },
  { day: 'Day 50', label: 'Legend',    emoji: '🐉', desc: 'They said you wouldn\'t last.', color: '#00E5A0' },
]

export function CreatureReveal() {
  const [activeStage, setActiveStage] = useState(4)
  const [revealed, setRevealed] = useState(false)
  const [hoveredStage, setHoveredStage] = useState<number | null>(null)
  const sectionRef = useRef<HTMLDivElement>(null)

  // Reveal on scroll into view
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setRevealed(true) },
      { threshold: 0.3 }
    )
    if (sectionRef.current) obs.observe(sectionRef.current)
    return () => obs.disconnect()
  }, [])

  // Auto-cycle through stages on reveal for drama
  useEffect(() => {
    if (!revealed) return
    let i = 0
    setActiveStage(0)
    const t = setInterval(() => {
      i++
      if (i >= STAGES.length) { clearInterval(t); return }
      setActiveStage(i)
    }, 500)
    return () => clearInterval(t)
  }, [revealed])

  const display = hoveredStage !== null ? hoveredStage : activeStage
  const stage = STAGES[display]

  return (
    <>
      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.04); }
        }
        @keyframes ringPulse {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50%       { opacity: 0.6;  transform: scale(1.06); }
        }
        @keyframes ringPulse2 {
          0%, 100% { opacity: 0.1; transform: scale(1); }
          50%       { opacity: 0.3; transform: scale(1.12); }
        }
        @keyframes floatUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes particleDrift {
          0%   { transform: translateY(0px) translateX(0px); opacity: 0.6; }
          50%  { transform: translateY(-18px) translateX(6px); opacity: 1; }
          100% { transform: translateY(-36px) translateX(-4px); opacity: 0; }
        }
        .creature-emoji {
          animation: breathe 3s ease-in-out infinite;
          display: inline-block;
          filter: drop-shadow(0 0 24px currentColor);
        }
        .ring-1 { animation: ringPulse 3s ease-in-out infinite; }
        .ring-2 { animation: ringPulse2 3s ease-in-out infinite 0.4s; }
        .float-up { animation: floatUp 0.5s cubic-bezier(0.22,1,0.36,1) forwards; }
        .fade-in  { animation: fadeIn 0.4s ease forwards; }
        .particle { animation: particleDrift 2.5s ease-in-out infinite; }
      `}</style>

      <section
        ref={sectionRef}
        className="relative overflow-hidden py-24 px-4"
        style={{ background: '#060810' }}
      >
        {/* Deep radial bg glow */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(ellipse 600px 400px at 50% 40%, ${stage.color}12 0%, transparent 70%)`,
          transition: 'background 0.8s ease',
        }} />

        {/* Floating particles around creature */}
        {revealed && [
          { x: '-60px', y: '-40px', delay: '0s',    size: '6px' },
          { x: '70px',  y: '-60px', delay: '0.6s',  size: '4px' },
          { x: '-80px', y: '30px',  delay: '1.2s',  size: '5px' },
          { x: '90px',  y: '20px',  delay: '0.3s',  size: '4px' },
          { x: '20px',  y: '-80px', delay: '0.9s',  size: '3px' },
        ].map((p, i) => (
          <div
            key={i}
            className="absolute particle"
            style={{
              left: '50%',
              top: '38%',
              marginLeft: p.x,
              marginTop: p.y,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: stage.color,
              animationDelay: p.delay,
              opacity: 0.6,
            }}
          />
        ))}

        <div className="relative z-10 flex flex-col items-center justify-center">

          {/* Label */}
          <div
            className="mb-10 fade-in"
            style={{ animationDelay: '0.1s', opacity: 0 }}
          >
            <span className="text-xs font-bold tracking-[0.25em] uppercase" style={{ color: '#00E5A0' }}>
              your companion
            </span>
          </div>

          {/* Stage progression dots */}
          <div className="flex items-center gap-3 mb-10">
            {STAGES.map((s, i) => (
              <button
                key={i}
                onMouseEnter={() => setHoveredStage(i)}
                onMouseLeave={() => setHoveredStage(null)}
                onClick={() => setActiveStage(i)}
                className="flex flex-col items-center gap-1.5 group"
                style={{ opacity: revealed ? 1 : 0, transition: `opacity 0.3s ease ${i * 0.1}s` }}
              >
                <div
                  style={{
                    width: display === i ? '28px' : '8px',
                    height: '4px',
                    borderRadius: '2px',
                    background: display === i ? s.color : 'rgba(255,255,255,0.15)',
                    transition: 'all 0.3s ease',
                    boxShadow: display === i ? `0 0 8px ${s.color}` : 'none',
                  }}
                />
                <span
                  className="text-[9px] font-semibold tracking-wide"
                  style={{
                    color: display === i ? s.color : 'rgba(255,255,255,0.2)',
                    transition: 'color 0.3s',
                  }}
                >
                  {s.day}
                </span>
              </button>
            ))}
          </div>

          {/* Creature circle */}
          <div className="relative flex items-center justify-center mb-8" style={{ width: '300px', height: '300px' }}>
            {/* Outer pulse ring 2 */}
            <div
              className="ring-2 absolute inset-0 rounded-full border"
              style={{ borderColor: stage.color, transition: 'border-color 0.6s' }}
            />
            {/* Outer pulse ring 1 */}
            <div
              className="ring-1 absolute inset-4 rounded-full border"
              style={{ borderColor: stage.color, transition: 'border-color 0.6s' }}
            />
            {/* Inner filled circle */}
            <div
              className="absolute inset-8 rounded-full"
              style={{
                background: `radial-gradient(circle at 40% 35%, #1a2030, #0d1117)`,
                border: `1px solid ${stage.color}30`,
                boxShadow: `inset 0 0 40px ${stage.color}10`,
                transition: 'border-color 0.6s, box-shadow 0.6s',
              }}
            />
            {/* Stage label inside circle */}
            <div className="absolute top-14 left-0 right-0 flex justify-center">
              <span
                className="text-[10px] font-bold tracking-widest uppercase"
                style={{ color: `${stage.color}80` }}
              >
                {stage.label}
              </span>
            </div>
            {/* Creature */}
            <div
              key={display}
              className="relative z-10 creature-emoji float-up"
              style={{ fontSize: '80px', color: stage.color }}
            >
              {stage.emoji}
            </div>
            {/* Bottom glow */}
            <div
              className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none"
              style={{
                width: '120px',
                height: '30px',
                borderRadius: '50%',
                background: stage.color,
                opacity: 0.15,
                filter: 'blur(16px)',
                transition: 'background 0.6s',
              }}
            />
          </div>

          {/* Stage description */}
          <div key={display} className="float-up mb-2" style={{ opacity: 0 }}>
            <p className="text-sm font-medium" style={{ color: `${stage.color}99` }}>
              {stage.desc}
            </p>
          </div>

          {/* Headline */}
          <div
            className="text-center mb-10 max-w-2xl fade-in"
            style={{ animationDelay: '0.3s', opacity: 0 }}
          >
            <h2 className="text-5xl md:text-6xl font-black leading-tight mt-6">
              <span style={{ color: '#e8eaf0' }}>Your world grows</span>
              <br />
              <span style={{ color: '#00E5A0' }}>as you do.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: '#8B8FA8' }}>
              Every check-in feeds your creature. Every streak unlocks a new form.
              <br />
              Miss too many days — and it dims. That's the deal.
            </p>
          </div>

          {/* Stat pills */}
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {[
              { icon: '🔥', label: 'avg streak',        value: '12 days' },
              { icon: '🐉', label: 'creatures evolved', value: '2,847'   },
              { icon: '🌍', label: 'active in',         value: '40 countries' },
            ].map((stat, i) => (
              <div
                key={i}
                className="px-4 py-2.5 rounded-xl"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <p className="text-sm">
                  <span style={{ color: '#8B8FA8' }}>{stat.icon} {stat.label} </span>
                  <span className="font-bold" style={{ color: '#00E5A0' }}>{stat.value}</span>
                </p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center gap-3">
            <Button
              size="lg"
              className="font-bold px-8"
              style={{ background: '#00E5A0', color: '#060810', boxShadow: '0 0 32px rgba(0,229,160,0.3)' }}
            >
              Meet your companion →
            </Button>
            <p className="text-xs" style={{ color: '#8B8FA840' }}>
              Your egg hatches on day 3. Don't miss it.
            </p>
          </div>

        </div>
      </section>
    </>
  )
}
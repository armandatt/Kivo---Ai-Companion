'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type Phase = 'name' | 'awakening' | 'descent' | 'reveal' | 'labels' | 'creature' | 'complete'

interface Props {
  creatureName: string
  level: number
  streak: number
  onReveal: () => void
  onComplete: () => void
}

const LORE = [
  'Born from consistency.',
  'Forged from promises kept.',
  'Shaped by every day you showed up.',
  'A companion that grows as you do.',
]

const WORLD_LABELS = [
  { name: 'Rex Sanctuary',   icon: '⬡', x: 11,  y: 20, delay: 0.1 },
  { name: 'Creature Nest',   icon: '⌂', x: 37,  y: 38, delay: 0.4 },
  { name: 'Campfire',        icon: '◈', x: 49,  y: 43, delay: 0.7 },
  { name: 'Training Hall',   icon: '⚔', x: 70,  y: 30, delay: 1.0 },
  { name: 'Memory Grove',    icon: '❧', x: 19,  y: 63, delay: 1.3 },
  { name: 'Achievement Plaza', icon: '◆', x: 62,  y: 58, delay: 1.6 },
  { name: 'Journey Tower',   icon: '△', x: 50,  y: 72, delay: 1.9 },
  { name: 'Commitment Shrine', icon: '✦', x: 78, y: 45, delay: 2.2 },
]

const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  x: 5 + Math.random() * 90,
  y: 5 + Math.random() * 90,
  size: 1.5 + Math.random() * 3,
  dur: 3 + Math.random() * 4,
  delay: Math.random() * 3,
  amp: 10 + Math.random() * 18,
}))

export function CreatureIntro({ creatureName, level, streak, onReveal, onComplete }: Props) {
  const [phase, setPhase]           = useState<Phase>('name')
  const [loreIdx, setLoreIdx]       = useState(0)
  const [showLore, setShowLore]     = useState(false)
  const [showButton, setShowButton] = useState(false)
  const [cometFalling, setCometFalling] = useState(false)
  const [flashActive, setFlashActive]   = useState(false)
  const [shockwaveActive, setShockwaveActive] = useState(false)
  const [bgOpacity, setBgOpacity]   = useState(1)
  const [labelPhase, setLabelPhase] = useState(false)
  const [creatureLabel, setCreatureLabel] = useState(false)
  const revealCalledRef = useRef(false)

  // P1 → P2
  useEffect(() => {
    if (phase !== 'name') return
    const t = setTimeout(() => setPhase('awakening'), 2800)
    return () => clearTimeout(t)
  }, [phase])

  // P2: lore cycles + button
  useEffect(() => {
    if (phase !== 'awakening') return
    const t1 = setTimeout(() => setShowLore(true), 600)
    const t2 = setInterval(() => setLoreIdx(i => (i + 1) % LORE.length), 2400)
    const t3 = setTimeout(() => setShowButton(true), 3200)
    return () => { clearTimeout(t1); clearInterval(t2); clearTimeout(t3) }
  }, [phase])

  // P3: descent sequence
  const handleEnterWorld = useCallback(() => {
    setShowButton(false)
    setShowLore(false)
    setPhase('descent')
    setTimeout(() => setCometFalling(true), 350)
    setTimeout(() => { setFlashActive(true); setShockwaveActive(true) }, 2200)
    setTimeout(() => setFlashActive(false), 2850)
    setTimeout(() => { setShockwaveActive(false); setPhase('reveal') }, 3100)
  }, [])

  // P4: fade overlay, call onReveal
  useEffect(() => {
    if (phase !== 'reveal') return
    if (!revealCalledRef.current) { revealCalledRef.current = true; onReveal() }
    let op = 1
    const fade = setInterval(() => {
      op -= 0.022
      setBgOpacity(Math.max(0, op))
      if (op <= 0) { clearInterval(fade); setTimeout(() => setPhase('labels'), 700) }
    }, 35)
    return () => clearInterval(fade)
  }, [phase, onReveal])

  // P5: labels
  useEffect(() => {
    if (phase !== 'labels') return
    setLabelPhase(true)
    const t = setTimeout(() => setPhase('creature'), 4500)
    return () => clearTimeout(t)
  }, [phase])

  // P6: creature name
  useEffect(() => {
    if (phase !== 'creature') return
    setLabelPhase(false)
    setCreatureLabel(true)
    const t = setTimeout(() => setPhase('complete'), 3500)
    return () => clearTimeout(t)
  }, [phase])

  // P7: done
  useEffect(() => {
    if (phase !== 'complete') return
    setCreatureLabel(false)
    const t = setTimeout(onComplete, 700)
    return () => clearTimeout(t)
  }, [phase, onComplete])

  const overlayBg = ['name', 'awakening', 'descent'].includes(phase)
    ? 1
    : phase === 'reveal' ? bgOpacity
    : phase === 'labels' ? 0.1
    : phase === 'creature' ? 0.15
    : 0

  const isDone = phase === 'complete' && !creatureLabel

  return (
    <AnimatePresence>
      {!isDone && (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
          style={{ pointerEvents: (phase === 'labels' || phase === 'creature') ? 'none' : 'all' }}
        >
          {/* Black overlay */}
          <div className="absolute inset-0 bg-black" style={{ opacity: overlayBg }} />

          {/* ── Ambient particles (P1 + P2) ─────────────────────────── */}
          {(phase === 'name' || phase === 'awakening') && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {PARTICLES.map(p => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.65, 0.3, 0.65, 0], y: [-p.amp, p.amp, -p.amp] }}
                  transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
                    width: p.size, height: p.size, borderRadius: '50%',
                    background: phase === 'awakening' ? 'rgba(163,230,53,0.9)' : 'rgba(255,255,255,0.6)',
                    boxShadow: phase === 'awakening' ? `0 0 ${p.size*3}px rgba(163,230,53,0.5)` : 'none',
                  }}
                />
              ))}
            </div>
          )}

          {/* ── P1 + P2: Name + lore + button ───────────────────────── */}
          {(phase === 'name' || phase === 'awakening') && (
            <div className="relative z-10 flex flex-col items-center gap-6 text-center px-8">
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                style={{
                  fontSize: `clamp(2rem, ${Math.min(10, Math.floor(55 / Math.max(creatureName.length, 4)))}vw, 5.5rem)`,
                  fontWeight: 900,
                  letterSpacing: phase === 'awakening' ? '0.05em' : '0.08em',
                  color: phase === 'awakening' ? '#bfff00' : '#fff',
                  textShadow: phase === 'awakening'
                    ? '0 0 60px rgba(191,255,0,0.55), 0 0 120px rgba(163,230,53,0.28)'
                    : '0 0 30px rgba(255,255,255,0.12)',
                  lineHeight: 1, fontFamily: 'system-ui, sans-serif',
                  maxWidth: '90vw', overflow: 'hidden',
                  transition: 'color 1.1s ease, text-shadow 1.1s ease, letter-spacing 1.1s ease',
                }}
              >
                {creatureName.toUpperCase()}
              </motion.h1>

              <AnimatePresence>
                {phase === 'awakening' && (
                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 0.55, y: 0 }}
                    transition={{ delay: 0.7, duration: 0.7 }}
                    className="text-sm tracking-[0.4em] text-lime-300/55 uppercase font-light"
                  >
                    Level {level} · {streak} Day Streak
                  </motion.p>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait">
                {showLore && (
                  <motion.p
                    key={loreIdx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 0.75, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.55 }}
                    className="text-base text-slate-300 font-light tracking-wide italic"
                  >
                    {LORE[loreIdx]}
                  </motion.p>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showButton && (
                  <motion.button
                    initial={{ opacity: 0, y: 14, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 22 }}
                    onClick={handleEnterWorld}
                    className="relative mt-4"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    <motion.div
                      animate={{ scale: [1, 1.07, 1], opacity: [0.35, 0.65, 0.35] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute inset-0 rounded-full border border-lime-400/50"
                      style={{ margin: '-10px' }}
                    />
                    <div
                      className="px-11 py-4 rounded-full border border-lime-400/75 hover:bg-lime-400/10 transition-all duration-300"
                      style={{ boxShadow: '0 0 28px rgba(163,230,53,0.18), inset 0 0 18px rgba(163,230,53,0.04)' }}
                    >
                      <span className="text-xs font-bold tracking-[0.45em] text-lime-300 uppercase">
                        Enter World
                      </span>
                    </div>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ── P3: Descent ──────────────────────────────────────────── */}
          {phase === 'descent' && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <motion.div
                initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <h1 style={{ fontSize: `clamp(2rem,${Math.min(10,Math.floor(55/Math.max(creatureName.length,4)))}vw,5.5rem)`, fontWeight:900, color:'#bfff00', opacity:0.25, letterSpacing:'0.05em', maxWidth:'90vw', overflow:'hidden' }}>
                  {creatureName.toUpperCase()}
                </h1>
              </motion.div>

              {cometFalling && <>
                {/* Trail */}
                <motion.div
                  initial={{ y:'-8vh', x:'-50%', opacity:0, scaleY:0 }}
                  animate={{ y:'82vh', x:'-50%', opacity:[0,0.55,0.55,0], scaleY:[0,1,1,0] }}
                  transition={{ duration: 1.9, ease:[0.4,0,0.85,0.6] }}
                  style={{
                    position:'absolute', left:'50%', top:0, width:5, height:'42vh',
                    background:'linear-gradient(to bottom,transparent,rgba(191,255,0,0.4),rgba(255,255,255,0.55))',
                    transformOrigin:'top', filter:'blur(2px)',
                  }}
                />
                {/* Ball */}
                <motion.div
                  initial={{ y:'-8vh', x:'-50%', opacity:0 }}
                  animate={{ y:'82vh', x:'-50%', opacity:[0,1,1,0.7] }}
                  transition={{ duration:1.9, ease:[0.4,0,0.85,0.6] }}
                  style={{
                    position:'absolute', left:'50%', top:0, width:20, height:20, marginLeft:-10,
                    borderRadius:'50%',
                    background:'radial-gradient(circle,#fff 0%,#bfff00 35%,rgba(191,255,0,0.3) 70%,transparent 100%)',
                    boxShadow:'0 0 28px 11px rgba(191,255,0,0.5),0 0 55px 24px rgba(163,230,53,0.22)',
                  }}
                />
              </>}

              {flashActive && (
                <motion.div
                  initial={{ opacity:0 }} animate={{ opacity:[0,1,0.55,0] }}
                  transition={{ duration:0.7, times:[0,0.15,0.5,1] }}
                  style={{
                    position:'absolute', inset:0,
                    background:'radial-gradient(circle at 50% 84%,#fff 0%,rgba(191,255,0,0.8) 14%,rgba(163,230,53,0.28) 40%,transparent 65%)',
                  }}
                />
              )}

              {shockwaveActive && <>
                {[80,60].map((sz,i) => (
                  <motion.div key={i}
                    initial={{ scale:0, opacity: i===0?0.9:0.5 }}
                    animate={{ scale: i===0?8:12, opacity:0 }}
                    transition={{ duration: i===0?0.9:1.1, ease:'easeOut', delay:i*0.1 }}
                    style={{
                      position:'absolute', bottom:'17%', left:'50%',
                      width:sz, height:sz, borderRadius:'50%',
                      border:`${i===0?3:2}px solid rgba(${i===0?'191,255,0':'255,255,255'},${i===0?0.85:0.5})`,
                      marginLeft:-sz/2, marginBottom:-sz/2,
                    }}
                  />
                ))}
                {[...Array(10)].map((_,i) => {
                  const a = (i/10)*Math.PI*2
                  return (
                    <motion.div key={i}
                      initial={{ opacity:1, x:0, y:0, scale:1 }}
                      animate={{ opacity:0, x:Math.cos(a)*(60+Math.random()*80), y:Math.sin(a)*(40+Math.random()*60), scale:0 }}
                      transition={{ duration:0.85, ease:'easeOut' }}
                      style={{
                        position:'absolute', bottom:'18%', left:'50%',
                        width:5+Math.random()*9, height:5+Math.random()*9, borderRadius:'50%',
                        background: i%2===0?'#bfff00':'#ffffff', marginLeft:-4, marginBottom:-4,
                      }}
                    />
                  )
                })}
              </>}
            </div>
          )}

          {/* ── P4: Reveal text ─────────────────────────────────────── */}
          {phase === 'reveal' && (
            <motion.p
              initial={{ opacity:0 }} animate={{ opacity:[0,0.3,0] }}
              transition={{ duration:2.8, times:[0,0.4,1] }}
              className="relative z-10 text-lg font-light tracking-[0.32em] text-white/50 uppercase"
            >
              Your world
            </motion.p>
          )}

          {/* ── P5: Floating World Labels ───────────────────────────── */}
          <AnimatePresence>
            {labelPhase && WORLD_LABELS.map(label => (
              <motion.div
                key={label.name}
                initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
                transition={{ delay:label.delay, duration:0.6 }}
                style={{ position:'absolute', left:`${label.x}%`, top:`${label.y}%`, zIndex:10 }}
              >
                <motion.div
                  animate={{ y:[0,-7,0] }}
                  transition={{ duration:2.5+label.delay*0.3, repeat:Infinity, ease:'easeInOut' }}
                  style={{
                    display:'flex', alignItems:'center', gap:6,
                    padding:'5px 12px', borderRadius:99,
                    background:'rgba(2,6,23,0.65)', backdropFilter:'blur(6px)',
                    border:'1px solid rgba(163,230,53,0.22)',
                    boxShadow:'0 0 10px rgba(163,230,53,0.07)',
                    whiteSpace:'nowrap', position:'relative',
                  }}
                >
                  <span style={{ fontSize:11, opacity:0.65 }}>{label.icon}</span>
                  <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.14em', color:'rgba(190,255,80,0.8)', textTransform:'uppercase' }}>
                    {label.name}
                  </span>
                  <div style={{ position:'absolute', bottom:-13, left:'50%', width:1, height:11, background:'rgba(163,230,53,0.28)', transform:'translateX(-50%)' }} />
                </motion.div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* ── P6: Creature name reveal ─────────────────────────────── */}
          <AnimatePresence>
            {creatureLabel && (
              <motion.div
                initial={{ opacity:0, scale:0.92 }} animate={{ opacity:1, scale:1 }}
                exit={{ opacity:0, scale:0.95 }} transition={{ duration:0.6 }}
                className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
              >
                <div className="text-center">
                  <motion.p
                    initial={{ opacity:0, y:6 }} animate={{ opacity:0.5, y:0 }} transition={{ delay:0.2 }}
                    className="text-[10px] tracking-[0.42em] text-lime-400/50 uppercase mb-3 font-semibold"
                  >
                    Your Companion
                  </motion.p>
                  <motion.h2
                    initial={{ opacity:0, letterSpacing:'0.15em' }}
                    animate={{ opacity:1, letterSpacing:'0.05em' }}
                    transition={{ delay:0.35, duration:0.85 }}
                    style={{
                      fontSize:`clamp(2rem, ${Math.min(8, Math.floor(50 / Math.max(creatureName.length, 4)))}vw, 4.5rem)`,
                      fontWeight:900, maxWidth:'90vw', overflow:'hidden',
                      color:'#bfff00', textShadow:'0 0 45px rgba(191,255,0,0.5)',
                      fontFamily:'system-ui, sans-serif',
                    }}
                  >
                    {creatureName.toUpperCase()}
                  </motion.h2>
                  <motion.p
                    initial={{ opacity:0 }} animate={{ opacity:0.5 }} transition={{ delay:0.85 }}
                    className="text-sm tracking-[0.25em] text-slate-400 mt-2 font-light"
                  >
                    Level {level} · {streak} day streak
                  </motion.p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

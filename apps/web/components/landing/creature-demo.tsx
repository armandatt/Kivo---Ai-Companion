'use client'

// Your creature, on the landing page: the village a learner's study grows. The
// places, where they stand and the days in a row that open them are the
// game's own (lib/creature/places.ts); level and world health follow the
// rules of the Creature view (creature.types.ts). The real world is 3D and
// drawn from a seed of the learner's own; this is a flat drawing of the same
// village, said to be one. Local state only.

import { AnimatePresence, motion } from 'framer-motion'
import { Flame, Lock, Sparkles, Sun, Moon, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLACES, VILLAGE, unlockedPlaces, type PlaceId } from '@/lib/creature/places'
import { CREATURE_BASE_HEALTH, CREATURE_DAYS_PER_LEVEL, CREATURE_HEALTH_PER_DAY } from '@repo/api/nova/product/creature.types'
import { AppWindow, StoryControls, useStory } from './frame'

// The days the sample steps through: each one opens a place.
const DAYS = [1, 3, 7, 14]
const LABELS = DAYS.map(d => `Day ${d}`)
// Shown in the drawing: what opens in the first two weeks, and the tower far off.
const SHOWN: PlaceId[] = ['center', 'home', 'grove', 'training', 'plaza', 'shrine', 'tower']
const HUE: Record<PlaceId, { roof: string; wall: string; h: number }> = {
  center:   { roof: '#ffb15c', wall: '#7a3d1a', h: 6 },
  home:     { roof: '#e8735a', wall: '#d8c3a5', h: 16 },
  grove:    { roof: '#3fbf7f', wall: '#1f6b47', h: 20 },
  training: { roof: '#7c8cff', wall: '#c9cfe0', h: 18 },
  plaza:    { roof: '#ffd166', wall: '#e9e1cf', h: 12 },
  shrine:   { roof: '#00E5A0', wall: '#cfe9df', h: 22 },
  rex:      { roof: '#9aa4b2', wall: '#5b6573', h: 14 },
  tower:    { roof: '#b892ff', wall: '#d9d2ea', h: 42 },
}
// A few trees, placed by hand so the drawing is the same for everyone.
const TREES: Array<[number, number]> = [[-6, 4], [4, -12], [-12, -2], [15, 2], [8, 3], [-2, 9], [2, -6], [-16, 12], [13, 14], [-8, 18], [17, -9]]

const K = 6
const iso = (x: number, z: number) => ({ x: (x - z) * K, y: (x + z) * K * 0.5 })
// The island: the ground the village stands on, from its own bounds.
const [W, E, N, S] = [-18, 18, -13, 22]
const corner = { back: iso(W, N), right: iso(E, N), front: iso(E, S), left: iso(W, S) }
const pt = (q: { x: number; y: number }, dy = 0) => `${q.x},${q.y + dy}`
const DEPTH = 18

function Block({ x, y, w, h, top, side }: { x: number; y: number; w: number; h: number; top: string; side: string }) {
  // An isometric box standing on (x, y).
  const d = w * 0.5
  return (
    <g>
      <path d={`M${x - w},${y} L${x},${y + d} L${x},${y + d - h} L${x - w},${y - h} Z`} fill={side} />
      <path d={`M${x + w},${y} L${x},${y + d} L${x},${y + d - h} L${x + w},${y - h} Z`} fill={side} opacity={0.72} />
      <path d={`M${x},${y - d - h} L${x + w},${y - h} L${x},${y + d - h} L${x - w},${y - h} Z`} fill={top} />
    </g>
  )
}

export function CreatureDemo() {
  const s = useStory(DAYS.length, 2600)
  const days = DAYS[s.step]!
  const open = new Set(unlockedPlaces(days).map(p => p.id))
  // In the sample every day of the streak is an active day.
  const level = 1 + Math.floor(days / CREATURE_DAYS_PER_LEVEL)
  const health = Math.min(100, CREATURE_BASE_HEALTH + CREATURE_HEALTH_PER_DAY * days)
  const night = s.step === DAYS.length - 1
  // The creature walks to the place this day opened (or sits by the fire).
  const newest = [...PLACES].reverse().find(p => p.unlockDays <= days && p.unlockDays > 0 && SHOWN.includes(p.id))
  const at = iso(VILLAGE[newest?.id ?? 'center'].x, VILLAGE[newest?.id ?? 'center'].z)

  return (
    <div ref={s.ref} className="space-y-4">
      <AppWindow label="Kivo · Your creature" className="h-[34rem]">
        <div className={cn('kivo-dark relative h-full overflow-hidden transition-colors duration-700', night ? 'bg-[#060a18]' : 'bg-[#0b1a22]')} data-creature-demo data-days={days}>
          {/* Sky */}
          <div aria-hidden className={cn('absolute inset-0 transition-opacity duration-700', night ? 'opacity-0' : 'opacity-100')} style={{ background: 'radial-gradient(90% 70% at 50% 10%, rgba(126,245,207,0.18), transparent 70%), linear-gradient(180deg,#123341,#0b1a22 70%)' }} />
          <div aria-hidden className={cn('absolute inset-0 transition-opacity duration-700', night ? 'opacity-100' : 'opacity-0')}>
            {Array.from({ length: 40 }, (_, i) => <span key={i} className="creature-star absolute size-[2px] rounded-full bg-white" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 55}%`, animationDelay: `${(i % 7) * -0.6}s` }} />)}
          </div>

          {/* The village */}
          <svg viewBox="-225 -120 450 270" className="absolute inset-0 size-full" role="img" aria-label={`A drawing of the village on day ${days}: ${SHOWN.filter(id => open.has(id)).map(id => PLACES.find(p => p.id === id)!.name).join(', ')} open.`}>
            <defs>
              <radialGradient id="cd-fire"><stop offset="0" stopColor="#ffb15c" stopOpacity="0.55" /><stop offset="1" stopColor="#ffb15c" stopOpacity="0" /></radialGradient>
            </defs>
            <g transform="translate(27,-14)">
              {/* The island */}
              <path d={`M${pt(corner.back)} L${pt(corner.right)} L${pt(corner.front)} L${pt(corner.left)} Z`} fill={night ? '#1d3b2c' : '#2f6b45'} className="transition-[fill] duration-700" />
              <path d={`M${pt(corner.left)} L${pt(corner.front)} L${pt(corner.front, DEPTH)} L${pt(corner.left, DEPTH)} Z`} fill="#5a3d26" />
              <path d={`M${pt(corner.right)} L${pt(corner.front)} L${pt(corner.front, DEPTH)} L${pt(corner.right, DEPTH)} Z`} fill="#43301f" />
              {TREES.map(([x, z], i) => { const p = iso(x, z); return <g key={i} className="creature-sway" style={{ transformOrigin: `${p.x}px ${p.y}px`, animationDelay: `${i * -0.4}s` }}><Block x={p.x} y={p.y} w={2} h={6} top="#5a3d26" side="#43301f" /><Block x={p.x} y={p.y - 6} w={5} h={8} top={night ? '#2a6b4a' : '#4fbf7a'} side={night ? '#1b4a33' : '#2f8a55'} /></g> })}
              {SHOWN.map(id => {
                const place = PLACES.find(p => p.id === id)!
                const p = iso(VILLAGE[id].x, VILLAGE[id].z)
                const c = HUE[id]
                const isOpen = open.has(id)
                return (
                  <g key={id}>
                    <AnimatePresence>
                      {isOpen ? (
                        <motion.g key="open" initial={s.reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                          {id === 'center' && <circle cx={p.x} cy={p.y} r={night ? 34 : 18} fill="url(#cd-fire)" className="creature-flicker" />}
                          <Block x={p.x} y={p.y} w={id === 'tower' ? 6 : 8} h={c.h} top={c.roof} side={c.wall} />
                          {place.unlockDays === days && days > 1 && <circle cx={p.x} cy={p.y - c.h / 2} r="14" fill="none" stroke="#7ef5cf" strokeWidth="1.2" className="creature-ping" />}
                        </motion.g>
                      ) : (
                        <motion.g key="closed" initial={false} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} opacity={0.45}>
                          <path d={`M${p.x},${p.y - 6} L${p.x + 11},${p.y} L${p.x},${p.y + 6} L${p.x - 11},${p.y} Z`} fill="none" stroke="#cfe9df" strokeDasharray="2 2" strokeWidth="0.8" />
                        </motion.g>
                      )}
                    </AnimatePresence>
                    <text x={p.x} y={p.y + 13} textAnchor="middle" className={cn('select-none text-[6px] font-medium', isOpen ? 'fill-white/85' : 'fill-white/40')}>{place.name}{isOpen ? '' : ` · ${place.unlockDays} days`}</text>
                  </g>
                )
              })}
              {/* The creature */}
              <motion.g initial={false} animate={{ x: at.x + 11, y: at.y + 3 }} transition={{ duration: s.reduced ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <g className="creature-bob">
                  <ellipse cx="0" cy="2" rx="6" ry="2" fill="black" opacity="0.25" />
                  <path d="M-6,0 C-6,-11 6,-11 6,0 Z" fill="#00E5A0" />
                  <circle cx="-2.2" cy="-4.5" r="1.1" fill="#04130e" /><circle cx="2.2" cy="-4.5" r="1.1" fill="#04130e" />
                  <path d="M-1.4,-2.4 Q0,-1.4 1.4,-2.4" stroke="#04130e" strokeWidth="0.6" fill="none" />
                </g>
              </motion.g>
            </g>
          </svg>

          {/* The HUD */}
          <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 sm:left-4 sm:top-4">
            <span className="focus-glass inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-white/90"><Flame aria-hidden className="size-3.5 text-[#ffb15c]" /><span className="tabular-nums font-semibold">{days}</span> {days === 1 ? 'day' : 'days'} in a row</span>
            <span className="focus-glass inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-white/90"><Trophy aria-hidden className="size-3.5 text-[#ffd166]" />Level <span className="tabular-nums font-semibold">{level}</span></span>
          </div>
          <div className="absolute right-3 top-3 z-10 sm:right-4 sm:top-4">
            <span className="focus-glass inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-white/90">{night ? <Moon aria-hidden className="size-3.5" /> : <Sun aria-hidden className="size-3.5" />}{night ? 'Night' : 'Day'}</span>
          </div>
          <div className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2 sm:inset-x-4 sm:bottom-4">
            <div className="focus-glass w-52 rounded-xl px-3 py-2">
              <p className="flex items-center justify-between text-[11px] text-white/70"><span className="inline-flex items-center gap-1"><Sparkles aria-hidden className="size-3 text-[#7ef5cf]" />World health</span><span className="tabular-nums text-white/90">{health}</span></p>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/10"><motion.span className="block h-full rounded-full bg-gradient-to-r from-[#00E5A0] to-[#7ef5cf]" initial={false} animate={{ width: `${health}%` }} transition={{ duration: 0.35 }} /></span>
            </div>
            <AnimatePresence mode="wait">
              <motion.p key={days} initial={s.reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
                className="focus-glass inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-white/90">
                {newest ? <><Sparkles aria-hidden className="size-3.5 text-[#7ef5cf]" />{newest.name} opened</> : <><Lock aria-hidden className="size-3.5 text-white/50" />Campfire, Home and Memory Grove are open from day one</>}
              </motion.p>
            </AnimatePresence>
          </div>
          <span className="absolute bottom-[4.5rem] right-4 z-10 hidden text-[10px] uppercase tracking-[0.14em] text-white/35 sm:block">A drawing · the real world is 3D</span>
        </div>
      </AppWindow>
      <StoryControls count={DAYS.length} step={s.step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={LABELS} />
    </div>
  )
}

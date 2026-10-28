'use client'

// The focus room, on the landing page: the room's own scenes (FocusScene,
// drawn on a canvas, nothing downloaded), its soundscapes by name, what the
// learner filed under the topic a click away, and the question every session
// ends on. The clock ticks; the sound is not played (nothing here makes a
// noise on a landing page). Local state only: no session, no request.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, BookOpen, CalendarClock, Check, Expand, FileText, Headphones, Image as ImageIcon, Link2, ListTodo, Pause, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FocusScene, SCENES, type SceneId } from '@/components/nova/focus/focus-scene'
import { SOUNDS, type SoundId } from '@/lib/focus/soundscapes'
import { AppWindow, StoryControls, useStory } from './frame'

type Panel = 'scene' | 'sound' | 'topic' | 'end' | null
const STEPS: Array<{ label: string; scene: SceneId; panel: Panel; sounds: SoundId[] }> = [
  { label: 'Pick a scene', scene: 'aurora', panel: 'scene', sounds: [] },
  { label: 'Mix a sound', scene: 'rain', panel: 'sound', sounds: ['rain', 'cafe'] },
  { label: 'Your notes, close', scene: 'night', panel: 'topic', sounds: ['rain', 'cafe'] },
  { label: 'Say how it went', scene: 'forest', panel: 'end', sounds: ['forest'] },
]
const LABELS = STEPS.map(s => s.label)
const MIXED: SoundId[] = ['rain', 'cafe', 'forest', 'brown']
const VOLUME: Partial<Record<SoundId, number>> = { rain: 0.72, cafe: 0.38, forest: 0.6, brown: 0.5 }

const glass = 'focus-glass inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-white/90'
const enter = { initial: { opacity: 0, y: 8, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 6, scale: 0.98 }, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const } }

function clock(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

// The room's own sign that sound is on: a picture of sound, with none played.
function Bars({ on }: { on: boolean }) {
  return on ? <span className="focus-eq text-[#7ef5cf]" aria-hidden><i /><i /><i /></span> : null
}

export function FocusDemo() {
  const s = useStory(STEPS.length, 2700)
  const now = STEPS[s.step]!
  // The clock runs while the room is on screen, as a session's would.
  const [left, setLeft] = useState(18 * 60 + 42)
  useEffect(() => {
    if (!s.inView || s.reduced) return
    const t = window.setInterval(() => setLeft(n => (n > 0 ? n - 1 : 25 * 60)), 1000)
    return () => window.clearInterval(t)
  }, [s.inView, s.reduced])
  const sceneName = SCENES.find(x => x.id === now.scene)?.name

  return (
    <div ref={s.ref} className="space-y-4">
      <AppWindow label="Kivo · Focus room" className="h-[36rem] md:h-[34rem]">
        <div className="kivo-dark relative h-full overflow-hidden bg-black text-white" data-focus-demo data-scene={now.scene}>
          {/* The scene, crossfading from one to the next */}
          <AnimatePresence initial={false}>
            <motion.div key={now.scene} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
              <FocusScene scene={now.scene} />
            </motion.div>
          </AnimatePresence>

          {/* The room's bar */}
          <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3 sm:p-4">
            <span className={glass}><ArrowLeft aria-hidden className="size-3.5" /><span className="max-sm:sr-only">Today</span></span>
            <span className="flex-1" />
            <span className={cn(glass, now.panel === 'scene' && 'ring-1 ring-white/40')}><ImageIcon aria-hidden className="size-3.5" /><span className="max-sm:sr-only">{sceneName}</span></span>
            <span className={cn(glass, now.panel === 'sound' && 'ring-1 ring-white/40')}><Headphones aria-hidden className="size-3.5" /><Bars on={now.sounds.length > 0 && !s.reduced} /></span>
            <span className={cn(glass, now.panel === 'topic' && 'ring-1 ring-white/40')}><BookOpen aria-hidden className="size-3.5" /><span className="max-sm:sr-only">On this topic</span></span>
            <span className={cn(glass, 'max-sm:hidden')}><Expand aria-hidden className="size-3.5" /></span>
          </div>

          {/* The panel the step opens */}
          <AnimatePresence mode="wait">
            {now.panel === 'scene' && (
              <motion.div key="scene" {...enter} className="focus-glass absolute right-3 top-16 z-20 w-56 rounded-2xl p-2 sm:right-4">
                <p className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-[0.14em] text-white/50">Scene</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SCENES.map(sc => (
                    <span key={sc.id} className={cn('overflow-hidden rounded-xl border text-[11px]', sc.id === now.scene ? 'border-[#7ef5cf]/80' : 'border-white/10')}>
                      <span aria-hidden className="block h-9" style={{ background: sc.swatch }} />
                      <span className="block px-2 py-1 text-white/85">{sc.name}</span>
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
            {now.panel === 'sound' && (
              <motion.div key="sound" {...enter} className="focus-glass absolute right-3 top-16 z-20 w-64 rounded-2xl p-3 sm:right-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/50">Soundscapes · made in the browser</p>
                <ul className="mt-2 space-y-2">
                  {SOUNDS.filter(x => MIXED.includes(x.id)).map(x => {
                    const on = now.sounds.includes(x.id)
                    return (
                      <li key={x.id} className="flex items-center gap-2.5">
                        <span className={cn('grid size-6 place-items-center rounded-lg text-[10px]', on ? 'bg-[#00E5A0]/25 text-[#7ef5cf]' : 'bg-white/8 text-white/40')}>{on ? <Check aria-hidden className="size-3" /> : null}</span>
                        <span className="w-20 text-[12px] text-white/85">{x.name}</span>
                        <span className="relative h-1 flex-1 rounded-full bg-white/15">
                          <motion.span className="absolute inset-y-0 left-0 rounded-full bg-white/80" initial={{ width: 0 }} animate={{ width: on ? `${(VOLUME[x.id] ?? 0.5) * 100}%` : '0%' }} transition={{ duration: 0.3 }} />
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-white/55">Or a stream or your own playlist from YouTube, Spotify or Apple Music.</p>
              </motion.div>
            )}
            {now.panel === 'topic' && (
              <motion.div key="topic" {...enter} className="focus-glass absolute left-3 top-16 z-20 w-[min(18rem,calc(100%-1.5rem))] rounded-2xl p-3 sm:left-auto sm:right-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/50">On this topic</p>
                <ul className="mt-2 space-y-1.5 text-[12px]">
                  {[
                    { icon: FileText, text: 'Gradient descent: the intuition', kind: 'Note' },
                    { icon: ListTodo, text: 'Problem set 3', kind: 'Task · due Friday' },
                    { icon: Link2, text: 'Why momentum works', kind: 'Saved page' },
                    { icon: CalendarClock, text: 'ML midterm', kind: 'Exam · Thursday' },
                  ].map((r, i) => (
                    <motion.li key={r.text} initial={s.reduced ? false : { opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, delay: s.reduced ? 0 : 0.05 + i * 0.05 }}
                      className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-2 py-1.5">
                      <r.icon aria-hidden className="size-3.5 shrink-0 text-[#7ef5cf]" />
                      <span className="min-w-0 flex-1 truncate text-white/90">{r.text}</span>
                      <span className="shrink-0 text-[10px] text-white/45">{r.kind}</span>
                    </motion.li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-snug text-white/60"><span className="text-white/40">Your note from last time:</span> “Too big a learning rate overshoots.”</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The clock */}
          <div className="relative z-0 flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">Machine Learning</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-white/95 sm:text-xl">Gradient descent</p>
            <AnimatePresence mode="wait" initial={false}>
              {now.panel === 'end' ? (
                <motion.div key="end" {...enter} className="mt-6 w-full max-w-md">
                  <p className="text-2xl font-semibold tracking-tight sm:text-3xl">How did it go?</p>
                  <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {['Struggled', 'Okay', 'Good', 'Crushed it'].map(o => (
                      <span key={o} className={cn('focus-glass inline-flex h-11 items-center justify-center rounded-2xl text-[13px] font-medium', o === 'Good' && 'bg-white/20 ring-1 ring-[#7ef5cf]/70')}>{o}</span>
                    ))}
                  </div>
                  <p className="mt-4 text-[12px] text-white/55">How it went decides when the topic comes back for review.</p>
                </motion.div>
              ) : (
                <motion.div key="clock" {...enter}>
                  <span role="timer" aria-label="Time left" className="mt-2 block text-[clamp(4.5rem,13vw,7.5rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums [text-shadow:0_8px_60px_rgba(0,0,0,0.45)]">{clock(left)}</span>
                  <p className="mt-2 text-[12px] text-white/55">left of 25 min</p>
                  <div className="mt-7 flex items-center justify-center gap-2">
                    <span className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"><Pause aria-hidden className="size-4" /> Pause</span>
                    <span className="focus-glass inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-medium"><Square aria-hidden className="size-3.5" /> End session</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="absolute inset-x-0 bottom-3 z-10 hidden text-center text-[11px] text-white/40 sm:block">Space pause · F fullscreen · S sound · M mute</p>
        </div>
      </AppWindow>
      <StoryControls count={STEPS.length} step={s.step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={LABELS} />
    </div>
  )
}

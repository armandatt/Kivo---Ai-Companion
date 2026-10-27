'use client'

// The pieces every product preview on the landing page shares: a window in
// the app's own dark theme (.kivo-app, with .kivo-dark so a visitor who
// chose the light app theme still sees the page's dark previews), a label
// that says it is a sample, and a story player that steps through a preview
// on its own while it is on screen and never while the visitor asked for
// reduced motion. Nothing here sends a request: the previews are local state.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MotionConfig, useInView, useReducedMotion } from 'framer-motion'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AppWindow({ label, sample = true, className, children, bar }: { label: string; sample?: boolean; className?: string; children: ReactNode; bar?: ReactNode }) {
  return (
    <div className={cn('kivo-app overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#0b0c12] shadow-[0_40px_120px_-40px_rgba(0,229,160,0.25),0_0_0_1px_rgba(255,255,255,0.02)]', className)}>
      <div className="kivo-dark flex h-full flex-col bg-background text-foreground">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/6 px-4">
          <span aria-hidden className="flex gap-1.5"><span className="size-2.5 rounded-full bg-white/12" /><span className="size-2.5 rounded-full bg-white/12" /><span className="size-2.5 rounded-full bg-white/12" /></span>
          <span className="ml-2 min-w-0 truncate text-[12px] font-medium text-foreground/70">{label}</span>
          <span className="flex-1" />
          {bar}
          {sample && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-foreground/50">Sample</span>}
        </div>
        <div className="relative min-h-0 flex-1"><MotionConfig reducedMotion="user">{children}</MotionConfig></div>
      </div>
    </div>
  )
}

// Steps a preview forward every `ms` while it is in view and playing. With
// reduced motion it starts paused on the step given; the visitor moves it.
export function useStory(count: number, ms: number, { start = 0, loop = true }: { start?: number; loop?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const reduced = useReducedMotion()
  const [step, setStep] = useState(start)
  const [playing, setPlaying] = useState(true)
  const auto = playing && inView && !reduced
  useEffect(() => {
    if (!auto) return
    const t = window.setTimeout(() => setStep(s => (s + 1 < count ? s + 1 : loop ? 0 : s)), ms)
    return () => window.clearTimeout(t)
  }, [auto, step, count, ms, loop])
  useEffect(() => { if (reduced) setPlaying(false) }, [reduced])
  const go = useCallback((n: number) => { setStep(Math.max(0, Math.min(count - 1, n))); setPlaying(false) }, [count])
  // Back to the first step, playing again (still never under reduced motion).
  const restart = useCallback(() => { setStep(0); setPlaying(true) }, [])
  return { ref, step, go, restart, playing: auto, paused: !playing, toggle: () => setPlaying(p => !p), reduced: !!reduced, inView }
}

export function StoryControls({ count, step, go, paused, toggle, labels, className }: {
  count: number; step: number; go: (n: number) => void; paused: boolean; toggle: () => void; labels: string[]; className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="Preview steps">
      <button type="button" onClick={toggle} aria-label={paused ? 'Play the preview' : 'Pause the preview'}
        className="inline-flex size-8 items-center justify-center rounded-full border border-white/12 text-slate-300 transition-colors hover:border-[#00E5A0]/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
        {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
      </button>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" onClick={() => go(i)} aria-current={i === step ? 'step' : undefined} aria-label={`Step ${i + 1}: ${labels[i]}`} title={labels[i]}
          className={cn('h-8 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]',
            i === step ? 'bg-[#00E5A0]/15 text-[#7ef5cf] ring-1 ring-[#00E5A0]/40' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')}>
          <span className="tabular-nums">{i + 1}</span><span className="max-sm:sr-only"> · {labels[i]}</span>
        </button>
      ))}
    </div>
  )
}

export function ReplayButton({ onClick, label = 'Start over' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 px-3 text-xs font-medium text-slate-300 transition-colors hover:border-[#00E5A0]/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
      <RotateCcw aria-hidden className="size-3.5" /> {label}
    </button>
  )
}

// Mounts its children once the visitor scrolls near them, so a lower demo
// and its code load only for someone who gets there.
export function NearMount({ children, minHeight, className }: { children: ReactNode; minHeight: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useInView(ref, { once: true, margin: '600px 0px' })
  return <div ref={ref} className={className} style={{ minHeight }}>{near ? children : null}</div>
}

// A section's words, risen into place once as the visitor reaches them. The
// page is drawn with them in place (so they read without JavaScript, and in
// search results); only a section still below the screen when the page
// starts is lowered, out of sight, to rise when it scrolls in. Never for
// reduced motion.
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const [state, setState] = useState<'still' | 'waiting' | 'shown'>('still')
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    if (el.getBoundingClientRect().top > window.innerHeight) setState('waiting')
  }, [reduced])
  useEffect(() => { if (inView) setState(s => (s === 'waiting' ? 'shown' : s)) }, [inView])
  return (
    <div ref={ref} className={cn(className, state !== 'still' && 'transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]', state === 'waiting' && 'translate-y-[18px] opacity-0')}
      style={state === 'shown' && delay ? { transitionDelay: `${delay}s` } : undefined} data-reveal={state}>
      {children}
    </div>
  )
}

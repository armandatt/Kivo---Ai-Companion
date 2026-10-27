'use client'

// The top of the landing page: what Kivo is, in a sentence, and a short tour
// of using it, one step at a time (a goal, Nova's question, a structure, the
// map, a note, the day). The robot stays as Kivo's mark, beside the product
// rather than instead of it; it loads only on a wide screen, and nothing
// floats for a visitor who asked for reduced motion.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, BookOpen, Check, Flag, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthAwareLink } from '@/components/auth-aware-link'
import { SparklesCore } from '@/components/ui/sparkles'
import { SplineBot } from '@/components/spline-bot'
import { KivoMark } from '@/components/brand/kivo-brand'
import { subjectColor } from '@/components/nova/subject-color'
import { cn } from '@/lib/utils'
import { AppWindow, StoryControls, useStory } from './frame'

const STEPS = ['Your goal', 'Nova asks', 'A structure', 'Connected', 'A source', 'Your day']
const CAPTIONS = [
  'You say what you’re working toward, in your own words.',
  'Nova asks what it needs before it suggests anything.',
  'Subjects and topics take shape. Nothing is created until you approve it.',
  'Topics, notes and tasks connect on your Knowledge Map.',
  'Open a note or a paper; the Tutor explains it from your own material.',
  'You choose what today is for, and start a focus session.',
]

const OS = subjectColor('Operating Systems'), ML = subjectColor('Machine Learning')

function Bubble({ you, children }: { you?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex gap-2', you && 'justify-end')}>
      {!you && <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-nova/12 ring-1 ring-nova/25"><KivoMark size={11} className="text-nova-ink" /></span>}
      <p className={cn('max-w-[85%] text-[13px] leading-relaxed', you ? 'rounded-2xl rounded-br-md bg-action/15 px-3 py-2 text-foreground ring-1 ring-action/20' : 'text-foreground/85')}>{children}</p>
    </div>
  )
}

function Scene({ step }: { step: number }) {
  if (step === 0) return <Bubble you>My OS exam is on the 24th, and I want to learn ML on the side.</Bubble>
  if (step === 1) return (
    <div className="space-y-3">
      <Bubble you>My OS exam is on the 24th, and I want to learn ML on the side.</Bubble>
      <Bubble>Which parts of OS feel weakest right now? And about how many hours a week do you have?</Bubble>
      <div className="ml-8 flex flex-wrap gap-1.5" aria-hidden>{['Deadlocks', 'Memory', 'About 6 h'].map(c => <span key={c} className="rounded-full border border-nova/30 bg-nova/[0.06] px-2.5 py-1 text-[11px] text-foreground/80">{c}</span>)}</div>
    </div>
  )
  if (step === 2) return (
    <div className="space-y-2.5">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-300/10 px-2.5 py-0.5 text-[11px] text-amber-200">Proposal · not created yet</p>
      {[{ s: 'Operating Systems', c: OS, t: ['Processes', 'Deadlocks', 'Virtual memory'] }, { s: 'Machine Learning', c: ML, t: ['Linear regression', 'Gradient descent'] }].map((g, i) => (
        <motion.div key={g.s} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.15 }} className={cn('rounded-xl border bg-card/60 p-3', g.c.border)}>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><span aria-hidden className={cn('size-2 rounded-full', g.c.dot)} />{g.s}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{g.t.map(t => <span key={t} className="rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-foreground/75">{t}</span>)}</div>
        </motion.div>
      ))}
      <p className="inline-flex items-center gap-1.5 text-[11px] text-foreground/60"><Flag aria-hidden className="size-3 text-nova" /> Exam date: the 24th</p>
    </div>
  )
  if (step === 3) {
    const nodes = [
      { x: 70, y: 70, l: 'Operating Systems', big: true }, { x: 210, y: 30, l: 'Processes' }, { x: 210, y: 80, l: 'Deadlocks' }, { x: 210, y: 130, l: 'Virtual memory' },
      { x: 350, y: 60, l: 'Banker’s algorithm', note: true }, { x: 350, y: 110, l: 'Problem set 3', task: true },
    ]
    const lines = [[0, 1], [0, 2], [0, 3], [2, 4], [2, 5]]
    return (
      <svg viewBox="0 0 430 160" className="h-auto w-full" role="img" aria-label="Operating Systems joined to its topics; a note and a task joined to Deadlocks">
        {lines.map(([a, b], i) => <motion.line key={i} x1={nodes[a!]!.x} y1={nodes[a!]!.y} x2={nodes[b!]!.x} y2={nodes[b!]!.y} stroke="var(--map-line)" strokeWidth={1.4} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.1 + i * 0.12 }} />)}
        {nodes.map((n, i) => (
          <motion.g key={n.l} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.1 }}>
            <rect x={n.x - (n.big ? 62 : 52)} y={n.y - 14} width={n.big ? 124 : 104} height={28} rx={n.task ? 7 : n.note ? 9 : 12} fill="var(--card)" stroke={n.big ? 'oklch(74% 0.14 237 / 0.5)' : 'var(--border)'} />
            {n.note && <circle cx={n.x - 42} cy={n.y} r={3} fill="var(--map-note)" />}
            {n.task && <rect x={n.x - 45} y={n.y - 4} width={8} height={8} rx={2} fill="none" stroke="var(--map-task)" />}
            <text x={n.note || n.task ? n.x + 6 : n.x} y={n.y + 4} textAnchor="middle" fontSize={10.5} className="fill-foreground">{n.l}</text>
          </motion.g>
        ))}
      </svg>
    )
  }
  if (step === 4) return (
    <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
      <div className="rounded-xl border border-white/8 bg-card/50 p-3 text-[12px] leading-relaxed text-foreground/80">
        <p className="font-serif text-base font-semibold text-foreground">Deadlocks</p>
        <p className="mt-1 rounded bg-sky-400/15 ring-1 ring-sky-400/40">Each process holds a resource and waits for one another process holds.</p>
        <p className="mt-1.5 text-foreground/60">Four conditions: mutual exclusion, hold and wait…</p>
      </div>
      <div className="space-y-2 text-[12px]">
        <p className="inline-flex items-center gap-1.5 text-foreground/60"><BookOpen aria-hidden className="size-3.5" /> Tutor</p>
        <p className="text-foreground/85">A loop of waiting: every process holds what the next one needs.</p>
        <p className="inline-flex rounded-full border border-nova/40 bg-nova/[0.07] px-2 py-0.5 text-[10.5px] text-nova-ink">From your notes · Deadlocks</p>
      </div>
    </div>
  )
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">Your flow for today</p>
      {[{ t: 'Deadlocks', s: 'Operating Systems', c: OS, m: '40 min' }, { t: 'Problem set 3', s: 'Operating Systems', c: OS, m: '30 min' }, { t: 'Gradient descent', s: 'Machine Learning', c: ML, m: '30 min' }].map((r, i) => (
        <motion.div key={r.t} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }} className="relative flex items-center gap-3 rounded-xl border border-white/8 bg-card/70 py-2 pl-4 pr-2">
          <span aria-hidden className={cn('absolute inset-y-2 left-1.5 w-1 rounded-full', r.c.bar)} />
          <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-foreground">{r.t}</p><p className={cn('text-[10.5px]', r.c.text)}>{r.s}</p></div>
          {i === 0 ? <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-action px-2 text-[11px] font-semibold text-action-foreground"><Play aria-hidden className="size-3 fill-current" /> Start · {r.m}</span> : <span className="text-[11px] text-foreground/55">{r.m}</span>}
        </motion.div>
      ))}
      <p className="inline-flex items-center gap-1.5 text-[11px] text-nova-ink"><Check aria-hidden className="size-3" /> Applied by you · saved</p>
    </div>
  )
}

function useWide() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)')
    const on = () => setWide(q.matches)
    on(); q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return wide
}

export function LandingHero() {
  const s = useStory(STEPS.length, 3800)
  const robot = useWide()
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:pt-32" style={{ background: '#060810' }} aria-labelledby="hero-title">
      {!s.reduced && (
        <SparklesCore id="hero-sparkles" background="transparent" particleColor="#00E5A0" particleDensity={18} minSize={0.3} maxSize={1.1} speed={0.6}
          className="pointer-events-none absolute inset-0 h-full w-full" />
      )}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,229,160,0.12),transparent)]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
        <div className="space-y-7">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#00E5A0]/25 bg-[#00E5A0]/[0.06] px-4 py-1.5 text-sm font-semibold text-[#00E5A0]">
            <KivoMark size={14} /> An AI-powered learning OS
          </p>
          <h1 id="hero-title" className="text-5xl font-black leading-[1.04] tracking-tight text-[#e8eaf0] md:text-6xl lg:text-[4.2rem]">
            Turn what you learn into <span className="text-[#00E5A0]">what you know.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-slate-400">
            Build your learning system, connect your knowledge, study your sources and shape your day with Nova, all in one workspace. You decide; Nova asks, suggests and waits for your yes.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="font-bold text-slate-950 transition-transform hover:scale-[1.02]" style={{ background: '#00E5A0', boxShadow: '0 0 24px rgba(0,229,160,0.25)' }}>
              <AuthAwareLink>Start building with Kivo <ArrowRight aria-hidden className="ml-1 size-4" /></AuthAwareLink>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/15 bg-transparent text-slate-200 hover:bg-white/5 hover:text-white">
              <a href="#how-it-works">Explore how it works</a>
            </Button>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
            {['Free to start', 'In your browser', 'Nova on Telegram too'].map(t => (
              <li key={t} className="flex items-center gap-2"><span aria-hidden className="size-1.5 rounded-full bg-[#00E5A0]" />{t}</li>
            ))}
          </ul>
        </div>

        <div ref={s.ref} className="relative" id="tour">
          {robot && (
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 z-0 h-72 w-72 opacity-90" style={{ animation: 'botFloat 7s ease-in-out infinite' }}>
              <SplineBot className="h-full w-full" />
            </div>
          )}
          <div className="relative z-10">
            <AppWindow label="Kivo · a quick tour" className="h-[23rem]">
              <div className="flex h-full flex-col">
                <div className="min-h-0 flex-1 overflow-hidden px-5 py-5" aria-live="polite">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={s.step} initial={s.reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={s.reduced ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>
                      <Scene step={s.step} />
                    </motion.div>
                  </AnimatePresence>
                </div>
                <p className="shrink-0 border-t border-white/6 px-5 py-3 text-[13px] text-foreground/75" data-hero-caption>{CAPTIONS[s.step]}</p>
              </div>
            </AppWindow>
            <StoryControls className="mt-4" count={STEPS.length} step={s.step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={STEPS} />
          </div>
        </div>
      </div>
      <style>{`@keyframes botFloat { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }`}</style>
    </section>
  )
}

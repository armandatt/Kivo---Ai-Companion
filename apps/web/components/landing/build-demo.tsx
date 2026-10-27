'use client'

// Build with Nova, on the landing page: the order the real conversation
// keeps (product/builder.ts, builder-conversation.ts). Nova asks before it
// drafts, drafts only when asked, adds no tasks unless asked, shows each
// change as a new version, and nothing exists until the learner presses
// Approve and build. A scripted sample: local state, no model, no request.

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleDot, Flag, Loader2, Sparkles } from 'lucide-react'
import { KioMark } from '@/components/brand/kio-brand'
import { cn } from '@/lib/utils'
import { AppWindow, StoryControls, useStory } from './frame'

type Turn = { who: 'you' | 'nova'; text: string; choices?: string[] }
const TURNS: Turn[][] = [
  [{ who: 'you', text: 'I start a data science internship in three months. I know Python, not much ML.' }],
  [{ who: 'nova', text: 'What will the work be mostly: building models, or analysing data? And how much time can you give it each week?', choices: ['Mostly models', 'Mostly analysis', 'Both'] }],
  [{ who: 'you', text: 'Mostly models. About 8 hours a week.' }, { who: 'nova', text: 'Got it: models first, 8 hours a week, 12 weeks. Want me to draft a roadmap now? I’ll leave tasks out unless you ask for them.' }],
  [{ who: 'you', text: 'Yes, draft it.' }],
  [{ who: 'you', text: 'Add a mock interview at the end of each month.' }],
  [],
  [],
]
const LABELS = ['Your goal', 'Nova asks', 'More context', 'A draft, on request', 'You refine it', 'You approve', 'It’s yours']

type Item = { name: string; added?: boolean }
type Milestone = { name: string; weeks: string; topics: Item[] }
const V1: Milestone[] = [
  { name: 'Month 1 · Foundations', weeks: '4 wk', topics: [{ name: 'NumPy and pandas' }, { name: 'Linear regression' }, { name: 'Gradient descent' }] },
  { name: 'Month 2 · Models', weeks: '4 wk', topics: [{ name: 'Trees and ensembles' }, { name: 'Model evaluation' }] },
  { name: 'Month 3 · Project', weeks: '4 wk', topics: [{ name: 'End-to-end project' }] },
]
const V2: Milestone[] = V1.map(m => ({ ...m, topics: [...m.topics, { name: 'Mock interview', added: true }] }))

export function BuildDemo() {
  const s = useStory(LABELS.length, 3600)
  const step = s.step
  const turns = TURNS.slice(0, step + 1).flat()
  const version = step >= 4 ? 2 : step >= 3 ? 1 : 0
  const plan = version === 2 ? V2 : V1
  const state: 'none' | 'proposal' | 'building' | 'saved' = step === 5 ? 'building' : step >= 6 ? 'saved' : version ? 'proposal' : 'none'
  // Building takes a moment in the app too; then the workspace is there.
  const { go } = s
  useEffect(() => { if (step !== 5) return; const t = window.setTimeout(() => go(6), 1400); return () => window.clearTimeout(t) }, [step, go])

  return (
    <div ref={s.ref} className="space-y-4">
      <AppWindow label="Kio · Build with Nova" className="h-[42rem] md:h-[34rem]">
        <div className="grid h-full md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* The conversation */}
          <section aria-label="The conversation" className="flex min-h-0 flex-col border-white/6 max-md:h-[17rem] md:border-r">
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden px-5 py-5" aria-live="polite">
              <AnimatePresence initial={false}>
                {turns.map((t, i) => (
                  <motion.div key={i} layout={!s.reduced} initial={s.reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className={cn('flex gap-2.5', t.who === 'you' && 'justify-end')}>
                    {t.who === 'nova' && <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-nova/12 ring-1 ring-nova/25"><KioMark size={11} className="text-nova-ink" /></span>}
                    <div className={cn('max-w-[85%] text-[14px] leading-relaxed', t.who === 'you' ? 'rounded-2xl rounded-br-md bg-action/15 px-3 py-2 text-foreground ring-1 ring-action/20' : 'text-foreground/85')}>
                      <span className="sr-only">{t.who === 'you' ? 'You: ' : 'Nova: '}</span>{t.text}
                      {t.choices && (
                        <span className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
                          {t.choices.map(c => <span key={c} className={cn('rounded-full border px-2.5 py-1 text-[11px]', c === 'Mostly models' && step >= 2 ? 'border-nova/60 bg-nova/12 text-foreground' : 'border-nova/25 text-foreground/70')}>{c}</span>)}
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <div className="shrink-0 border-t border-white/6 px-4 py-3 text-[11px] text-foreground/50">You can attach a syllabus PDF or a photo, and ask Nova about it, before anything is drafted.</div>
          </section>

          {/* The playground: the proposal, then the workspace */}
          <section aria-label="The proposal" className="relative min-h-0 overflow-hidden px-6 py-5">
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                state === 'saved' ? 'bg-nova/15 text-nova-ink' : state === 'none' ? 'bg-white/5 text-foreground/50' : 'bg-amber-300/10 text-amber-200')} data-build-state={state}>
                {state === 'saved' ? <><Check aria-hidden className="size-3" /> Created in your account</>
                  : state === 'building' ? <><Loader2 aria-hidden className={cn('size-3', !s.reduced && 'animate-spin')} /> Building</>
                  : state === 'proposal' ? <><CircleDot aria-hidden className="size-3" /> Proposal · Version {version} · not created yet</>
                  : 'Nothing drafted yet'}
              </span>
            </div>
            {state === 'none' ? (
              <div className="mt-10 max-w-xs text-sm leading-relaxed text-foreground/55">
                Nova asks what it needs first. It drafts when you ask it to, and the draft appears here, not in your account.
              </div>
            ) : (
              <motion.div initial={s.reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="subject-tone mt-4 rounded-2xl border border-white/8 bg-card/60 p-4" style={{ ['--sh' as string]: 237 }}>
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><span aria-hidden className="size-2.5 rounded-full bg-[var(--sc)]" /> Data Science Internship <span className="font-normal text-subtle">· 8 h a week</span></p>
                <ol className="mt-3 space-y-2.5">
                  {plan.map((m, i) => (
                    <motion.li key={m.name} initial={s.reduced ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: s.reduced ? 0 : 0.1 + i * 0.12 }}>
                      <p className="flex items-center gap-2 text-[14px] font-medium text-foreground/90"><Flag aria-hidden className="size-3.5 text-nova" />{m.name}<span className="text-[11px] font-normal text-subtle">≈ {m.weeks}</span></p>
                      <ul className="ml-5 mt-1 flex flex-wrap gap-1.5">
                        {m.topics.map(t => (
                          <motion.li key={t.name} initial={t.added && !s.reduced ? { opacity: 0, scale: 0.9 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: t.added ? 0.15 + i * 0.12 : 0 }}
                            className={cn('rounded-lg border px-2 py-0.5 text-[12px]', t.added ? 'border-nova/50 bg-nova/10 text-nova-ink' : 'border-white/10 text-foreground/70')}>
                            {t.added && <span className="sr-only">Added in version 2: </span>}{t.name}
                          </motion.li>
                        ))}
                      </ul>
                    </motion.li>
                  ))}
                </ol>
                <p className="mt-3 border-t border-white/6 pt-3 text-[11px] text-foreground/55">Date: internship starts in 12 weeks · No tasks (you didn’t ask for any)</p>
              </motion.div>
            )}
            {version === 2 && state === 'proposal' && <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-nova-ink"><Sparkles aria-hidden className="size-3" /> Version 2: added Mock interview to each month</p>}
            {state !== 'none' && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" disabled={state !== 'proposal'} onClick={() => s.go(5)} data-build-approve
                  className={cn('inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action)]', state === 'proposal' ? 'bg-action text-action-foreground hover:bg-action-hover' : 'bg-white/6 text-foreground/50', step === 5 && 'ring-2 ring-nova/60')}>
                  <Check aria-hidden className="size-3.5" /> Approve and build
                </button>
                <span className="text-[11px] text-foreground/50">{state === 'saved' ? 'Subjects, topics and the date are now on your Knowledge Map and calendar. Come back to refine it any time.' : 'Edit anything here, or tell Nova what to change.'}</span>
              </div>
            )}
          </section>
        </div>
      </AppWindow>
      <StoryControls count={LABELS.length} step={step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={LABELS} />
    </div>
  )
}

'use client'

// Nova for Chrome, on the landing page: a passage selected on an article,
// the popup opened from the toolbar, the passage saved under a subject and a
// topic, a question asked about it, and the passage in Saved. The popup's
// words are the extension's own (apps/extension/src/popup.js: "Save to Nova",
// "Study this", "Save selection", "Ask Nova", "Passage saved."); the article
// and Nova's answer are written here and labelled as a sample. It shows what
// version 1.0.0 does. Local state only: no extension, no request.

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, Lock, Puzzle, Quote, RotateCw } from 'lucide-react'
import { KivoMark } from '@/components/brand/kivo-brand'
import { cn } from '@/lib/utils'
import { StoryControls, Typed, useStory } from './frame'

const STEPS = ['You select a passage', 'Open Nova', 'Save it', 'Ask about it', 'It’s in Saved']
const PASSAGE = 'Dividing by √d keeps the dot products from growing with the dimension, so the softmax doesn’t saturate and the gradients stay useful.'
const QUESTION = 'Why does saturating the softmax hurt?'
const ANSWER = 'A saturated softmax puts almost all its weight on one key, so its gradient is close to zero and the model barely learns from that step. Scaling keeps the scores in a range where the gradient still flows.'

const enter = { initial: { opacity: 0, y: -6, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -4, scale: 0.98 }, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const } }

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-white/45">{label}</span>
      <span className="mt-1 flex h-8 items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[12px] text-white/90">{value}<ChevronDown aria-hidden className="size-3.5 text-white/40" /></span>
    </span>
  )
}

export function ExtensionDemo() {
  const s = useStory(STEPS.length, 2600)
  const step = s.step
  const popup = step >= 1 && step <= 3
  const selected = step >= 0 && step <= 3

  return (
    <div ref={s.ref} className="space-y-4">
      <div className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#0b0c12] shadow-[0_40px_120px_-40px_rgba(0,229,160,0.25),0_0_0_1px_rgba(255,255,255,0.02)]" data-extension-demo data-step={step}>
        {/* The browser's own bar */}
        <div className="flex h-11 items-center gap-2 border-b border-white/6 bg-[#12141c] px-3 sm:px-4">
          <span aria-hidden className="flex gap-1.5 max-sm:hidden"><span className="size-2.5 rounded-full bg-white/12" /><span className="size-2.5 rounded-full bg-white/12" /><span className="size-2.5 rounded-full bg-white/12" /></span>
          <span aria-hidden className="flex gap-2 text-white/35 sm:ml-2"><ArrowLeft className="size-3.5" /><ArrowRight className="size-3.5" /><RotateCw className="size-3.5" /></span>
          <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/[0.05] px-3 text-[12px] text-white/60">
            <Lock aria-hidden className="size-3 shrink-0" /><span className="truncate">learning-notes.example/attention-explained</span>
          </span>
          <span className={cn('relative grid size-7 place-items-center rounded-lg transition-colors duration-200', popup ? 'bg-[#00E5A0]/20 ring-1 ring-[#00E5A0]/60' : 'bg-white/[0.05]')} title="Nova">
            <KivoMark size={13} className="text-[#7ef5cf]" />
            {step === 1 && !s.reduced && <span aria-hidden className="absolute inset-0 animate-ping rounded-lg ring-2 ring-[#00E5A0]/50" />}
            <span className="sr-only">Nova, in the toolbar</span>
          </span>
          <Puzzle aria-hidden className="size-4 text-white/30 max-sm:hidden" />
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">Sample</span>
        </div>

        <div className="relative h-[34rem] overflow-hidden bg-[#f6f4ef] md:h-[30rem]">
          {/* The article */}
          <article className="max-w-2xl px-6 py-8 text-[#25262b] sm:px-10 md:mr-[22rem] lg:ml-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a7f6a]">Transformers, slowly</p>
            <h3 className="mt-2 font-serif text-2xl font-semibold leading-tight sm:text-3xl">Why attention divides by √d</h3>
            <p className="mt-4 text-[14px] leading-relaxed text-[#4a4b52]">Scaled dot-product attention compares every query with every key. The scores go through a softmax to become weights, and the weights mix the values.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-[#4a4b52]">
              <span className={cn('bg-[linear-gradient(rgba(0,229,160,0.35),rgba(0,229,160,0.35))] bg-no-repeat transition-[background-size] duration-700 ease-out', selected ? '[background-size:100%_100%]' : '[background-size:0%_100%]')}>{PASSAGE}</span>{' '}
              Without it, a larger model would need a smaller learning rate just to keep attention from collapsing onto one token.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-[#4a4b52] max-md:hidden">The same idea turns up again in normalisation layers: keep the numbers in the range where learning still works.</p>
          </article>

          {/* The popup */}
          <AnimatePresence>
            {popup && (
              <motion.div key="popup" {...enter} style={{ transformOrigin: 'top right' }}
                className="kivo-dark absolute right-3 top-3 z-20 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-white/10 bg-[#0e1017] p-3.5 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] sm:right-4">
                <p className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-6 place-items-center rounded-lg bg-[#00E5A0]/15"><KivoMark size={11} className="text-[#7ef5cf]" /></span>Nova</p>
                <p className="mt-2 truncate text-[12px] text-white/60">Why attention divides by √d</p>
                <div className="mt-3 grid grid-cols-2 gap-2"><Field label="Subject" value="Machine Learning" /><Field label="Topic" value="Attention" /></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-semibold">
                  <span className="col-span-2 inline-flex h-9 items-center justify-center rounded-xl bg-[#00E5A0] text-[#04130e]">Save to Nova</span>
                  <span className="inline-flex h-9 items-center justify-center rounded-xl border border-white/12 text-white/85">Study this</span>
                  <span className={cn('inline-flex h-9 items-center justify-center gap-1 rounded-xl border transition-colors duration-200', step >= 2 ? 'border-[#00E5A0]/60 bg-[#00E5A0]/15 text-[#7ef5cf]' : 'border-white/12 text-white/85')}>
                    {step >= 2 && <Check aria-hidden className="size-3.5" />}Save selection
                  </span>
                </div>
                <AnimatePresence>
                  {step >= 2 && <motion.p key="saved" initial={s.reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="mt-2 text-[12px] text-[#7ef5cf]" role="status">Passage saved.</motion.p>}
                </AnimatePresence>
                <div className="mt-3 border-t border-white/8 pt-3">
                  <p className="text-[12px] font-semibold text-white/80">Ask Nova</p>
                  <span className="mt-1.5 block min-h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90">
                    {step >= 3 ? <Typed text={QUESTION} /> : <span className="text-white/35">Ask about this page</span>}
                  </span>
                  <AnimatePresence>
                    {step === 3 && (
                      <motion.p key="answer" initial={s.reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: s.reduced ? 0 : 0.3 }} className="mt-2 text-[12px] leading-relaxed text-white/75">
                        <Typed text={ANSWER} />
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Saved, in Kivo */}
          <AnimatePresence>
            {step === 4 && (
              <motion.div key="saved-list" initial={s.reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="kivo-dark absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-white/10 bg-[#0e1017]/95 p-4 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[24rem]">
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50"><Bookmark aria-hidden className="size-3.5 text-[#7ef5cf]" />Kivo · Saved</p>
                <p className="mt-2 text-[12px] text-white/55">Machine Learning › Attention</p>
                <div className="mt-2 rounded-xl border border-[#00E5A0]/30 bg-[#00E5A0]/[0.06] p-3">
                  <p className="flex gap-2 text-[12.5px] leading-relaxed text-white/90"><Quote aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[#7ef5cf]" />{PASSAGE}</p>
                  <p className="mt-2 text-[11px] text-white/45">Why attention divides by √d · learning-notes.example</p>
                </div>
                <p className="mt-2.5 text-[11px] text-white/50">Next time you focus on Attention, it’s under “On this topic”.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <StoryControls count={STEPS.length} step={step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={STEPS} />
    </div>
  )
}

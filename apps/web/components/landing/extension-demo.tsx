'use client'

// Nova for Chrome, on the landing page: a doubt in the middle of a blog post,
// answered where it came up instead of copied into another tab, the passage
// kept under its topic, and the reader's own takeaway written into a note.
// The popup's words are the extension's own (apps/extension/src/popup.js:
// "Your selection", "Save selection", "Add to notes", "Ask Nova", the chips,
// "Passage saved."), and so is what it keeps: the passage and the page, never
// the answer (shown in the popup, kept nowhere), which is why the takeaway
// goes in a note ("Add to notes" opens Kivo's capture with the passage). The article is fictional, in the style of a blogging site,
// with no real site's name, drawn in a blog's dark reading mode so it sits
// in the page's own theme. Version 1.0.0. Local state only.

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, Copy, FileText, Hand, Lock, MessageCircle, MousePointer2, Puzzle, RotateCw, Share, X } from 'lucide-react'
import { KivoMark } from '@/components/brand/kivo-brand'
import { cn } from '@/lib/utils'
import { StoryControls, Typed, useStory } from './frame'

const STEPS = ['A doubt, mid-read', 'No copy-paste', 'Ask right there', 'Answered', 'Keep the passage', 'In your words', 'Found again']
const PASSAGE = 'We divide the scores by √d before the softmax, so they don’t grow with the dimension and the gradients stay useful.'
const QUESTION = 'why √d and not just d?'
const ANSWER = 'The dot of two random d-long vectors has a spread that grows like √d, not d. Dividing by √d brings it back to about 1: big enough to tell keys apart, small enough that the softmax doesn’t put everything on one key.'
const TAKEAWAY = 'My doubt: why √d? → the spread of q·k grows like √d, so this keeps scores ≈ 1 and the softmax from going all-in. Ask about LayerNorm in Friday’s class.'
const OLD_WAY = ['Copy', 'New tab', 'Paste', 'Explain the context again', 'Lost in a chat history']

const pop = { initial: { opacity: 0, y: -6, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -4, scale: 0.98 }, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const } }
const rise = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 10 }, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } }
const card = 'kivo-dark rounded-2xl border border-[#00E5A0]/25 bg-[#0b0d13] text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8),0_0_40px_-12px_rgba(0,229,160,0.25)]'

function Chip({ on, children }: { on?: boolean; children: string }) {
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', on ? 'border-[#00E5A0]/50 bg-[#00E5A0]/12 text-[#7ef5cf]' : 'border-white/10 text-white/50')}>{children}</span>
}

export function ExtensionDemo() {
  const s = useStory(STEPS.length, 2600)
  const step = s.step
  const popup = step >= 2 && step <= 4
  const marked = step <= 5

  return (
    <div ref={s.ref} className="space-y-4">
      <div className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#0b0c12] shadow-[0_40px_120px_-40px_rgba(0,229,160,0.25),0_0_0_1px_rgba(255,255,255,0.02)]" data-extension-demo data-step={step}>
        {/* The browser's bar */}
        <div className="flex h-11 items-center gap-2 border-b border-white/6 bg-[#12141c] px-3 sm:px-4">
          <span aria-hidden className="flex gap-1.5 max-sm:hidden"><span className="size-2.5 rounded-full bg-white/12" /><span className="size-2.5 rounded-full bg-white/12" /><span className="size-2.5 rounded-full bg-white/12" /></span>
          <span aria-hidden className="flex gap-2 text-white/35 sm:ml-2"><ArrowLeft className="size-3.5" /><ArrowRight className="size-3.5" /><RotateCw className="size-3.5" /></span>
          <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/[0.05] px-3 text-[12px] text-white/60">
            <Lock aria-hidden className="size-3 shrink-0" /><span className="truncate">deep-reads.example/@priya/attention-finally-makes-sense</span>
          </span>
          <span className={cn('relative grid size-7 place-items-center rounded-lg transition-colors duration-200', popup ? 'bg-[#00E5A0]/20 ring-1 ring-[#00E5A0]/60' : 'bg-white/[0.05]')} title="Nova">
            <KivoMark size={13} className="text-[#7ef5cf]" />
            {step === 2 && !s.reduced && <span aria-hidden className="absolute inset-0 animate-ping rounded-lg ring-2 ring-[#00E5A0]/50" />}
            <span className="sr-only">Nova, in the toolbar</span>
          </span>
          <Puzzle aria-hidden className="size-4 text-white/30 max-sm:hidden" />
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">Sample</span>
        </div>

        <div className="relative h-[36rem] overflow-hidden bg-[#121318] md:h-[33rem]">
          {/* The article, in a blog's dark reading mode */}
          <article className="max-w-[40rem] px-6 py-7 text-[#e8e8ea] sm:px-10 md:mr-[22rem] lg:ml-8">
            <h3 className="font-serif text-[1.65rem] font-bold leading-[1.15] tracking-tight sm:text-[2rem]">Attention finally makes sense</h3>
            <p className="mt-2 font-serif text-[15px] text-[#9a9ba3]">What the “scaled” in scaled dot-product attention is for.</p>
            <div className="mt-4 flex items-center gap-3 text-[13px]">
              <span aria-hidden className="size-8 rounded-full bg-gradient-to-br from-[#e8b48f] to-[#a8604c]" />
              <span><span className="font-medium">Priya R.</span> <span className="text-[#5fd39a]">· Follow</span><span className="block text-[#8b8c94]">8 min read · 3 days ago</span></span>
            </div>
            <div aria-hidden className="mt-4 flex items-center gap-4 border-y border-white/8 py-2 text-[#8b8c94]">
              <span className="flex items-center gap-1 text-[12px]"><Hand className="size-4" />2.1K</span>
              <span className="flex items-center gap-1 text-[12px]"><MessageCircle className="size-4" />48</span>
              <span className="flex-1" /><Bookmark className="size-4" /><Share className="size-4" />
            </div>
            <p className="mt-5 font-serif text-[16px] leading-[1.7] text-[#d4d5da]">Every query is compared with every key, and the scores become weights through a softmax.{' '}
              <span className={cn('bg-[linear-gradient(rgba(0,229,160,0.26),rgba(0,229,160,0.26))] bg-no-repeat transition-[background-size] duration-700 ease-out', marked ? '[background-size:100%_100%]' : '[background-size:0%_100%]')}>{PASSAGE}</span>
              {' '}That one line is the whole trick.
            </p>
            <p className="mt-4 font-serif text-[16px] leading-[1.7] text-[#d4d5da] max-sm:hidden">Without it, bigger models would need ever smaller learning rates just to keep attention from collapsing.</p>
          </article>

          {/* The old way, crossed out */}
          <AnimatePresence>
            {step === 1 && (
              <motion.div key="old" {...rise} className={cn(card, 'absolute inset-x-3 bottom-3 z-20 p-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:w-[20rem]')}>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">The usual way</p>
                <ol className="mt-3 space-y-1.5">
                  {OLD_WAY.map((w, i) => (
                    <motion.li key={w} initial={s.reduced ? false : { opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: s.reduced ? 0 : i * 0.08 }}
                      className="flex items-center gap-2 text-[13px] text-white/60">
                      {i === 0 ? <Copy aria-hidden className="size-3.5" /> : <X aria-hidden className="size-3.5 text-[#ff8a7a]" />}
                      <span className="relative">{w}<span aria-hidden className="ext-strike absolute left-0 top-1/2 h-px bg-[#ff8a7a]/80" style={{ animationDelay: `${0.5 + i * 0.12}s` }} /></span>
                    </motion.li>
                  ))}
                </ol>
                <p className="mt-3 border-t border-white/8 pt-3 text-[13px] font-medium text-[#7ef5cf]">With Nova: ask right where the doubt is.</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The popup */}
          <AnimatePresence mode="wait">
            {popup && (
              <motion.div key={step === 4 ? 'saved' : 'ready'} {...pop} style={{ transformOrigin: 'top right' }} className={cn(card, 'absolute right-3 top-3 z-20 w-[min(20.5rem,calc(100%-1.5rem))] p-3.5 sm:right-4')}>
                {step === 4 ? (
                  <>
                    <p className="flex items-center gap-2 text-[15px] font-semibold" role="status"><span className="grid size-6 place-items-center rounded-full bg-[#00E5A0]"><Check aria-hidden className="size-3.5 text-[#04130e]" /></span>Passage saved.</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/65">It is on your Saved list in Nova, with the page it came from.</p>
                    <div className="mt-3 rounded-xl bg-white/[0.05] p-3"><p className="text-[12px] font-medium">Attention finally makes sense</p><p className="mt-0.5 text-[11px] text-white/50">Machine Learning · Attention</p></div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-semibold">
                      <span className="inline-flex h-9 items-center justify-center rounded-xl bg-[#00E5A0] text-[#04130e]">Open saved pages</span>
                      <span className="inline-flex h-9 items-center justify-center rounded-xl border border-white/12 text-white/80">Back</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 place-items-center rounded-lg bg-white/90 text-[12px] font-bold text-[#121318]">D</span>
                      <span className="min-w-0"><span className="block text-[10px] text-white/45">deep-reads.example</span><span className="block truncate text-[12px] font-medium">Attention finally makes sense</span></span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                      {[['Subject', 'Machine Learning'], ['Topic', 'Attention']].map(([l, v]) => (
                        <span key={l}><span className="block text-[10px] text-white/45">{l}</span><span className="mt-0.5 flex h-7 items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-2 text-white/90">{v}<ChevronDown aria-hidden className="size-3 text-white/40" /></span></span>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] font-semibold text-white/80">Your selection</p>
                    <blockquote className="mt-1 line-clamp-2 border-l-2 border-[#00E5A0]/60 pl-2 text-[11px] leading-snug text-white/70">{PASSAGE}</blockquote>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold">
                      <span className="inline-flex h-8 items-center justify-center rounded-lg border border-white/12 text-white/85">Save selection</span>
                      <span className="inline-flex h-8 items-center justify-center rounded-lg border border-white/12 text-white/85">Add to notes</span>
                    </div>
                    <div className="mt-3 border-t border-white/8 pt-3">
                      <p className="text-[12px] font-semibold">Ask Nova</p>
                      <div className="mt-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-2">
                        <p className="min-h-4 text-[12px] text-white/90">{step === 2 ? <Typed text={QUESTION} /> : step === 3 ? <span className="text-white/35">What do you want to know?</span> : null}</p>
                        <div className="mt-2 flex items-center gap-1"><Chip>Title</Chip><Chip>Address</Chip><Chip on>Your selection</Chip><span className="flex-1" /><span className="rounded-lg bg-[#00E5A0] px-2.5 py-1 text-[11px] font-semibold text-[#04130e]">Ask</span></div>
                      </div>
                      {step === 3 && (
                        <motion.div initial={s.reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="mt-2.5 space-y-1.5" aria-live="polite">
                          <p className="text-[11px] text-white/55">You asked <strong className="font-semibold text-white/85">{QUESTION}</strong></p>
                          <p className="text-[12px] leading-relaxed text-white/90"><Typed text={ANSWER} /></p>
                          <p className="text-[10px] leading-snug text-white/45">Answered from your selection and what Nova knows of the subject. Nova has not read the rest of the page.</p>
                        </motion.div>
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* In Kivo: the note, then the topic */}
          <AnimatePresence mode="wait">
            {step === 5 && (
              <motion.div key="note" {...rise} className={cn(card, 'absolute inset-x-3 bottom-3 z-20 p-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:w-[23rem]')}>
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50"><FileText aria-hidden className="size-3.5 text-[#7ef5cf]" />Kivo · New note</p>
                <p className="mt-2 rounded-lg bg-[#00E5A0]/[0.07] px-2.5 py-1.5 text-[11px] text-white/65">Sent from the Nova extension. Check it, then save.</p>
                <p className="mt-3 text-[15px] font-semibold">Why √d? (from Priya’s post)</p>
                <blockquote className="mt-2 border-l-2 border-white/25 pl-2.5 text-[12px] leading-relaxed text-white/70">{PASSAGE}<span className="mt-1 block text-[10px] text-white/40">deep-reads.example</span></blockquote>
                <p className="mt-3 text-[13px] leading-relaxed text-white/95"><Typed text={TAKEAWAY} /><span aria-hidden className="ext-caret ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-[#7ef5cf]" /></p>
                <p className="mt-3 text-[11px] text-white/45">Filed under Machine Learning › Attention</p>
              </motion.div>
            )}
            {step === 6 && (
              <motion.div key="later" {...rise} className={cn(card, 'absolute inset-x-3 bottom-3 z-20 p-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:w-[23rem]')}>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">Friday · focusing on Attention</p>
                <p className="mt-1 text-[13px] font-semibold">On this topic</p>
                <ul className="mt-2.5 space-y-2 text-[12px]">
                  {[
                    { icon: FileText, title: 'Why √d? (from Priya’s post)', kind: 'Your note' },
                    { icon: Bookmark, title: 'Attention finally makes sense', kind: 'Saved page' },
                  ].map((r, i) => (
                    <motion.li key={r.kind} initial={s.reduced ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, delay: s.reduced ? 0 : 0.1 + i * 0.08 }}
                      className="flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2">
                      <r.icon aria-hidden className="size-4 shrink-0 text-[#7ef5cf]" />
                      <span className="min-w-0 flex-1 truncate text-white/90">{r.title}</span>
                      <span className="shrink-0 text-[10px] text-white/45">{r.kind}</span>
                    </motion.li>
                  ))}
                </ul>
                <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#7ef5cf]"><MousePointer2 aria-hidden className="size-3.5" />Your doubt and what clicked, right where you’ll study it.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <StoryControls count={STEPS.length} step={step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={STEPS} />
    </div>
  )
}

'use client'

// Notes, on the landing page: a note beside Nova, in the two jobs Nova has
// there (notes/nova-tutor.tsx and nova-editor.tsx), as one short story the
// visitor can play or step through. They read the note, select a passage
// (the app's Ask Nova button appears on a selection), ask; the passage stays
// lit while the Tutor explains, its answer says which part of the note it
// came from ("From your notes", which lights that part) and what did not
// ("Beyond your notes"), and it changes nothing. Then the Editor proposes a
// change, shown before it is applied, with Undo. Both panes keep their size
// throughout. Then a paper import, the way the import dialog goes
// (paper-import-dialog). All of it is a scripted sample in local state: no
// model, no request.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BookOpen, BookOpenText, Check, FileText, Pencil, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { KioMark } from '@/components/brand/kio-brand'
import { cn } from '@/lib/utils'
import { AppWindow, ReplayButton, StoryControls, useStory } from './frame'

const SUMMARY = 'A deadlock is a loop of processes, each holding what the next one needs. It takes all four conditions at once, so breaking any one prevents it.'
const PASSAGE = 'A deadlock happens when each process in a set holds a resource and waits for one that another process in the set holds, so none of them can go on.'
const LABELS = ['Read', 'Select a passage', 'Ask the Tutor', 'Nova explains', 'The Editor proposes', 'Applied']
const CONDITIONS = [
  ['Mutual exclusion', 'a resource is held by one process at a time.'],
  ['Hold and wait', 'a process keeps what it has while it asks for more.'],
  ['No preemption', 'nothing can be taken from a process.'],
  ['Circular wait', 'each process waits for the next, in a loop.'],
]
const EASE = [0.22, 1, 0.36, 1] as const

export function NotesDemo() {
  const s = useStory(LABELS.length, 3800)
  const reduced = useReducedMotion()
  const step = s.step
  const [flash, setFlash] = useState(false)
  const [discarded, setDiscarded] = useState(false)
  useEffect(() => { setDiscarded(false) }, [step])
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(false), 1600); return () => window.clearTimeout(t) }, [flash])

  const mode = step >= 4 ? 'editor' : 'tutor'
  const selected = step >= 1 && step <= 3
  const listLit = step === 3 || flash
  const applied = step >= 5
  const fade = (y = 8) => (reduced ? { initial: false as const } : { initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, ease: EASE } })

  const note = (
    <article className="h-full overflow-y-auto px-6 py-6 sm:px-9 sm:py-8" aria-label="The note: Deadlocks">
      <p className="text-xs font-medium text-sky-300">Operating Systems <span className="text-foreground/35">/</span> Deadlocks</p>
      <h3 className="mt-1.5 font-serif text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">Deadlocks</h3>
      <AnimatePresence initial={false}>
        {applied && (
          <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reduced ? undefined : { opacity: 0, height: 0 }} transition={{ duration: 0.5, ease: EASE }}
            className="overflow-hidden" data-notes-demo-summary>
            <div className="mt-4 rounded-lg border-l-2 border-nova/60 bg-nova/[0.07] px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground/90">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-nova-ink">Summary</span>{SUMMARY}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative mt-4">
        <AnimatePresence>
          {step === 1 && (
            <motion.button type="button" onClick={() => s.go(2)} data-notes-demo-ask
              initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0 }} transition={{ duration: 0.3 }}
              className="absolute -top-9 left-6 z-10 inline-flex h-8 items-center gap-1.5 rounded-lg bg-popover px-3 text-xs font-semibold text-foreground shadow-float ring-1 ring-white/12 hover:ring-nova/50">
              <KioMark size={11} className="text-nova-ink" /> Ask Nova
            </motion.button>
          )}
        </AnimatePresence>
        <p className={cn('rounded-md text-[15px] leading-[1.75] text-foreground/85 transition-[background-color,box-shadow] duration-500', selected && 'bg-sky-400/15 ring-1 ring-sky-400/40')} data-notes-demo-passage data-selected={selected || undefined}>
          {PASSAGE}
        </p>
      </div>
      <h4 className="mt-6 text-[15px] font-semibold text-foreground">Four conditions</h4>
      <ul className={cn('-mx-2 mt-2 space-y-1.5 rounded-lg px-2 py-1.5 text-[15px] leading-relaxed text-foreground/80 transition-[background-color,box-shadow] duration-500', listLit && 'bg-nova/10 ring-1 ring-nova/45')} data-notes-demo-conditions>
        {CONDITIONS.map(([t, d]) => <li key={t} className="flex gap-2"><span aria-hidden className="mt-[0.7em] size-1 shrink-0 rounded-full bg-foreground/40" /><span><strong className="font-semibold text-foreground/90">{t}</strong>: {d}</span></li>)}
      </ul>
      <h4 className="mt-6 text-[15px] font-semibold text-foreground">Handling it</h4>
      <p className="mt-2 text-[15px] leading-[1.75] text-foreground/80">
        Prevention breaks one condition. Avoidance, like the <span className="text-[var(--action-ink)] underline decoration-dotted underline-offset-4">Banker’s algorithm</span>, grants a request only if the system stays in a safe state. Detection lets it happen, then recovers.
      </p>
    </article>
  )

  const tutor = (
    <div className="space-y-4">
      {step === 0 && (
        <motion.div {...fade()} className="pt-6 text-center">
          <span aria-hidden className="mx-auto grid size-10 place-items-center rounded-xl bg-nova/10 ring-1 ring-nova/25"><BookOpen className="size-4 text-nova-ink" /></span>
          <p className="mt-3 text-[15px] font-medium text-foreground">Learn from this note</p>
          <p className="mx-auto mt-1 max-w-[16rem] text-[13px] text-foreground/60">Select a passage and ask. The Tutor explains from your own words, and changes nothing.</p>
          <button type="button" onClick={() => s.go(1)} className="mt-4 inline-flex h-8 items-center rounded-lg border border-white/12 px-3 text-xs text-foreground/85 hover:bg-white/5" data-notes-demo-select>Select the first paragraph</button>
        </motion.div>
      )}
      {step === 1 && <motion.p {...fade()} className="pt-6 text-center text-[13px] text-foreground/60">Passage selected. Press <strong className="font-semibold text-foreground">Ask Nova</strong> above it.</motion.p>}
      {step >= 2 && (
        <motion.div {...fade()} className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-action/15 px-3.5 py-2.5 text-[14px] text-foreground ring-1 ring-action/20">
          <span className="mb-1.5 block border-l-2 border-sky-400/60 pl-2 text-[12px] leading-snug text-foreground/60 line-clamp-2">{PASSAGE}</span>
          Explain this simply.
        </motion.div>
      )}
      {step === 2 && (
        <motion.p {...fade(4)} className="inline-flex items-center gap-2 text-[13px] text-foreground/60">
          <span aria-hidden className="flex gap-1">{[0, 1, 2].map(i => <span key={i} className={cn('size-1.5 rounded-full bg-nova/70', !reduced && 'animate-pulse')} style={{ animationDelay: `${i * 150}ms` }} />)}</span>
          Reading your note
        </motion.p>
      )}
      {step >= 3 && (
        <motion.div {...fade()} className="space-y-3 text-[14px] leading-relaxed text-foreground/85" data-notes-demo-answer>
          <div className="flex gap-2.5">
            <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-nova/12 ring-1 ring-nova/25"><KioMark size={11} className="text-nova-ink" /></span>
            <p>Every process is holding something and waiting for something else, so nobody moves. It only happens when all four conditions in your note hold at once; break one and it can’t.</p>
          </div>
          <button type="button" onClick={() => setFlash(true)} className="ml-8 inline-flex items-center gap-1.5 rounded-full border border-nova/40 bg-nova/[0.07] px-2.5 py-1 text-[12px] text-nova-ink hover:bg-nova/15" data-notes-demo-source>
            <FileText aria-hidden className="size-3" /> From your notes · Four conditions
          </button>
          <div className="ml-8 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5 text-[13px] text-foreground/75">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200">Beyond your notes</span>
            Four people at a round table, each holding one fork and waiting for the fork on their left.
          </div>
        </motion.div>
      )}
    </div>
  )

  const editor = (
    <div className="space-y-4">
      <motion.p {...fade()} className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-action/15 px-3.5 py-2.5 text-[14px] text-foreground ring-1 ring-action/20">Add a short summary at the top.</motion.p>
      <motion.div {...fade()} className="rounded-xl border border-white/8 bg-card/60 p-3.5" data-notes-demo-change>
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-subtle"><Plus aria-hidden className="size-3 text-nova" /> Add · at the top of the note</p>
        <p className="mt-2 rounded-md border-l-2 border-nova/50 bg-nova/[0.06] px-3 py-2 text-[13.5px] leading-relaxed text-foreground/90">{SUMMARY}</p>
        {applied ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-nova-ink"><Check aria-hidden className="size-3.5" /> Applied and saved.
            <button type="button" onClick={() => s.go(4)} className="inline-flex items-center gap-1 font-medium hover:underline" data-notes-demo-undo><Undo2 aria-hidden className="size-3" /> Undo</button></p>
        ) : discarded ? (
          <p className="mt-3 text-[13px] text-foreground/60">Discarded. Your note is as it was. <button type="button" onClick={() => setDiscarded(false)} className="text-[var(--action-ink)] hover:underline">Show it again</button></p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => s.go(5)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-notes-demo-apply><Check aria-hidden className="size-3.5" /> Apply</button>
            <button type="button" onClick={() => { s.go(4); setDiscarded(true) }} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-subtle hover:text-foreground"><Trash2 aria-hidden className="size-3.5" /> Discard</button>
          </div>
        )}
      </motion.div>
    </div>
  )

  return (
    <div ref={s.ref} className="space-y-4">
      <AppWindow label="Kio · Notes" className="h-[50rem] md:h-[38rem]">
        <div className="grid h-full md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-h-0 border-white/6 max-md:h-[24rem] max-md:border-b md:border-r">{note}</div>
          <section className="flex min-h-0 flex-col bg-white/[0.015]" aria-label="Nova beside the note">
            <div className="flex shrink-0 items-center gap-2 border-b border-white/6 px-4 py-2.5">
              <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-nova/12 ring-1 ring-nova/25"><KioMark size={12} className="text-nova-ink" /></span>
              <div role="tablist" aria-label="Nova's two jobs" className="inline-flex rounded-lg border border-white/8 p-0.5">
                {(['tutor', 'editor'] as const).map(m => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => s.go(m === 'tutor' ? 3 : 4)} data-notes-demo-mode={m}
                    className={cn('relative inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors', mode === m ? 'text-foreground' : 'text-foreground/55 hover:text-foreground')}>
                    {mode === m && <motion.span layoutId="notes-demo-tab" aria-hidden className="absolute inset-0 rounded-md bg-white/10" transition={{ duration: reduced ? 0 : 0.3, ease: EASE }} />}
                    <span className="relative inline-flex items-center gap-1.5">{m === 'tutor' ? <BookOpen aria-hidden className="size-3.5" /> : <Pencil aria-hidden className="size-3.5" />}{m === 'tutor' ? 'Tutor' : 'Editor'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={mode} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduced ? undefined : { opacity: 0 }} transition={{ duration: 0.25 }}>
                  {mode === 'tutor' ? tutor : editor}
                </motion.div>
              </AnimatePresence>
            </div>
            <p className="shrink-0 border-t border-white/6 px-5 py-3 text-[12px] text-foreground/55">
              {mode === 'tutor' ? 'The Tutor explains, quizzes and gives examples. It never edits your note.' : 'The Editor proposes changes. You see each one before it is applied.'}
            </p>
          </section>
        </div>
      </AppWindow>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StoryControls count={LABELS.length} step={step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={LABELS} />
        <ReplayButton onClick={s.restart} />
      </div>
    </div>
  )
}

// ── Importing a research paper ───────────────────────────────────────────────

const SAMPLE = 'https://arxiv.org/abs/1706.03762'
type Step = 'paste' | 'found' | 'imported'

export function PaperDemo() {
  const reduced = useReducedMotion()
  const [url, setUrl] = useState(SAMPLE)
  const [step, setStep] = useState<Step>('paste')
  const [subject, setSubject] = useState('Deep Learning')
  const [topic, setTopic] = useState('Transformers')
  const [other, setOther] = useState(false)
  const find = () => { if (url.trim().replace('http://', 'https://').startsWith('https://arxiv.org/abs/1706.03762')) { setOther(false); setStep('found') } else setOther(true) }

  return (
    <AppWindow label="Kio · Notes · Import a research paper" className="min-h-[22rem]">
      <div className="space-y-4 px-5 py-5" aria-live="polite">
        {step !== 'imported' && (
          <form onSubmit={e => { e.preventDefault(); find() }} className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">A paper’s link</span>
              <input value={url} onChange={e => { setUrl(e.target.value); setStep('paste') }} className="h-10 w-full rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground focus:border-[var(--action)] focus:outline-none" data-paper-demo-url />
            </label>
            <button type="submit" className="inline-flex h-10 items-center justify-center rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover" data-paper-demo-find>Find the paper</button>
          </form>
        )}
        {other && <p className="text-xs text-amber-200">This preview only has the sample paper. In Kio, any arXiv, DOI, Semantic Scholar, OpenReview, PubMed or PubMed Central link, or a PDF link, works.</p>}
        {step === 'found' && (
          <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/8 bg-card/60 p-4">
            <p className="font-serif text-lg font-semibold text-foreground">Attention Is All You Need</p>
            <p className="mt-0.5 text-xs text-foreground/60">Vaswani, Shazeer, Parmar, et al. · 2017 · arXiv 1706.03762</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-nova/10 px-2.5 py-0.5 text-[11px] text-nova-ink">Full text available · arXiv’s HTML version</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-foreground/60">Subject
                <select value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-background px-2 text-sm text-foreground">
                  {['Deep Learning', 'Machine Learning', 'Operating Systems'].map(o => <option key={o}>{o}</option>)}
                </select>
              </label>
              <label className="text-xs text-foreground/60">Topic
                <select value={topic} onChange={e => setTopic(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-background px-2 text-sm text-foreground">
                  {['Transformers', 'Neural networks', 'No topic'].map(o => <option key={o}>{o}</option>)}
                </select>
              </label>
            </div>
            <button type="button" onClick={() => setStep('imported')} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-3.5 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-paper-demo-import>Import as a note</button>
          </motion.div>
        )}
        {step === 'imported' && (
          <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3" data-paper-demo-done>
            <p className="text-[11px] text-sky-300">{subject}{topic !== 'No topic' ? <> <span className="text-foreground/35">/</span> {topic}</> : null}</p>
            <div className="rounded-2xl border border-sky-400/30 bg-sky-400/[0.05] p-4">
              <p className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-300"><FileText aria-hidden className="size-3.5" /> Research paper · original source <span className="rounded-full bg-nova/15 px-2 py-0.5 normal-case tracking-normal text-nova-ink">Imported: full text</span></p>
              <p className="mt-1.5 font-serif text-base font-semibold text-foreground">Attention Is All You Need</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sky-300"><span className="inline-flex items-center gap-1"><BookOpenText aria-hidden className="size-3" /> Read the PDF here</span><span className="text-foreground/50">Text from arXiv’s HTML version</span></p>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <p className="rounded-xl border border-white/8 px-3 py-2 text-foreground/70"><span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">The paper, as imported</span>Abstract, sections and references, kept as the source gave them.</p>
              <p className="rounded-xl border border-dashed border-nova/30 px-3 py-2 text-foreground/70"><span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-nova-ink">My notes</span>Your own notes go here, apart from the paper.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-nova-ink"><Sparkles aria-hidden className="size-3.5" /> One note, filed under {subject}{topic !== 'No topic' ? ` · ${topic}` : ''}</span>
              <ReplayButton onClick={() => { setStep('paste'); setUrl(SAMPLE) }} label="Import another" />
            </div>
          </motion.div>
        )}
      </div>
    </AppWindow>
  )
}

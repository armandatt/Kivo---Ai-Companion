'use client'

// Notes, on the landing page: a note beside Nova, in the two jobs Nova has
// there (notes/nova-tutor.tsx and nova-editor.tsx). The Tutor teaches from
// the note, says what came from it ("From your notes", with the passage) and
// what did not ("Beyond your notes"), and adds nothing until the learner
// confirms. The Editor proposes a change and applies it in place, with Undo.
// Then a paper import, the way the import dialog goes (paper-import-dialog).
// All of it is a scripted sample in local state: no model, no request.

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BookOpen, BookOpenText, Check, FileText, Pencil, Quote, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { KivoMark } from '@/components/brand/kivo-brand'
import { cn } from '@/lib/utils'
import { AppWindow, ReplayButton } from './frame'

const SUMMARY = 'A deadlock is a cycle of processes, each holding a resource the next one needs. It needs all four conditions at once, so breaking any one prevents it.'

type Tutor = 'idle' | 'asked' | 'preview' | 'added'
type Editor = 'idle' | 'proposed' | 'applied' | 'discarded'

export function NotesDemo() {
  const reduced = useReducedMotion()
  const [mode, setMode] = useState<'tutor' | 'editor'>('tutor')
  const [tutor, setTutor] = useState<Tutor>('idle')
  const [editor, setEditor] = useState<Editor>('idle')
  const [flash, setFlash] = useState(false)
  const reset = () => { setTutor('idle'); setEditor('idle'); setMode('tutor'); setFlash(false) }
  const show = () => { setFlash(true); window.setTimeout(() => setFlash(false), 1600) }
  const selected = tutor !== 'idle'

  const note = (
    <article className="h-full overflow-y-auto px-5 py-5 sm:px-7" aria-label="The note: Deadlocks">
      <p className="text-[11px] font-medium text-sky-300">Operating Systems <span className="text-foreground/35">/</span> Deadlocks</p>
      <h3 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-foreground">Deadlocks</h3>
      <AnimatePresence initial={false}>
        {editor === 'applied' && (
          <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden rounded-lg border-l-2 border-nova/60 bg-nova/[0.07] px-3 py-2 text-[13px] leading-relaxed text-foreground/90" data-notes-demo-summary>
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-nova-ink">Summary</span>{SUMMARY}
          </motion.div>
        )}
      </AnimatePresence>
      <p className={cn('mt-3 rounded-md text-[14px] leading-relaxed text-foreground/85 transition-colors', selected && 'bg-sky-400/15 ring-1 ring-sky-400/40')} data-notes-demo-passage>
        A deadlock happens when each process in a set holds a resource and waits for one that another process in the set holds, so none of them can go on.
      </p>
      <h4 className="mt-4 text-sm font-semibold text-foreground">Four conditions</h4>
      <ul className={cn('mt-1.5 list-disc space-y-0.5 rounded-md pl-5 text-[14px] text-foreground/80 transition-colors', flash && 'bg-nova/15 ring-1 ring-nova/50')}>
        <li>Mutual exclusion</li><li>Hold and wait</li><li>No preemption</li><li>Circular wait</li>
      </ul>
      <AnimatePresence initial={false}>
        {tutor === 'added' && (
          <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 overflow-hidden rounded-lg border border-dashed border-nova/40 px-3 py-2 text-[13px] leading-relaxed text-foreground/80" data-notes-demo-added>
            <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-nova-ink"><KivoMark size={9} /> Added by Nova</span>
            Picture four people at a round table, each holding one fork and waiting for the fork on their left.
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-4 text-[14px] leading-relaxed text-foreground/85">
        The <span className="text-[var(--action-ink)] underline decoration-dotted underline-offset-4">Banker’s algorithm</span> avoids deadlock by granting a request only if the system stays in a safe state.
      </p>
    </article>
  )

  const novaPanel = (
    <section className="flex h-full min-h-0 flex-col" aria-label="Nova beside the note">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5">
        <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-nova/12 ring-1 ring-nova/25"><KivoMark size={12} className="text-nova-ink" /></span>
        <div role="tablist" aria-label="Nova's two jobs" className="inline-flex rounded-lg border border-white/8 p-0.5">
          {(['tutor', 'editor'] as const).map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} data-notes-demo-mode={m}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', mode === m ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground')}>
              {m === 'tutor' ? <BookOpen aria-hidden className="size-3.5" /> : <Pencil aria-hidden className="size-3.5" />}{m === 'tutor' ? 'Tutor' : 'Editor'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[13px] leading-relaxed" aria-live="polite">
        {mode === 'tutor' ? (
          <>
            <p className="text-foreground/60">The Tutor teaches from this note. It never changes it unless you add something.</p>
            {tutor === 'idle' ? (
              <button type="button" onClick={() => setTutor('asked')} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-3.5 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-notes-demo-ask>
                <Quote aria-hidden className="size-3.5" /> Select the first paragraph and Ask Nova: explain it
              </button>
            ) : (
              <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-3">
                <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-action/15 px-3 py-2 text-foreground ring-1 ring-action/20">Explain this</p>
                <div className="space-y-2 text-foreground/85">
                  <p>Each process is stuck holding one thing while waiting for another. Your note lists why it can happen: all four conditions have to hold at the same time.</p>
                  <button type="button" onClick={show} className="inline-flex items-center gap-1 rounded-full border border-nova/40 bg-nova/[0.07] px-2.5 py-1 text-[11px] text-nova-ink hover:bg-nova/15" data-notes-demo-source>
                    <FileText aria-hidden className="size-3" /> From your notes · Four conditions
                  </button>
                  <p className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-foreground/75"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200">Beyond your notes</span><br />Think of four people at a round table, each holding one fork and waiting for the one on their left.</p>
                </div>
                {tutor === 'asked' && <button type="button" onClick={() => setTutor('preview')} className="inline-flex h-8 items-center rounded-lg border border-white/12 px-3 text-xs text-foreground/85 hover:bg-white/5" data-notes-demo-add>Add the example to my note</button>}
                {tutor === 'preview' && (
                  <div className="rounded-xl border border-nova/30 bg-nova/[0.05] p-3 text-xs">
                    <p className="text-foreground/80">It goes under <strong className="text-foreground">Four conditions</strong>, on its own lines, marked as Nova’s.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => setTutor('added')} className="inline-flex h-8 items-center gap-1 rounded-lg bg-action px-3 font-semibold text-action-foreground hover:bg-action-hover" data-notes-demo-confirm><Check aria-hidden className="size-3.5" /> Add</button>
                      <button type="button" onClick={() => setTutor('asked')} className="inline-flex h-8 items-center rounded-lg px-2 text-foreground/60 hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                )}
                {tutor === 'added' && <p className="inline-flex items-center gap-1.5 text-xs text-nova-ink"><Check aria-hidden className="size-3.5" /> Added to your note. Undo is one click away in Kivo.</p>}
              </motion.div>
            )}
            <p className="mt-4 text-[11px] text-foreground/45">It can also give examples, walk through steps, set a practice question and check your answer, quiz you, or make flashcards.</p>
          </>
        ) : (
          <>
            <p className="text-foreground/60">The Editor proposes changes to the note. You see each one before it is applied.</p>
            {editor === 'idle' || editor === 'discarded' ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setEditor('proposed')} className="rounded-full border border-nova/50 bg-nova/[0.08] px-3 py-1.5 text-xs text-foreground hover:bg-nova/15" data-notes-demo-edit>Add a summary</button>
                <p className="w-full pt-1 text-[11px] text-foreground/45">In Kivo it can also improve the structure, rewrite more clearly, expand what’s thin, fix grammar, remove repetition, add key takeaways or examples.</p>
                {editor === 'discarded' && <p className="w-full pt-1 text-xs text-foreground/55">Discarded. Your note is as it was.</p>}
              </div>
            ) : (
              <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
                <p className="text-sm text-foreground/90">Add a summary</p>
                <div className="mt-2 border-y border-white/6 py-2.5" data-notes-demo-change>
                  <p className="text-[11px] text-subtle">Add · at the top of the note</p>
                  <div className="mt-1.5 rounded-md border-l-2 border-nova/50 bg-nova/[0.05] px-2.5 py-1.5 text-foreground/85">{SUMMARY}</div>
                </div>
                {editor === 'proposed' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setEditor('applied')} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-notes-demo-apply><Check aria-hidden className="size-3.5" /> Apply it</button>
                    <button type="button" onClick={() => setEditor('discarded')} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-subtle hover:text-foreground"><Trash2 aria-hidden className="size-3.5" /> Discard</button>
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-2 text-xs text-nova-ink"><Check aria-hidden className="size-3.5" /> Applied and saved in this note.
                    <button type="button" onClick={() => setEditor('idle')} className="inline-flex items-center gap-1 font-medium hover:underline" data-notes-demo-undo><Undo2 aria-hidden className="size-3" /> Undo</button></p>
                )}
              </motion.div>
            )}
            <p className="mt-4 text-[11px] text-foreground/45">Rewording never deletes your words without showing them struck through first. A paper’s imported text is left as it is.</p>
          </>
        )}
      </div>
    </section>
  )

  return (
    <div className="space-y-4">
      <AppWindow label="Kivo · Notes · Deadlocks" className="h-[40rem] md:h-[30rem]">
        <div className="grid h-full md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-h-0 border-white/6 max-md:h-[19rem] max-md:border-b md:border-r">{note}</div>
          <div className="min-h-0">{novaPanel}</div>
        </div>
      </AppWindow>
      <div className="flex justify-end"><ReplayButton onClick={reset} /></div>
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
    <AppWindow label="Kivo · Notes · Import a research paper" className="min-h-[22rem]">
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
        {other && <p className="text-xs text-amber-200">This preview only has the sample paper. In Kivo, any arXiv, DOI, Semantic Scholar, OpenReview, PubMed or PubMed Central link, or a PDF link, works.</p>}
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

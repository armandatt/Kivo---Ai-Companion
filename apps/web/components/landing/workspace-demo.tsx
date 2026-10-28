'use client'

// The landing page's connected workspace: one sample subject seen three ways,
// the second brain (the explorer and a topic's page, as on Knowledge), a note
// with the Tutor beside it, and today's flow planned with Nova. The topic
// chosen in one view is the topic in the others, so the visitor sees one
// record, not three tools. Everything is local sample state: no request, no
// storage, no model. Nova's lines are written here and labelled as a preview.
// It plays itself (TOUR, one step every STEP_MS while in view): the tabs change
// and Nova's words type in. Any click hands it to the visitor; Reset plays again.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, BookOpen, Brain, CalendarCheck, Check, ChevronRight, FileText, Flag, Pause, Play, Quote, RotateCcw, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppWindow, Typed, useStory } from './frame'

type Tab = 'brain' | 'notes' | 'today'
type Level = 'solid' | 'developing' | 'weak' | null

interface Topic {
  id: string; name: string; parent: string | null; level: Level; due?: boolean; milestone?: boolean
  note?: { title: string; passages: Array<{ text: string; explain: string; check: string }> }
}

const SUBJECT = 'Machine Learning'
const TOPICS: Topic[] = [
  { id: 'nn', name: 'Neural networks', parent: null, level: null },
  {
    id: 'backprop', name: 'Backpropagation', parent: 'nn', level: 'developing', due: true,
    note: {
      title: 'Backpropagation · lecture 6',
      passages: [
        { text: 'The loss is computed at the output, then its gradient flows backwards through every layer.', explain: 'Think of the error as a bill split between everyone who caused it. Each layer gets a share in proportion to how much it changed the output.', check: 'Why does the gradient start at the output, not the input?' },
        { text: 'Each weight’s gradient is the chain rule applied to the path from that weight to the loss.', explain: 'A weight deep inside the network only affects the loss through the layers after it, so its gradient multiplies the local slopes along that path.', check: 'What would make a deep weight’s gradient very small?' },
        { text: 'Weights move a small step against their gradient: w ← w − η · ∂L/∂w.', explain: 'The gradient points uphill on the loss. Stepping the other way, by a small learning rate η, lowers the loss a little each update.', check: 'What happens if η is far too large?' },
      ],
    },
  },
  { id: 'activations', name: 'Activation functions', parent: 'nn', level: 'solid' },
  { id: 'gd', name: 'Gradient descent', parent: null, level: 'solid' },
  { id: 'reg', name: 'Regularisation', parent: null, level: 'weak', due: true },
  { id: 'mid', name: 'Midterm', parent: null, level: null, milestone: true },
]
const byId = new Map(TOPICS.map(t => [t.id, t]))
const LEVEL: Record<Exclude<Level, null>, { label: string; dot: string; width: string }> = {
  solid:      { label: 'Solid', dot: 'bg-emerald-400', width: '82%' },
  developing: { label: 'Developing', dot: 'bg-sky-400', width: '54%' },
  weak:       { label: 'Weak', dot: 'bg-amber-400', width: '28%' },
}
const QUICK = [
  { id: 'exam', label: 'About an hour · midterm on Friday', minutes: 60 },
  { id: 'understand', label: '30 minutes · I just want to get it', minutes: 30 },
] as const

const fast = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }

// The tour: what the window shows at each step, as a visitor would click it.
type Answer = typeof QUICK[number]['id']
const TOUR: Array<{ tab: Tab; topic: string; passage?: number; answer?: Answer; applied?: boolean }> = [
  { tab: 'brain', topic: 'backprop' },
  { tab: 'brain', topic: 'reg' },
  { tab: 'notes', topic: 'backprop', passage: 0 },
  { tab: 'notes', topic: 'backprop', passage: 2 },
  { tab: 'today', topic: 'backprop' },
  { tab: 'today', topic: 'backprop', answer: 'exam' },
  { tab: 'today', topic: 'backprop', answer: 'exam', applied: true },
]
const STEP_MS = 2200
function Dot({ topic }: { topic: Topic }) {
  if (topic.milestone) return <Flag aria-hidden className="size-3 shrink-0 text-foreground/45" />
  if (!topic.level) return <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-foreground/35" />
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', LEVEL[topic.level].dot)} />
}

export function WorkspaceDemo() {
  const s = useStory(TOUR.length, STEP_MS)
  const [tab, setTabState] = useState<Tab>('brain')
  const [topicId, setTopicId] = useState('backprop')
  const [passage, setPassageState] = useState<number | null>(null)
  const [answer, setAnswerState] = useState<Answer | null>(null)
  const [applied, setAppliedState] = useState(false)
  // While the tour plays, each step sets the window as the visitor would.
  const { step, playing } = s
  useEffect(() => {
    if (!playing) return
    const at = TOUR[step]
    setTabState(at.tab); setTopicId(at.topic); setPassageState(at.passage ?? null); setAnswerState(at.answer ?? null); setAppliedState(!!at.applied)
  }, [step, playing])
  // The visitor's own click stops the tour where it is.
  const take = () => { if (playing) s.go(step) }
  const setTab = (t: Tab) => { take(); setTabState(t) }
  const setPassage = (i: number) => { take(); setPassageState(i) }
  const setAnswer = (a: Answer | null) => { take(); setAnswerState(a) }
  const setApplied = (v: boolean) => { take(); setAppliedState(v) }
  const topic = byId.get(topicId)!
  const note = topic.note ?? byId.get('backprop')!.note!
  const noteTopic = topic.note ? topic : byId.get('backprop')!
  const path = [SUBJECT, ...(topic.parent ? [byId.get(topic.parent)!.name] : []), topic.name]

  const pick = (id: string) => { take(); setTopicId(id); setPassageState(null); setAnswerState(null); setAppliedState(false) }
  const reset = () => { setTabState('brain'); setTopicId('backprop'); setPassageState(null); setAnswerState(null); setAppliedState(false); s.restart() }
  const minutes = QUICK.find(q => q.id === answer)?.minutes ?? 0
  const plan = answer === null ? [] : [
    { what: `Review ${noteTopic.name}`, why: 'Due today, developing', min: answer === 'exam' ? 25 : 15, from: noteTopic.name },
    { what: `Practice: ${note.passages[1].check}`, why: `From your note “${note.title}”`, min: answer === 'exam' ? 20 : 15, from: note.title },
    ...(answer === 'exam' ? [{ what: 'Regularisation, a first pass', why: 'Due, weak, and on the midterm', min: 15, from: 'Regularisation' }] : []),
  ]

  const TABS: Array<{ id: Tab; label: string; icon: typeof Brain }> = [
    { id: 'brain', label: 'Second Brain', icon: Brain },
    { id: 'notes', label: 'Notes & Tutor', icon: BookOpen },
    { id: 'today', label: 'Today’s Learning', icon: CalendarCheck },
  ]

  return (
    <div ref={s.ref} data-workspace-demo data-playing={playing ? 'true' : 'false'}>
      <div role="tablist" aria-label="Product views" className="mx-auto mb-4 flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-controls="workspace-panel" id={`ws-tab-${t.id}`} onClick={() => setTab(t.id)} data-tab={t.id}
            className={cn('relative inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]',
              tab === t.id ? 'text-[#06120d]' : 'text-slate-300 hover:text-white')}>
            {tab === t.id && <motion.span layoutId="ws-tab" aria-hidden className="absolute inset-0 rounded-full bg-[#00E5A0]" transition={fast} />}
            <t.icon aria-hidden className="relative size-4" /><span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      {/* How far the tour is: one segment a step, the current one filling */}
      {!s.reduced && (
        <div aria-hidden className="mx-auto -mt-2 mb-4 flex w-48 gap-1">
          {TOUR.map((_, i) => (
            <span key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className={cn('block h-full bg-[#00E5A0]', i < step ? 'w-full' : 'w-0', i === step && playing && 'tour-fill')} style={i === step && playing ? { animationDuration: `${STEP_MS}ms` } : undefined} key={i === step ? `${step}:${playing}` : undefined} />
            </span>
          ))}
        </div>
      )}

      <AppWindow label={`${SUBJECT} · product preview`}
        bar={<span className="mr-2 flex items-center gap-1">
          {!s.reduced && (
            <button type="button" onClick={s.toggle} aria-pressed={!s.paused} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-foreground/55 hover:text-foreground" data-tour>
              {s.paused ? <><Play aria-hidden className="size-3" /> Play tour</> : <><Pause aria-hidden className="size-3" /> Pause</>}
            </button>
          )}
          <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-foreground/55 hover:text-foreground" data-reset><RotateCcw aria-hidden className="size-3" /> Reset</button>
        </span>}>
        <div className="grid min-h-[30rem] md:grid-cols-[14rem_minmax(0,1fr)]">
          {/* The explorer, the same in every view: the chosen topic travels with the visitor */}
          <nav aria-label="Sample subject" className="border-b border-white/6 p-3 md:border-b-0 md:border-r">
            <p className="flex items-center gap-2 px-2 text-[13px] font-semibold text-foreground"><span aria-hidden className="size-2.5 rounded-[3px] bg-violet-400" />{SUBJECT}</p>
            <ul className="mt-2 flex gap-1 overflow-x-auto md:block md:space-y-px">
              {TOPICS.map(t => (
                <li key={t.id} className="shrink-0">
                  <button type="button" onClick={() => pick(t.id)} aria-current={t.id === topicId ? 'true' : undefined} data-topic={t.id}
                    className={cn('flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors duration-150',
                      t.id === topicId ? 'bg-[#00E5A0]/12 text-foreground' : 'text-foreground/70 hover:bg-white/5 hover:text-foreground')}
                    style={{ paddingLeft: t.parent ? 26 : 10 }}>
                    <Dot topic={t} /><span className="truncate">{t.name}</span>
                    {t.due && <span className="ml-auto shrink-0 rounded-full bg-amber-300/15 px-1.5 text-[10px] font-semibold text-amber-300">due</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div id="workspace-panel" role="tabpanel" aria-labelledby={`ws-tab-${tab}`} className="relative min-w-0 p-5 sm:p-6">
            <p className="flex flex-wrap items-center gap-1 text-[12px] text-foreground/50" aria-label="Where this is">
              {path.map((p, i) => <span key={p} className="flex items-center gap-1">{i > 0 && <ChevronRight aria-hidden className="size-3 text-foreground/30" />}<span className={i === path.length - 1 ? 'text-foreground/80' : undefined}>{p}</span></span>)}
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${tab}:${topicId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={fast} className="mt-3">
                {tab === 'brain' && (
                  <div data-view="brain">
                    <h3 className="text-2xl font-semibold tracking-tight text-foreground">{topic.name}</h3>
                    <p className="mt-1 text-[13px] text-foreground/55">
                      <Typed text={topic.milestone ? 'Milestone · the topics it covers are planned toward it' : topic.level ? `${LEVEL[topic.level].label}${topic.due ? ' · due for review today' : ''}` : 'Groups the topics inside it'} />
                    </p>
                    {topic.level && <div className="mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-white/8"><motion.div className={cn('h-full rounded-full', LEVEL[topic.level].dot)} initial={{ width: 0 }} animate={{ width: LEVEL[topic.level].width }} transition={{ duration: 0.3 }} /></div>}
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                        <p className="text-[12px] font-semibold text-foreground/70">Filed here</p>
                        {topic.note ? (
                          <button type="button" onClick={() => setTab('notes')} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground/85 hover:bg-white/5" data-open-note>
                            <FileText aria-hidden className="size-3.5 text-sky-300" />{topic.note.title}<ArrowRight aria-hidden className="ml-auto size-3.5 text-foreground/40" />
                          </button>
                        ) : <p className="mt-2 text-[13px] text-foreground/50">No note filed under this topic yet.</p>}
                      </div>
                      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                        <p className="text-[12px] font-semibold text-foreground/70">{topic.parent || topic.milestone ? 'Connected' : 'Inside'}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(topic.id === 'nn' ? TOPICS.filter(t => t.parent === 'nn') : topic.milestone ? TOPICS.filter(t => t.due) : [byId.get('gd')!, byId.get(topic.parent ?? 'nn')!].filter(t => t.id !== topic.id)).map(t => (
                            <button key={t.id} type="button" onClick={() => pick(t.id)} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/10 px-2.5 text-[12px] text-foreground/80 hover:border-[#00E5A0]/40 hover:text-foreground"><Dot topic={t} />{t.name}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setTab('notes')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-[13px] font-medium text-foreground/85 hover:bg-white/5"><BookOpen aria-hidden className="size-3.5" /> Study the note</button>
                      <button type="button" onClick={() => setTab('today')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#00E5A0] px-3 text-[13px] font-semibold text-[#06120d] hover:bg-[#33ebb3]" data-plan><CalendarCheck aria-hidden className="size-3.5" /> Plan it today</button>
                    </div>
                  </div>
                )}

                {tab === 'notes' && (
                  <div data-view="notes" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
                    <article>
                      <h3 className="text-lg font-semibold text-foreground">{note.title}</h3>
                      {!topic.note && <p className="mt-1 text-[12px] text-foreground/50">{topic.name} has no note yet, so this is {noteTopic.name}’s.</p>}
                      <p className="mt-1 text-[12px] text-foreground/50">Your note · choose a passage to ask the Tutor</p>
                      <div className="mt-3 space-y-1.5">
                        {note.passages.map((p, i) => (
                          <button key={i} type="button" onClick={() => setPassage(i)} aria-pressed={passage === i} data-passage={i}
                            className={cn('block w-full rounded-lg border px-3 py-2 text-left text-[14px] leading-relaxed transition-colors duration-150',
                              passage === i ? 'border-[#00E5A0]/50 bg-[#00E5A0]/[0.07] text-foreground' : 'border-transparent text-foreground/80 hover:border-white/10 hover:bg-white/[0.03]')}>
                            {p.text}
                          </button>
                        ))}
                      </div>
                    </article>
                    <aside aria-label="Tutor" className="rounded-xl border border-white/8 bg-white/[0.02] p-4" data-tutor>
                      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#7ef5cf]"><Sparkles aria-hidden className="size-3.5" /> Tutor</p>
                      {passage === null ? (
                        <p className="mt-2 text-[13px] leading-relaxed text-foreground/55">Choose a passage in your note. The Tutor explains it from your own words, and says which part is yours and which is its own.</p>
                      ) : (
                        <motion.div key={passage} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={fast} className="mt-2 space-y-3 text-[13px] leading-relaxed">
                          <p className="flex gap-2 rounded-lg bg-sky-400/[0.06] p-2.5 text-foreground/75"><Quote aria-hidden className="mt-0.5 size-3 shrink-0 text-sky-300" /><span><span className="block text-[11px] font-semibold text-sky-300">From your note</span>{note.passages[passage].text}</span></p>
                          <p className="text-foreground/90"><span className="block text-[11px] font-semibold text-[#7ef5cf]">Nova’s explanation</span><Typed text={note.passages[passage].explain} /></p>
                          <p className="rounded-lg border border-white/8 p-2.5 text-foreground/80"><span className="block text-[11px] font-semibold text-foreground/55">Check yourself</span><Typed text={note.passages[passage].check} /></p>
                        </motion.div>
                      )}
                    </aside>
                  </div>
                )}

                {tab === 'today' && (
                  <div data-view="today" className="max-w-2xl space-y-3">
                    <Bubble who="nova"><Typed text={`Let’s plan ${noteTopic.name} into today. How much time do you have, and is it for the midterm or to understand it?`} /></Bubble>
                    {answer === null ? (
                      <div className="flex flex-wrap gap-2 pl-9">
                        {QUICK.map(q => <button key={q.id} type="button" onClick={() => setAnswer(q.id)} data-answer={q.id} className="h-8 rounded-full border border-[#00E5A0]/35 px-3 text-[13px] text-[#7ef5cf] transition-colors duration-150 hover:bg-[#00E5A0]/10">{q.label}</button>)}
                      </div>
                    ) : (
                      <>
                        <Bubble who="you">{QUICK.find(q => q.id === answer)!.label}</Bubble>
                        <Bubble who="nova"><Typed text={applied ? 'Applied. It’s your day now; change anything on Today.' : `Here’s a ${minutes}-minute flow from your map and your note. Nothing changes until you apply it.`} /></Bubble>
                        <ol className={cn('ml-9 overflow-hidden rounded-xl border', applied ? 'border-[#00E5A0]/40' : 'border-dashed border-white/15')} data-plan-list>
                          {plan.map((p, i) => (
                            <motion.li key={p.what} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...fast, delay: i * 0.04 }}
                              className="flex items-center gap-3 border-b border-white/6 px-3 py-2.5 last:border-b-0">
                              {applied ? <Check aria-hidden className="size-4 shrink-0 text-[#00E5A0]" /> : <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/15 text-[10px] text-foreground/60">{i + 1}</span>}
                              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-foreground/90">{p.what}</span><span className="block truncate text-[11px] text-foreground/50">{p.why}</span></span>
                              <span className="shrink-0 text-[12px] tabular-nums text-foreground/60">{p.min} min</span>
                            </motion.li>
                          ))}
                        </ol>
                        <div className="flex gap-2 pl-9">
                          {!applied
                            ? <><button type="button" onClick={() => setApplied(true)} data-apply className="h-8 rounded-lg bg-[#00E5A0] px-3 text-[13px] font-semibold text-[#06120d] hover:bg-[#33ebb3]">Apply plan</button>
                                <button type="button" onClick={() => setAnswer(null)} className="h-8 rounded-lg border border-white/12 px-3 text-[13px] text-foreground/75 hover:bg-white/5">Change something</button></>
                            : <button type="button" onClick={() => { setAnswer(null); setApplied(false) }} className="h-8 rounded-lg border border-white/12 px-3 text-[13px] text-foreground/75 hover:bg-white/5">Plan again</button>}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </AppWindow>
      <p className="mt-3 text-center text-[12px] text-slate-500">A product preview with sample data. Nothing here is a live account, and no AI is running.</p>
    </div>
  )
}

function Bubble({ who, children }: { who: 'nova' | 'you'; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={fast} className={cn('flex gap-2.5', who === 'you' && 'justify-end')}>
      {who === 'nova' && <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[#00E5A0]/15 text-[#7ef5cf]"><Sparkles className="size-3.5" /></span>}
      <p className={cn('max-w-[34rem] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed', who === 'nova' ? 'bg-white/[0.04] text-foreground/90' : 'bg-[#00E5A0]/12 text-foreground')}>{children}</p>
    </motion.div>
  )
}

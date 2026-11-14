'use client'

// Nova on Telegram, on the landing page: a few evenings with a mentor that
// writes first. The buttons and fixed lines are the bot's own
// (nova/telegram/telegram-replies.ts: "Start 25 min", "Later", "Not today",
// "How did it go?", "Logged: … min on …"); Nova's own sentences are written
// here and labelled as a sample. Beside the phone, what is happening now and
// the reasons Nova may write and the times it stays quiet
// (nova/decision/proactive-decision.ts), lit as the chat reaches them. Local
// state only: no bot, no model, no request.
//
// The phone is drawn as a phone (frame, island, status bar) running Telegram:
// bubbles with tails, buttons under the message as Telegram draws them, a
// typing indicator before Nova speaks, and a chat that scrolls (older lines
// move up and out; nothing is stacked on top of another).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BatteryFull, BellOff, BookOpenCheck, CalendarClock, CheckCheck, ChevronLeft, Clock3, HeartPulse, Hourglass, ListTodo, Mic, Moon, Paperclip, Send, Signal, Smile, Sunrise, Timer, Wifi } from 'lucide-react'
import { KivoMark } from '@/components/brand/kivo-brand'
import { cn } from '@/lib/utils'
import { StoryControls, Typed, useStory } from './frame'

type Reason = 'checkin' | 'plan' | 'review' | 'exam' | 'task' | 'lapse'
type Quiet = 'night' | 'session' | 'recent' | 'life' | 'cap'
type Line =
  | { kind: 'day'; text: string }
  | { kind: 'nova'; text: string; time: string; buttons?: string[]; link?: string }
  | { kind: 'you'; text: string; time: string }

type Lang = 'en' | 'hi'
// What Nova and the learner say, in each language. Nova's sentences follow the
// learner's language; the buttons and the lines code writes (Running, How did
// it go?, Logged) go out as code wrote them in both, as the bot sends them.
const SAID: Record<Lang, { offer: string; done: string; exam: string; away: string; reply: string }> = {
  en: {
    offer: 'Evening! First on today’s plan: Gradient descent, 25 minutes. Your Linear regression review is due too.',
    done: 'done, it finally clicked',
    exam: 'ML midterm is on Thursday. Model evaluation is the topic it covers that needs you most. 30 minutes tonight?',
    away: 'can’t today, family function at home',
    reply: 'No problem, enjoy it. No study messages from me today. The midterm is on Thursday, that’s all to keep in mind.',
  },
  hi: {
    offer: 'Shaam ho gayi! Aaj ke plan mein pehle: Gradient descent, 25 minute. Linear regression ka review bhi due hai.',
    done: 'ho gaya, finally samajh aaya',
    exam: 'ML midterm Thursday ko hai. Model evaluation pe sabse zyada kaam baaki hai. Aaj raat 30 minute?',
    away: 'aaj nahi ho payega, ghar pe function hai',
    reply: 'Koi baat nahi, enjoy karo. Aaj padhai ke liye koi message nahi aayega. Midterm Thursday ko hai, bas itna yaad rakhna.',
  },
}

// Each step adds lines to the chat, says which rule it shows, and what is happening.
const stepsIn = (lang: Lang): Array<{ label: string; caption: string; clock: string; lines: Line[]; reason?: Reason; quiet?: Quiet }> => {
  const t = SAID[lang]
  return [
    {
      label: 'Nova writes first', reason: 'plan', clock: '6:30',
      caption: 'In your usual study window, Nova opens with today’s first block and a Start button.',
      lines: [
        { kind: 'day', text: 'Today' },
        { kind: 'nova', time: '6:30 pm', text: t.offer, buttons: ['Start 25 min', 'Later', 'Not today'] },
      ],
    },
    {
      label: 'One tap starts', reason: 'plan', quiet: 'session', clock: '6:31',
      caption: 'Start runs a real session, the same one the web app shows. Nova stays quiet until it ends.',
      lines: [{ kind: 'nova', time: '6:31 pm', text: 'Running: Gradient descent, 0 of 25 min.', buttons: ['Pause', 'End'] }],
    },
    {
      label: 'Say how it went', reason: 'plan', clock: '6:57',
      caption: 'Reply in your own words. Ending a session always asks how it went.',
      lines: [
        { kind: 'you', time: '6:57 pm', text: t.done },
        { kind: 'nova', time: '6:57 pm', text: 'Gradient descent. How did it go?', buttons: ['Struggled', 'Okay', 'Good', 'Crushed it'] },
      ],
    },
    {
      label: 'Logged', reason: 'plan', clock: '6:57',
      caption: 'Your answer updates the topic’s progress and schedules its next review.',
      lines: [{ kind: 'nova', time: '6:57 pm', text: 'Logged: 25 min on Gradient descent. Good.', link: 'Open Nova' }],
    },
    {
      label: 'An exam close', reason: 'exam', clock: '5:45',
      caption: 'Three days out, Nova points at the topic the exam needs most.',
      lines: [
        { kind: 'day', text: 'Monday' },
        { kind: 'nova', time: '5:45 pm', text: t.exam, buttons: ['Start 30 min', 'Later', 'Not today'] },
      ],
    },
    {
      label: 'A day off', quiet: 'life', clock: '5:52',
      caption: 'Tell Nova what’s going on. Study nudges wait; the exam date is all it keeps in view.',
      lines: [
        { kind: 'you', time: '5:52 pm', text: t.away },
        { kind: 'nova', time: '5:52 pm', text: t.reply },
      ],
    },
  ]
}
const STEPS = stepsIn('en')
const LANGS: Array<{ id: Lang; name: string }> = [{ id: 'en', name: 'English' }, { id: 'hi', name: 'Hinglish' }]
const LABELS = STEPS.map(s => s.label)
const STEP_MS = 2800
// How long Nova "types" before its message lands.
const TYPING_MS = 650

// The button tapped to reach a step, kept lit on the message it was on.
const TAPPED: Record<number, string> = { 1: 'Start 25 min', 3: 'Good' }

const REASONS: Array<{ id: Reason; icon: typeof Send; title: string; body: string }> = [
  { id: 'checkin', icon: Sunrise, title: 'Your check-in time', body: 'Once a day, at the time you choose.' },
  { id: 'plan', icon: Timer, title: 'Today’s first block', body: 'In your study window, with a Start button.' },
  { id: 'review', icon: BookOpenCheck, title: 'A review that’s due', body: 'When a topic comes round again.' },
  { id: 'exam', icon: CalendarClock, title: 'An exam close', body: 'Three days out or nearer.' },
  { id: 'task', icon: ListTodo, title: 'A task due today', body: 'Named, with no topic pushed on you.' },
  { id: 'lapse', icon: Hourglass, title: 'A few days away', body: 'Once, to help you back in.' },
]
const QUIET: Array<{ id: Quiet; icon: typeof Send; text: string }> = [
  { id: 'night', icon: Moon, text: '11 pm to 7 am' },
  { id: 'session', icon: Clock3, text: 'Mid-session' },
  { id: 'recent', icon: Send, text: 'Right after you write' },
  { id: 'life', icon: HeartPulse, text: 'Illness or a hard day' },
  { id: 'cap', icon: BellOff, text: 'Over twice a day' },
]

// Telegram's bubble tail, drawn at the bubble's lower corner.
function Tail({ side, className }: { side: 'left' | 'right'; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 11 16" className={cn('absolute bottom-0 h-4 w-[11px]', side === 'left' ? '-left-[6px]' : '-right-[6px] -scale-x-100', className)}>
      <path d="M11 0v16H0c3.5-.9 6.7-3.3 8.4-6.7C10.3 5.9 11 3 11 0Z" fill="currentColor" />
    </svg>
  )
}

// Telegram's inline keyboard: buttons under the message, over the wallpaper.
function Keyboard({ labels, pressed, reduced }: { labels: string[]; pressed?: string; reduced: boolean }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-1" aria-label="Buttons">
      {labels.map((b, i) => {
        const on = b === pressed
        return (
          <motion.span key={b}
            animate={on && !reduced ? { scale: [1, 0.95, 1] } : { scale: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={cn('relative overflow-hidden rounded-[10px] py-[7px] text-center text-[12px] font-medium backdrop-blur-md transition-colors duration-300',
              labels.length % 2 === 1 && i === 0 && 'col-span-2',
              on ? 'bg-[#00E5A0]/25 text-white ring-1 ring-inset ring-[#00E5A0]/60' : 'bg-[#1e2c3a]/70 text-[#dcecff]')}>
            {b}
          </motion.span>
        )
      })}
    </div>
  )
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1" aria-label="Nova is typing">
      {[0, 1, 2].map(i => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-[#8ea3b6]" style={{ animationDelay: `${i * 120}ms`, animationDuration: '900ms' }} />
      ))}
    </span>
  )
}

export function TelegramDemo() {
  const s = useStory(STEPS.length, STEP_MS)
  // English, then Hinglish, then English again, each time the chat starts
  // over; choosing one keeps it.
  const [lang, setLang] = useState<Lang>('en')
  const [chosen, setChosen] = useState(false)
  const last = useRef(s.step)
  useEffect(() => {
    if (!chosen && last.current === STEPS.length - 1 && s.step === 0) setLang(l => (l === 'en' ? 'hi' : 'en'))
    last.current = s.step
  }, [s.step, chosen])

  // Nova types for a moment before each of its messages lands.
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    if (s.reduced) { setTyping(false); return }
    setTyping(true)
    const id = setTimeout(() => setTyping(false), TYPING_MS)
    return () => clearTimeout(id)
  }, [s.step, lang, s.reduced])

  const steps = stepsIn(lang)
  const now = steps[s.step]!
  // The lines on screen: every earlier step, then this one up to Nova's line
  // while it is still typing.
  const shown = steps.slice(0, s.step + 1).flatMap((st, i) => {
    const lines = st.lines.map((l, j) => ({ l, key: `${lang}-${i}-${j}`, step: i }))
    if (i < s.step || !typing) return lines
    const firstNova = lines.findIndex(x => x.l.kind === 'nova')
    return firstNova < 0 ? lines : lines.slice(0, firstNova)
  })

  // The chat scrolls to its newest line, as a chat does.
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: s.reduced ? 'auto' : 'smooth' })
  }, [shown.length, typing, s.step, lang, s.reduced])

  return (
    <div ref={s.ref} className="space-y-6">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-16">
        {/* The phone */}
        <div className="relative mx-auto w-full max-w-[21.5rem]">
          <div className="mb-5 flex items-center justify-center gap-2">
            <span className="text-xs text-slate-500">Nova replies in</span>
            <div role="group" aria-label="Language of the sample" className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5">
              {LANGS.map(l => (
                <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => { setLang(l.id); setChosen(true); s.restart() }}
                  className={cn('relative rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]', lang === l.id ? 'text-[#04130e]' : 'text-slate-400 hover:text-slate-200')}>
                  {lang === l.id && <motion.span layoutId="tg-lang" aria-hidden className="absolute inset-0 rounded-full bg-[#00E5A0]" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />}
                  <span className="relative">{l.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Glow behind the phone */}
          <div aria-hidden className="absolute -inset-12 top-10 -z-10 rounded-[4rem] bg-[radial-gradient(closest-side,rgba(42,171,238,0.22),transparent)] blur-3xl" />
          <div aria-hidden className="absolute inset-x-10 -bottom-6 -z-10 h-24 rounded-full bg-[#00E5A0]/15 blur-3xl" />

          {/* Frame: a titanium edge, then the bezel */}
          <div className="relative rounded-[3.4rem] bg-[linear-gradient(145deg,#5b6370_0%,#23272e_22%,#15181d_50%,#2a2f37_78%,#6a7280_100%)] p-[3px] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9),0_30px_80px_-50px_rgba(0,229,160,0.45)]">
            {/* Side buttons */}
            <span aria-hidden className="absolute -left-[3px] top-28 h-8 w-[3px] rounded-l bg-[#3a4049]" />
            <span aria-hidden className="absolute -left-[3px] top-40 h-14 w-[3px] rounded-l bg-[#3a4049]" />
            <span aria-hidden className="absolute -left-[3px] top-[15.5rem] h-14 w-[3px] rounded-l bg-[#3a4049]" />
            <span aria-hidden className="absolute -right-[3px] top-44 h-20 w-[3px] rounded-r bg-[#3a4049]" />
            <div className="rounded-[3.25rem] bg-black p-[9px]">
              <div className="relative flex h-[38rem] flex-col overflow-hidden rounded-[2.75rem] bg-[#0e1621]">
                {/* Status bar and the island */}
                <div className="relative z-20 flex h-11 shrink-0 items-center justify-between bg-[#17212b] px-7 pt-1 text-[12px] font-semibold text-white">
                  <span className="tabular-nums">{now.clock}</span>
                  <span aria-hidden className="absolute left-1/2 top-2.5 flex h-[26px] w-[96px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
                    <span className="size-2 rounded-full bg-[#1a2733] ring-1 ring-[#24364a]" />
                  </span>
                  <span aria-hidden className="flex items-center gap-1 text-white/90">
                    <Signal className="size-3.5" strokeWidth={2.5} /><Wifi className="size-3.5" strokeWidth={2.5} /><BatteryFull className="size-[18px]" strokeWidth={2} />
                  </span>
                </div>

                {/* The chat's header */}
                <div className="relative z-20 flex shrink-0 items-center gap-2.5 border-b border-black/30 bg-[#17212b] px-3 pb-2.5 pt-1.5 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
                  <span aria-hidden className="flex items-center text-[13px] text-[#5fb3f5]"><ChevronLeft className="size-5" />Chats</span>
                  <span className="flex min-w-0 flex-1 flex-col items-center">
                    <span className="text-[14px] font-semibold leading-tight text-white">Nova</span>
                    <span className={cn('text-[11px] leading-tight transition-colors duration-200', typing ? 'text-[#5fb3f5]' : 'text-[#7d8b99]')}>{typing ? 'typing…' : 'bot · Sample'}</span>
                  </span>
                  <span className="relative">
                    <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#2ff0b8] to-[#0b8f78] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"><KivoMark size={16} className="text-[#04130e]" /></span>
                    <span aria-hidden className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#17212b] bg-[#00E5A0]" />
                  </span>
                </div>

                {/* The messages, over Telegram's patterned wallpaper */}
                <div className="relative min-h-0 flex-1">
                  <div aria-hidden className="absolute inset-0 [background:radial-gradient(90%_60%_at_15%_10%,rgba(0,229,160,0.10),transparent),radial-gradient(80%_60%_at_90%_80%,rgba(42,171,238,0.12),transparent),#0e1621]" />
                  <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,#9fd3ff_1px,transparent_0)] [background-size:18px_18px]" />
                  <div ref={scroller} className="relative h-full overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_28px)]" aria-live="polite">
                    <div className="flex min-h-full flex-col justify-end gap-1.5 px-3 pb-3 pt-10">
                      <AnimatePresence initial={false}>
                        {shown.map(({ l, key, step }) => (
                          <motion.div key={key} layout={!s.reduced}
                            initial={s.reduced ? false : { opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className={cn('flex flex-col', l.kind === 'you' ? 'items-end' : l.kind === 'day' ? 'items-center py-1' : 'items-start')}>
                            {l.kind === 'day' ? (
                              <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[11px] font-medium text-[#c3d2df] backdrop-blur">{l.text}</span>
                            ) : (
                              <div className={cn('flex max-w-[84%] flex-col', l.kind === 'you' ? 'items-end' : 'items-stretch')}>
                                <div className={cn('relative px-3 pb-1.5 pt-2 text-[13px] leading-[1.38] text-white shadow-[0_1px_1px_rgba(0,0,0,0.25)]',
                                  l.kind === 'you' ? 'rounded-[16px] rounded-br-[5px] bg-[#2b5278]' : 'rounded-[16px] rounded-bl-[5px] bg-[#182533]')}>
                                  <Tail side={l.kind === 'you' ? 'right' : 'left'} className={l.kind === 'you' ? 'text-[#2b5278]' : 'text-[#182533]'} />
                                  <span className="sr-only">{l.kind === 'you' ? 'You: ' : 'Nova: '}</span>
                                  {l.kind === 'nova' && step === s.step ? <Typed text={l.text} /> : l.text}
                                  <span className="float-right ml-2 mt-1.5 inline-flex translate-y-0.5 items-center gap-0.5 text-[10px] text-white/45">
                                    {l.time}
                                    {l.kind === 'you' && <CheckCheck aria-hidden className="size-3 text-[#6ec4ff]" />}
                                  </span>
                                </div>
                                {l.kind === 'nova' && l.buttons && <Keyboard labels={l.buttons} pressed={s.step > step ? TAPPED[step + 1] : undefined} reduced={s.reduced} />}
                                {l.kind === 'nova' && l.link && <span className="mt-1 rounded-[10px] bg-[#1e2c3a]/70 py-[7px] text-center text-[12px] font-medium text-[#dcecff] backdrop-blur-md">{l.link} ↗</span>}
                              </div>
                            )}
                          </motion.div>
                        ))}
                        {typing && (
                          <motion.div key={`typing-${lang}-${s.step}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex">
                            <div className="relative rounded-[16px] rounded-bl-[5px] bg-[#182533] px-3 py-2">
                              <Tail side="left" className="text-[#182533]" />
                              <TypingDots />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* The composer */}
                <div className="relative z-20 flex shrink-0 items-center gap-2 bg-[#17212b] px-3 pb-6 pt-2">
                  <Paperclip aria-hidden className="size-5 shrink-0 -rotate-45 text-[#7d8b99]" />
                  <span className="flex flex-1 items-center rounded-full bg-[#0e1621] px-3 py-[7px] text-[12.5px] text-[#6d7f90] ring-1 ring-white/5">
                    <span className="flex-1">Message, or /today</span>
                    <Smile aria-hidden className="size-4 text-[#6d7f90]" />
                  </span>
                  <Mic aria-hidden className="size-5 shrink-0 text-[#7d8b99]" />
                  {/* Home indicator */}
                  <span aria-hidden className="absolute bottom-1.5 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/70" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* What is happening, when Nova writes, and when it doesn't */}
        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(160deg,rgba(0,229,160,0.08),rgba(42,171,238,0.04)_45%,rgba(255,255,255,0.01))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7ef5cf]">Now in the chat</span>
              <span className="text-[11px] font-medium tabular-nums text-slate-500">{s.step + 1} / {STEPS.length}</span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${s.step}`} className="min-h-[6.5rem] sm:min-h-[6rem]" initial={s.reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                <p className="mt-2 text-xl font-semibold tracking-[-0.01em] text-white sm:text-2xl">{now.label}</p>
                <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-slate-300">{now.caption}</p>
              </motion.div>
            </AnimatePresence>
            <div aria-hidden className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#00E5A0] to-[#2AABEE]"
                animate={{ width: `${((s.step + 1) / STEPS.length) * 100}%` }} transition={{ duration: s.reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">When Nova writes first</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {REASONS.map(r => {
                const on = now.reason === r.id
                return (
                  <li key={r.id} data-on={on || undefined}
                    className={cn('relative flex items-start gap-3 overflow-hidden rounded-2xl border px-3.5 py-3 transition-[border-color,background-color,opacity] duration-300',
                      on ? 'border-[#00E5A0]/45 bg-[#00E5A0]/[0.07]' : 'border-white/[0.07] bg-white/[0.015] opacity-80')}>
                    {on && !s.reduced && <span aria-hidden className="tour-fill absolute bottom-0 left-0 h-px bg-[#00E5A0]/70" style={{ animationDuration: `${STEP_MS}ms` }} key={s.step} />}
                    <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg transition-colors', on ? 'bg-[#00E5A0]/15 text-[#00E5A0]' : 'bg-white/[0.04] text-slate-500')}>
                      <r.icon aria-hidden className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold leading-tight text-slate-100">{r.title}</span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-400">{r.body}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">And stays quiet</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {QUIET.map(q => {
                const on = now.quiet === q.id
                return (
                  <li key={q.id} data-on={on || undefined}
                    className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-300',
                      on ? 'border-[#00E5A0]/45 bg-[#00E5A0]/10 text-[#7ef5cf]' : 'border-white/10 text-slate-400')}>
                    <q.icon aria-hidden className="size-3.5" />{q.text}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
      <StoryControls className="justify-center" count={STEPS.length} step={s.step} go={s.go} paused={s.paused || s.reduced} toggle={s.toggle} labels={LABELS} />
    </div>
  )
}

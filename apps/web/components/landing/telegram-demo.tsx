'use client'

// Nova on Telegram, on the landing page: a few evenings with a mentor that
// writes first. The buttons and fixed lines are the bot's own
// (nova/telegram/telegram-replies.ts: "Start 25 min", "Later", "Not today",
// "How did it go?", "Logged: … min on …"); Nova's own sentences are written
// here and labelled as a sample. Beside the phone, the reasons Nova may write
// and the times it stays quiet (nova/decision/proactive-decision.ts), lit as
// the chat reaches them. Local state only: no bot, no model, no request.

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, BookOpenCheck, CalendarClock, Clock3, HeartPulse, Hourglass, ListTodo, Moon, Send, Sunrise, Timer } from 'lucide-react'
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

// Each step adds lines to the chat and says which rule it shows.
const stepsIn = (lang: Lang): Array<{ label: string; lines: Line[]; reason?: Reason; quiet?: Quiet }> => {
  const t = SAID[lang]
  return [
    {
      label: 'Nova writes first', reason: 'plan',
      lines: [
        { kind: 'day', text: 'Today' },
        { kind: 'nova', time: '6:30 pm', text: t.offer, buttons: ['Start 25 min', 'Later', 'Not today'] },
      ],
    },
    { label: 'One tap starts', reason: 'plan', quiet: 'session', lines: [{ kind: 'nova', time: '6:31 pm', text: 'Running: Gradient descent, 0 of 25 min.', buttons: ['Pause', 'End'] }] },
    {
      label: 'Say how it went', reason: 'plan',
      lines: [
        { kind: 'you', time: '6:57 pm', text: t.done },
        { kind: 'nova', time: '6:57 pm', text: 'Gradient descent. How did it go?', buttons: ['Struggled', 'Okay', 'Good', 'Crushed it'] },
      ],
    },
    { label: 'Logged', reason: 'plan', lines: [{ kind: 'nova', time: '6:57 pm', text: 'Logged: 25 min on Gradient descent. Good.', link: 'Open Nova' }] },
    {
      label: 'An exam close', reason: 'exam',
      lines: [
        { kind: 'day', text: 'Monday' },
        { kind: 'nova', time: '5:45 pm', text: t.exam, buttons: ['Start 30 min', 'Later', 'Not today'] },
      ],
    },
    {
      label: 'A day off', quiet: 'life',
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
const STEP_MS = 2600

// The button tapped to reach a step, kept lit on the message it was on.
const TAPPED: Record<number, string> = { 1: 'Start 25 min', 3: 'Good' }

const REASONS: Array<{ id: Reason; icon: typeof Send; title: string; body: string }> = [
  { id: 'checkin', icon: Sunrise, title: 'Your check-in time', body: 'At the time you choose, once a day.' },
  { id: 'plan', icon: Timer, title: 'Today’s first block', body: 'In your usual study window, with a Start button.' },
  { id: 'review', icon: BookOpenCheck, title: 'A review that’s due', body: 'When a topic’s next review comes round.' },
  { id: 'exam', icon: CalendarClock, title: 'An exam close', body: 'Three days out or nearer.' },
  { id: 'task', icon: ListTodo, title: 'A task due today', body: 'Named, with no topic pushed on you.' },
  { id: 'lapse', icon: Hourglass, title: 'After a few days away', body: 'Once, to help you back in.' },
]
const QUIET: Array<{ id: Quiet; icon: typeof Send; text: string }> = [
  { id: 'night', icon: Moon, text: '11 pm to 7 am' },
  { id: 'session', icon: Clock3, text: 'While you’re in a session' },
  { id: 'recent', icon: Send, text: 'Right after you’ve written' },
  { id: 'life', icon: HeartPulse, text: 'Through illness or a hard day' },
  { id: 'cap', icon: BellOff, text: 'More than twice a day' },
]

function Buttons({ labels, pressed }: { labels: string[]; pressed?: string }) {
  return (
    <span className="mt-1.5 grid grid-cols-2 gap-1" aria-label="Buttons">
      {labels.map((b, i) => (
        <span key={b} className={cn('rounded-lg py-1.5 text-center text-[12px] font-medium transition-colors duration-200',
          labels.length % 2 === 1 && i === 0 && 'col-span-2',
          b === pressed ? 'bg-[#00E5A0]/30 text-white ring-1 ring-[#00E5A0]/70' : 'bg-white/[0.07] text-[#c9e8ff]')}>{b}</span>
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
  const steps = stepsIn(lang)
  const shown = steps.slice(0, s.step + 1).flatMap((st, i) => st.lines.map((l, j) => ({ l, key: `${lang}-${i}-${j}`, step: i })))
  const now = steps[s.step]!
  // Earlier days scroll away the way a chat does: only the last few lines show.
  const tail = shown.slice(-5)

  return (
    <div ref={s.ref} className="space-y-5">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
        {/* The phone */}
        <div className="relative mx-auto w-full max-w-[22rem]">
          <div className="mb-4 flex items-center justify-center gap-2">
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
          <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(42,171,238,0.16),transparent)] blur-2xl" />
          <div className="overflow-hidden rounded-[2.6rem] border border-white/12 bg-[#0b0f17] p-2 shadow-[0_40px_120px_-40px_rgba(0,229,160,0.3)]">
            <div className="relative flex h-[34rem] flex-col overflow-hidden rounded-[2.1rem] bg-[#0e1621]">
              <div aria-hidden className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
              {/* The chat's header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#17212b] px-4 pb-3 pt-9">
                <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#00E5A0] to-[#0f9f86]"><KivoMark size={16} className="text-[#04130e]" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-white">Nova</span>
                  <span className="block text-[11px] text-[#7d8b99]">bot · Sample</span>
                </span>
                <Send aria-hidden className="size-4 text-[#2AABEE]" />
              </div>
              {/* The messages */}
              <div className="relative flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden px-3 py-3 [background:radial-gradient(120%_80%_at_50%_0%,rgba(0,229,160,0.05),transparent),#0e1621]" aria-live="polite">
                <AnimatePresence initial={false} mode="popLayout">
                  {tail.map(({ l, key, step }) => (
                    <motion.div key={key} layout={!s.reduced} initial={s.reduced ? false : { opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className={cn('flex', l.kind === 'you' && 'justify-end', l.kind === 'day' && 'justify-center')}>
                      {l.kind === 'day' ? (
                        <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-[11px] font-medium text-[#9fb0c0]">{l.text}</span>
                      ) : (
                        <div className={cn('max-w-[86%] rounded-2xl px-3 py-2 text-[13px] leading-snug text-white shadow-sm',
                          l.kind === 'you' ? 'rounded-br-md bg-[#2b5278]' : 'rounded-bl-md bg-[#182533]')}>
                          <span className="sr-only">{l.kind === 'you' ? 'You: ' : 'Nova: '}</span>
                          {l.kind === 'nova' && step === s.step ? <Typed text={l.text} /> : l.text}
                          <span className="ml-2 inline-block translate-y-0.5 text-[10px] text-white/45">{l.time}</span>
                          {l.kind === 'nova' && l.buttons && <Buttons labels={l.buttons} pressed={s.step > step ? TAPPED[step + 1] : undefined} />}
                          {l.kind === 'nova' && l.link && <span className="mt-1.5 block rounded-lg bg-white/[0.07] py-1.5 text-center text-[12px] font-medium text-[#c9e8ff]">{l.link} ↗</span>}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-white/5 bg-[#17212b] px-3 py-2.5">
                <span className="flex-1 rounded-full bg-[#0e1621] px-3 py-1.5 text-[12px] text-[#6d7f90]">Message, or /today</span>
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-[#2AABEE]/90"><Send className="size-3.5 text-white" /></span>
              </div>
            </div>
          </div>
        </div>

        {/* When Nova writes, and when it doesn't */}
        <div className="space-y-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">When Nova writes first</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {REASONS.map(r => {
                const on = now.reason === r.id
                return (
                  <li key={r.id} data-on={on || undefined}
                    className={cn('relative flex gap-3 overflow-hidden rounded-2xl border p-3.5 transition-[border-color,background-color] duration-300',
                      on ? 'border-[#00E5A0]/45 bg-[#00E5A0]/[0.06]' : 'border-white/8 bg-white/[0.02]')}>
                    {on && !s.reduced && <span aria-hidden className="tour-fill absolute bottom-0 left-0 h-px bg-[#00E5A0]/70" style={{ animationDuration: `${STEP_MS}ms` }} key={s.step} />}
                    <r.icon aria-hidden className={cn('mt-0.5 size-4 shrink-0 transition-colors', on ? 'text-[#00E5A0]' : 'text-slate-500')} />
                    <span>
                      <span className="block text-sm font-semibold text-slate-100">{r.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-slate-400">{r.body}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">And stays quiet</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {QUIET.map(q => {
                const on = now.quiet === q.id
                return (
                  <li key={q.id} data-on={on || undefined}
                    className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-300',
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

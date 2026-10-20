'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight, BookOpen, Bookmark, Calendar, CalendarDays, Check, CircleHelp, Copy, CreditCard, Gamepad2, Home, Keyboard,
  NotebookPen, Puzzle, Rocket, Search, Send, Settings, ShieldCheck, Sparkles, Timer, TrendingUp, Waypoints, X,
} from 'lucide-react'
import { PLANS, formatPrice } from '@repo/api/billing/plans'
import { PLACES } from '@/lib/creature/places'

// The Kivo handbook: every page and every feature, in one place. Everything
// here describes behaviour that exists: the commands are the ones the
// Telegram bot answers, the extension facts are the ones its README and tests
// hold it to, the plans and the creature's places come from the same lists
// the product uses. When a feature changes, its section here changes with it.

const COMMANDS = [
  { cmd: '/today',    desc: 'Today’s plan: what to do now, then the rest of the day.' },
  { cmd: '/week',     desc: 'The next seven days: today’s plan, reviews falling due, tasks and dates.' },
  { cmd: '/progress', desc: 'How you’re doing: counted sessions this week and lately, and what changed.' },
  { cmd: '/focus',    desc: 'Start a session. Add a topic to choose it yourself: /focus deadlocks.' },
  { cmd: '/done',     desc: 'End the session and say how it went.' },
  { cmd: '/status',   desc: 'Where you stand: a running session, your next exam, what is due for review.' },
  { cmd: '/settings', desc: 'Turn nudges on or off, and see your check-in time and timezone.' },
  { cmd: '/help',     desc: 'This list, inside the chat.' },
]

const SAY_IT = [
  'I have 40 minutes',
  'something came up, can’t study today',
  'recursion isn’t clicking',
  'my OS exam is on the 24th',
  'aaj kya padhna hai?',
  'aaj ke plans update karne hain',
  'something on deep learning instead',
]

const CHAT = [
  { me: true,  text: 'I have 40 minutes' },
  { me: false, text: 'Deadlocks, 40 minutes. Your Operating Systems exam is in 12 days and it is the topic you have touched least.' },
  { me: true,  text: '/focus' },
  { me: false, text: 'Started. Deadlocks, 40 minutes.' },
  { me: true,  text: '/done' },
  { me: false, text: 'Logged: 40 min on Deadlocks. How did it go?' },
]

const EXTENSION_STEPS = [
  { title: 'Open the popup',   body: 'Click the Nova icon in your browser toolbar and choose Get a code from Nova.' },
  { title: 'Get a code',       body: 'Nova opens on Saved. Connect a browser shows a one-time code, good for ten minutes.' },
  { title: 'Type it in',       body: 'Enter the code in the popup. That browser is now connected until you disconnect it or leave it unused for thirty days.' },
]

const EXTENSION_FACTS = [
  'It sees a page only when you click its icon on that page.',
  'Select text before you click, and you can save that passage. It is sent only if you press Save selection.',
  'It reads the address, the title and the text you have selected. Never the rest of the page, forms, passwords or cookies.',
  'It cannot see your other tabs or your history.',
  'It does nothing while the popup is closed.',
]

const COUNTS = [
  { yes: true,  text: 'A finished session of ten minutes or more, with how you said it went.' },
  { yes: false, text: 'A session under ten minutes. It is logged, and moves nothing.' },
  { yes: false, text: 'Saving a page. It tells Nova the page matters to you, not that you know it.' },
  { yes: false, text: 'Ticking a task. Tasks are your to-do list; they are separate from what you have learned.' },
  { yes: false, text: 'Applying a template. It fills in subjects and tasks, and adds no progress.' },
]

const EYEBROW = 'text-[11px] font-medium uppercase tracking-[0.18em] text-keppel-300'
const CARD = 'rounded-3xl border border-white/8 bg-card/70'

// A command you can copy. The tick is the only feedback; a browser that
// refuses the clipboard just leaves the text there to select.
function Command({ cmd, desc }: { cmd: string; desc: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* nothing to do */ }
  }
  return (
    <li className="flex items-start gap-4 py-3.5">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${cmd}`}
        className="group inline-flex w-28 shrink-0 items-center justify-between gap-2 rounded-lg border border-keppel-400/25 bg-keppel-400/8 px-2.5 py-1.5 font-mono text-[13px] text-keppel-300 transition-colors hover:border-keppel-400/50"
      >
        {cmd}
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5 opacity-40 transition-opacity group-hover:opacity-100" />}
      </button>
      <p className="pt-1 text-sm leading-relaxed text-foreground/70">{desc}</p>
    </li>
  )
}

function ChatMock() {
  return (
    <div className={`${CARD} overflow-hidden`} aria-hidden="true">
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-3.5">
        <span className="flex size-9 items-center justify-center rounded-full border border-keppel-400/30 bg-keppel-400/10 text-base">🌿</span>
        <div>
          <p className="text-sm font-semibold text-foreground">Nova</p>
          <p className="text-[11px] text-keppel-300">on Telegram</p>
        </div>
      </div>
      <div className="space-y-2 px-5 py-5">
        {CHAT.map((m, i) => (
          <div key={i} className={`flex ${m.me ? 'justify-end' : 'justify-start'}`}>
            <p className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
              m.me
                ? 'rounded-br-md border border-keppel-400/30 bg-keppel-400/12 text-foreground'
                : 'rounded-bl-md border border-white/8 bg-white/4 text-foreground/75'
            } ${m.text.startsWith('/') ? 'font-mono' : ''}`}>
              {m.text}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-white/8 px-5 py-3">
        <span className="flex-1 rounded-full border border-white/8 px-4 py-2 text-xs text-foreground/35">Message</span>
        <span className="flex size-8 items-center justify-center rounded-full bg-keppel-400 text-keppel-950"><Send className="size-3.5" /></span>
      </div>
    </div>
  )
}

function PopupMock() {
  return (
    <div className={`${CARD} mx-auto w-full max-w-xs p-5`} aria-hidden="true">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Nova</p>
        <p className="flex items-center gap-1.5 text-[11px] text-keppel-300"><span className="size-1.5 rounded-full bg-keppel-400" /> Connected</p>
      </div>
      <div className="mt-4 space-y-3 text-xs">
        {[['Title', 'Deadlock (computer science)'], ['Subject', 'Operating Systems'], ['Topic', 'Deadlocks']].map(([label, value]) => (
          <div key={label}>
            <p className="text-foreground/45">{label}</p>
            <p className="mt-1 truncate rounded-lg border border-white/8 px-3 py-2 text-foreground/85">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 text-xs font-semibold">
        <span className="rounded-lg bg-keppel-400 py-2.5 text-center text-keppel-950">Save to Nova</span>
        <span className="rounded-lg border border-white/12 py-2.5 text-center text-foreground/85">Study this</span>
      </div>
    </div>
  )
}


// ── Building blocks ──────────────────────────────────────────────────────────

const SUB = 'text-base font-semibold text-foreground'
const BODY = 'text-sm leading-relaxed text-foreground/65'
const KBD = 'inline-flex min-w-6 items-center justify-center rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground/85'

type Topic = { id: string; label: string; icon: typeof Home; group: string; keywords: string }

// The handbook's contents, in reading order. `keywords` is what the search
// matches besides the title, so a learner typing "pomodoro" finds Focus.
const TOPICS: Topic[] = [
  { id: 'start',     label: 'Getting started',  icon: Rocket,      group: 'Basics',       keywords: 'setup quiz onboarding subjects exams first day account' },
  { id: 'loop',      label: 'The daily loop',   icon: Sparkles,    group: 'Basics',       keywords: 'how it works plan focus outcome progress' },
  { id: 'today',     label: 'Today',            icon: Home,        group: 'Plan',         keywords: 'home next up plan time available choose another subject focus done today tasks deadlines week goals search new' },
  { id: 'planner',   label: 'Planner & tasks',  icon: Calendar,    group: 'Plan',         keywords: 'days ahead board kanban tasks skip plan change recovery missed days' },
  { id: 'calendar',  label: 'Calendar',         icon: CalendarDays, group: 'Plan',        keywords: 'events classes meetings month week agenda reminders deadlines dates schedule repeat recurring weekly daily monthly' },
  { id: 'focus',     label: 'Focus room',       icon: Timer,       group: 'Plan',         keywords: 'session timer pomodoro pause end scenes sound music rain lofi spotify apple music youtube playlist fullscreen' },
  { id: 'knowledge', label: 'Knowledge',        icon: BookOpen,    group: 'Knowledge',    keywords: 'subjects topics level review due board subject studio archive' },
  { id: 'map',       label: 'Knowledge Map',    icon: Waypoints,   group: 'Knowledge',    keywords: 'graph links pan zoom filter layout drag' },
  { id: 'notes',     label: 'Notes',            icon: NotebookPen, group: 'Knowledge',    keywords: 'editor callout highlight tag link source pdf template ask nova summarise' },
  { id: 'saved',     label: 'Saved pages',      icon: Bookmark,    group: 'Knowledge',    keywords: 'links bookmark save to kivo study this' },
  { id: 'progress',  label: 'Progress & DNA',   icon: TrendingUp,  group: 'Growth',       keywords: 'progress learning dna streak weeks signals insights' },
  { id: 'creature',  label: 'Your creature',    icon: Gamepad2,    group: 'Growth',       keywords: 'world level places arrow keys unlock days in a row' },
  { id: 'telegram',  label: 'Nova on Telegram', icon: Send,        group: 'Nova',         keywords: 'commands chat hinglish hindi nudges check-in language' },
  { id: 'extension', label: 'Browser extension',icon: Puzzle,      group: 'Nova',         keywords: 'chrome edge brave arc save page selection code' },
  { id: 'counts',    label: 'What counts',      icon: Check,       group: 'Nova',         keywords: 'record ten minutes rules honest' },
  { id: 'plans',     label: 'Plans',            icon: CreditCard,  group: 'Account',      keywords: 'free pro price trial billing upgrade rupees' },
  { id: 'shortcuts', label: 'Shortcuts',        icon: Keyboard,    group: 'Account',      keywords: 'keyboard cmd k space f m e' },
  { id: 'privacy',   label: 'Your data',        icon: ShieldCheck, group: 'Account',      keywords: 'privacy delete account export settings theme' },
  { id: 'faq',       label: 'Questions',        icon: CircleHelp,  group: 'Account',      keywords: 'faq help problems' },
]

function Section({ topic, lead, children, hidden }: { topic: Topic; lead: string; children: React.ReactNode; hidden: boolean }) {
  return (
    <section id={topic.id} hidden={hidden} className="scroll-mt-6 border-t border-white/6 pt-12 first:border-t-0 first:pt-2" data-guide-section={topic.id}>
      <p className={`${EYEBROW} flex items-center gap-2`}><topic.icon className="size-3.5" /> {topic.group}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">{topic.label}</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-foreground/60">{lead}</p>
      <div className="mt-7 space-y-6">{children}</div>
    </section>
  )
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} p-5 sm:p-6`}>
      <p className={SUB}>{title}</p>
      <div className={`mt-2 ${BODY} [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5`}>{children}</div>
    </div>
  )
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-4 ${cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
}

function Steps({ steps }: { steps: Array<{ title: string; body: React.ReactNode }> }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, i) => (
        <li key={step.title} className={`${CARD} relative overflow-hidden p-6`}>
          <span aria-hidden className="pointer-events-none absolute -right-3 -top-6 font-mono text-[5.5rem] font-semibold leading-none text-keppel-300/8">{i + 1}</span>
          <p className="font-mono text-sm font-semibold text-keppel-300">Step {i + 1}</p>
          <p className="mt-3 text-base font-semibold text-foreground">{step.title}</p>
          <p className={`mt-2 ${BODY}`}>{step.body}</p>
        </li>
      ))}
    </ol>
  )
}

function OpenLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 transition-colors hover:border-keppel-400/40 hover:bg-white/5">
      {children} <ArrowUpRight className="size-3.5 text-foreground/40" />
    </Link>
  )
}

const SHORTCUTS: Array<{ keys: string[]; where: string; what: string }> = [
  { keys: ['⌘', 'K'],  where: 'Anywhere in the app', what: 'Search: any page, subject, topic, note, saved page or task' },
  { keys: ['Space'],   where: 'Focus',               what: 'Pause or resume the session' },
  { keys: ['F'],       where: 'Focus',               what: 'Fullscreen' },
  { keys: ['S'],       where: 'Focus',               what: 'Open the sound panel' },
  { keys: ['M'],       where: 'Focus',               what: 'Mute or unmute' },
  { keys: ['E'],       where: 'A note',              what: 'Edit it' },
  { keys: ['⌘', 'S'],  where: 'Editing a note',      what: 'Save' },
  { keys: ['⌘', 'B'],  where: 'Editing a note',      what: 'Bold' },
  { keys: ['⌘', 'I'],  where: 'Editing a note',      what: 'Italic' },
  { keys: ['⌘', '⇧', 'E'], where: 'Editing a note',  what: 'Highlight' },
  { keys: ['Esc'],     where: 'A note with its source open', what: 'Close the source' },
  { keys: ['←', '↑', '→', '↓'], where: 'Creature',   what: 'Walk to the nearest open place that way' },
  { keys: ['⇧', '←/→'], where: 'Creature',           what: 'Turn the camera (or Q and E)' },
]

const FAQ = [
  { q: 'I closed the tab mid-session. Is it lost?', a: 'No. Sessions are timed on Kivo’s server, not in the page. Open Focus again, here or on another device, and the clock is where it should be. Telegram sees the same session.' },
  { q: 'Why did a session not change my Knowledge?', a: 'Sessions under ten minutes are kept but move nothing, and a session on a topic that isn’t filed under one of your subjects can’t be tied to Knowledge yet. Finish ten minutes or more, on a topic of a subject, and say how it went.' },
  { q: 'Nova picked a topic I don’t want today.', a: 'Use Choose another on Today, start a different block from the plan, or tell Nova on Telegram (“something on deep learning instead”). Skipping a topic for the day is a plan change you can undo.' },
  { q: 'Can Nova remind me at a set time?', a: 'Not yet. It checks in around the time you picked on days you haven’t studied, and messages first only when something is due, at most twice a day. It says so plainly if you ask for a reminder.' },
  { q: 'Does saving a page or ticking a task count as studying?', a: 'No. Only finished, timed sessions move the record. Saved pages and tasks are how you organise; sessions are how you learn.' },
  { q: 'What happens to my notes if I stop paying for Pro?', a: 'Nothing. Your notes, Knowledge, saved pages and history stay yours on every plan. Pro changes how much you can ask Nova each day, not what you own.' },
]

// ── The page ─────────────────────────────────────────────────────────────────

export function NovaGuide() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(TOPICS[0]!.id)

  // Sections matching every word typed, in their title, group or keywords.
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(' ').filter(Boolean)
    if (words.length === 0) return new Set(TOPICS.map(t => t.id))
    return new Set(TOPICS.filter(t => words.every(w => `${t.label} ${t.group} ${t.keywords}`.toLowerCase().includes(w))).map(t => t.id))
  }, [query])
  const hide = (id: string) => !shown.has(id)

  // The contents follow the reader down the page.
  useEffect(() => {
    const els = TOPICS.map(t => document.getElementById(t.id)).filter((e): e is HTMLElement => e !== null)
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setActive(visible[0].target.id)
    }, { rootMargin: '0px 0px -65% 0px' })
    for (const el of els) observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const groups = [...new Set(TOPICS.map(t => t.group))]
  const topic = (id: string) => TOPICS.find(t => t.id === id)!
  const pro = PLANS.pro_monthly

  return (
    <div className="mx-auto w-full max-w-7xl pb-24 pt-10 lg:pt-4">
      {/* Hero */}
      <header className={`${CARD} relative overflow-hidden p-7 sm:p-11`}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full bg-keppel-400/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 left-1/4 size-80 rounded-full bg-keppel-400/8 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
          <div>
            <p className={EYEBROW}>The Kivo handbook</p>
            <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.08]">
              Everything Kivo does, and how to get the most from it.
            </h1>
            <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-foreground/60">
              Kivo is one learning environment in three places: this web app, Nova in a Telegram chat, and a browser extension. They share one record, so what you do in one shows up in the others. This handbook covers every page and every feature.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-center lg:grid-cols-1 lg:text-left">
            {[['Pages', '11'], ['Telegram commands', String(COMMANDS.length)], ['Rule that matters', 'Only real study counts']].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <dt className="text-[11px] text-foreground/50">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {/* Contents */}
        <nav aria-label="Handbook contents" className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <label className="relative block">
            <span className="sr-only">Search the handbook</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/40" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the handbook"
              className="h-10 w-full rounded-xl border border-white/10 bg-transparent pl-9 pr-8 text-sm text-foreground placeholder:text-foreground/40 focus:border-keppel-400/60 focus:outline-none" />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-foreground/50 hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>
            )}
          </label>
          <div className="mt-4 hidden space-y-5 lg:block">
            {groups.map(group => {
              const items = TOPICS.filter(t => t.group === group && shown.has(t.id))
              if (items.length === 0) return null
              return (
                <div key={group}>
                  <p className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">{group}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {items.map(t => (
                      <li key={t.id}>
                        <a href={`#${t.id}`} aria-current={active === t.id ? 'location' : undefined}
                          className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${active === t.id ? 'bg-keppel-400/12 font-medium text-keppel-200' : 'text-foreground/65 hover:bg-white/4 hover:text-foreground'}`}>
                          <t.icon className="size-4 shrink-0 opacity-70" /> {t.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
          {/* On a phone: the contents as chips. */}
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {TOPICS.filter(t => shown.has(t.id)).map(t => (
              <li key={t.id} className="shrink-0"><a href={`#${t.id}`} className="inline-flex h-8 items-center rounded-full border border-white/12 px-3 text-xs text-foreground/75">{t.label}</a></li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-12">
          {shown.size === 0 && <p className="rounded-2xl border border-dashed border-white/12 px-5 py-8 text-sm text-foreground/60">Nothing in the handbook matches “{query}”. Try a page name, like Focus or Notes.</p>}

          <Section topic={topic('start')} hidden={hide('start')} lead="Five minutes to set up, and Nova has what it needs to plan your days.">
            <Steps steps={[
              { title: 'Make your account', body: 'Sign up with email (Kivo sends an eight-digit code to confirm it) or continue with Google.' },
              { title: 'Answer a few questions', body: 'Who you are (school, college or work), what you want help with first, four quick ones about how you like to be helped, and a name for your companion. They set Nova’s words, tone and where setup starts; they decide nothing else, and you can change every answer in Settings.' },
              { title: 'Tell Nova your subjects', body: 'Name your subjects and their topics, your exam dates and how long you usually have. Or start from a template, like a computer science semester, and edit it.' },
              { title: 'Connect Telegram', body: 'Optional, and worth it: from Today or Settings. Nova can then plan, start sessions and log them from a chat.' },
            ]} />
            <Grid>
              <Feature title="Templates to start from">
                Study templates fill in subjects, topics and a few tasks in one step: computer science semester, exam preparation, learn a skill, school subjects, semester subjects, project sprint, interview preparation and certification. Applying one twice leaves one of everything, and none of it counts as progress. Find them in <Link href="/settings/study" className="text-keppel-300 hover:underline">Subjects and templates</Link>.
              </Feature>
              <Feature title="Change anything later">
                Subjects, topics, exam dates and your daily time can all be edited: on the Knowledge Space with Edit subjects, in Settings, or by telling Nova on Telegram (“my OS exam is on the 24th”).
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('loop')} hidden={hide('loop')} lead="Kivo is built around one loop. Every page is a way into it, or a view of what it has recorded.">
            <Steps steps={[
              { title: 'Ask what is next', body: 'Today picks one topic from your subjects, exam dates and what you have studied least. Tell it how long you have and the plan fits the time.' },
              { title: 'Focus on it', body: 'Start a session. Kivo times it on its server, so you can close the tab or switch to Telegram and it keeps running.' },
              { title: 'Say how it went', body: 'Struggled, Okay, Good or Crushed it. That answer, with the minutes, is what moves a topic forward and sets when to revisit it.' },
              { title: 'Watch it add up', body: 'Knowledge, Progress, Learning DNA and your creature all read the same record. Nothing is estimated from a quiz or a guess.' },
            ]} />
          </Section>

          <Section topic={topic('today')} hidden={hide('today')} lead="Your working page for the day: what to do now, what comes after, and what is on your plate.">
            <Grid>
              <Feature title="Next up">
                The one block to do now, with its subject, length and why Nova chose it (open Why this?). Start runs a session of that length on that topic. While a session runs, the card shows it instead, with a way back to Focus.
              </Feature>
              <Feature title="Today's flow and your time">
                The day as a strip of blocks, each as long as its minutes, against your daily budget. What you finished today comes first, marked done: the plan is the rest of the day, so a topic you just studied is not handed back and the next block moves up. Tell Nova how long you have (20 minutes to an hour and a half) and the plan is refitted on the server to that time.
              </Feature>
              <Feature title="Which subject today">
                Pick a subject under the greeting and the whole day is planned for it alone, carrying on from where you left off in it: each card shows how many of its topics you have started and the last one you studied. All subjects goes back to Nova&apos;s pick across everything. The choice holds for the rest of the day, here and on the Planner.
              </Feature>
              <Feature title="Then, and Choose another">
                The rest of the plan in order, each with Start instead. Choose another offers other topics that fit right now, without changing the plan.
              </Feature>
              <Feature title="Linked to this topic">
                The notes and saved pages you filed under the topic you are about to study, and where it sits on the Knowledge Map, so what you need is one click away.
              </Feature>
              <Feature title="Your tasks">
                Your own to-do list, by when it is due: add a task with a date, a priority and a topic, edit it, tick it, or start a session on its topic with Focus. Tasks never count as study.
              </Feature>
              <Feature title="The margin">
                Deadlines (exams and dated tasks), this week beside the eight before it, where you left off, what you are working toward, your creature and the Telegram connection.
              </Feature>
            </Grid>
            <Feature title="Search and New">
              Search (<kbd className={KBD}>⌘</kbd> <kbd className={KBD}>K</kbd>, or Ctrl K) jumps to any page, subject, topic, note, saved page or task, and can make a task from what you typed. New adds a task, a note, a link to save or a session.
            </Feature>
          </Section>

          <Section topic={topic('planner')} hidden={hide('planner')} lead="The days ahead, and the board where your tasks live.">
            <Grid>
              <Feature title="The plan for the coming days">
                What Nova plans for each day ahead, block by block, against the time you have each day. Change the time for today and the plan follows; the Planner explains what set the length of a day.
              </Feature>
              <Feature title="Plan changes you can undo">
                Skip a topic for today from the plan or on Telegram (“skip deadlocks today”): Nova asks first, writes one change, and Undo takes it back. Skipped topics come back tomorrow.
              </Feature>
              <Feature title="The task board">
                Your tasks as cards in To do, In progress and Done. Drag a card to move it; the order you leave is the order you get back.
              </Feature>
              <Feature title="Back on track after missed days">
                After a few days away, Today offers to spread what slipped over the coming days. Nothing moves unless you say yes.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('calendar')} hidden={hide('calendar')} lead="Your events, the tasks due each day and your dates, in one place.">
            <Grid>
              <Feature title="Month, week and agenda">
                Move by month, week or four weeks at a time, and Today brings you back. Events show a thin bar in the colour of their kind; a circle is a task due that day; a flag is an exam or deadline.
              </Feature>
              <Feature title="One record for each thing">
                A task on the calendar is the same task as on the board, and a deadline the same date Nova plans around. Add either from a day on the calendar and it appears everywhere; nothing is copied.
              </Feature>
              <Feature title="Events and time for a task">
                Add a class, meeting, study block or something personal, at a time or all day. From a task, Set aside time puts a block on the calendar for it; the task itself stays where it is.
              </Feature>
              <Feature title="Reminders">
                Choose a reminder on an event and Nova sends it on Telegram at that time, once. Moving or deleting the event moves or cancels it. Without Telegram connected a reminder is saved but not sent, and the calendar says so.
              </Feature>
              <Feature title="Repeating events">
                Set an event to repeat every day, every week on the days you pick (a contest every Wednesday at 8 pm), or every month, with an optional last date. Its reminder goes out before each date. Changing it changes every date; deleting asks whether to remove only that date or every date.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('focus')} hidden={hide('focus')} lead="A room to study in. The session is Nova's, timed on the server; the scene and the sound are yours.">
            <Grid cols={3}>
              <Feature title="The clock">
                A large clock that counts down your planned block; tap it to show time studied instead. Pause and resume as often as you need (breaks are counted), then End session and say how it went.
              </Feature>
              <Feature title="Scenes">
                Five backdrops drawn live in Kivo&apos;s colours: Aurora, Rain, Night sky, Embers and Forest. They pause when the tab is hidden and stay still if your device asks for reduced motion.
              </Feature>
              <Feature title="Soundscapes">
                Rain, forest, ocean, fireplace, café, brown noise and white noise, made in your browser, so nothing downloads. Turn on several and set each one&apos;s volume; Kivo remembers your mix on this device.
              </Feature>
              <Feature title="Playlists">
                Lo-fi in YouTube&apos;s, Spotify&apos;s or Apple Music&apos;s own player: Lofi Girl&apos;s lofi hip hop radio and synthwave radio (YouTube live), Lofi Girl&apos;s playlist on Spotify and on Apple Music, Deep Focus, lofi beats and Peaceful Piano. If YouTube&apos;s player stays empty (it has in Safari), the Spotify or Apple Music Lofi Girl plays the same music. Or paste a link to your own Spotify, Apple Music or YouTube playlist, album or song: it is kept in that browser under Your music. Music keeps playing when you close the sound panel, alongside any soundscapes. Spotify and Apple Music play whole songs when you are signed in to them in that browser, otherwise short previews.
              </Feature>
              <Feature title="On this topic">
                A panel with where the topic stands on the record and the notes and pages you filed under it, without leaving the room.
              </Feature>
              <Feature title="The ten-minute rule">
                A session of ten minutes or more, with your answer to How did it go?, updates the topic and when to revisit it. Shorter ones are logged and move nothing.
              </Feature>
            </Grid>
            <div className="flex flex-wrap gap-2"><OpenLink href="/focus">Open Focus</OpenLink></div>
          </Section>

          <Section topic={topic('knowledge')} hidden={hide('knowledge')} lead="Every subject and topic on record, what you filed under them, and what is due to revisit.">
            <Grid>
              <Feature title="Subjects and their topics">
                The outline on the left lists your subjects; open one to see its topics as a list, each with its level, how many sessions are behind it and when it is next due, or as a board of the notes and saved pages filed under each topic.
              </Feature>
              <Feature title="Levels and reviews">
                A topic&apos;s level moves with how you say each session went: an estimate, not a test result, worth more with more sessions. How the last session went sets when it is due again; due topics appear under Due for review, ready to start.
              </Feature>
              <Feature title="Edit subjects">
                Subject Studio adds and renames subjects and topics, and archives a topic you have finished with. Archived topics keep their history and can be restored.
              </Feature>
              <Feature title="Study straight from a topic">
                Every topic row can start a 25-minute session, show what it is connected to, and open its related topics.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('map')} hidden={hide('map')} lead="Your subjects, topics, notes and saved pages as one graph.">
            <Grid>
              <Feature title="Find your way">
                Pan, zoom and filter by kind. Select anything to see what it links to and open it. Links come from what you wrote: a note that writes [[Deadlocks]] is joined to Deadlocks.
              </Feature>
              <Feature title="Arrange it your way">
                Drag items where you want them; Kivo remembers each position for you, and anything you have not moved is placed for you.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('notes')} hidden={hide('notes')} lead="A notebook that reads like a good book: your own notes, filed under a subject and topic, linked to each other.">
            <Grid>
              <Feature title="The workspace">
                Your notebook by subject and topic on the left, the note in the middle, its outline, tags and backlinks on the right, and a status line with links and words. A note with a <code className="rounded bg-white/8 px-1">Source:</code> line can open that page or PDF beside it, so you read and write side by side.
              </Feature>
              <Feature title="Writing">
                A toolbar for headings, bold, italic, highlight, code, lists, note links, tags and dividers; Write, Split (live preview beside the text) and Preview. Unsaved text is kept in your browser until you save, and a save never overwrites a newer version.
              </Feature>
              <Feature title="Callouts for what you read">
                Paste a passage, select it and press the quote button: it becomes a callout, and the cursor waits under it for your own words. Callouts can also be ideas, questions, warnings, summaries, examples and definitions, and can fold.
                <ul><li><code className="rounded bg-white/8 px-1">&gt; [!quote] Title</code> starts one</li><li><code className="rounded bg-white/8 px-1">==text==</code> highlights, <code className="rounded bg-white/8 px-1">#tag</code> tags, <code className="rounded bg-white/8 px-1">[[Title]]</code> links a note</li></ul>
              </Feature>
              <Feature title="Ask Nova about a note">
                Summarise, Suggest a structure, Key concepts, Suggest connections, or ask your own question. Nova reads the note and a few related notes and saved pages; it changes nothing unless you choose to use what it wrote.
              </Feature>
              <Feature title="Templates">
                Concept, Source notes, Class notes, Chapter summary, Doubts and mistakes, Decision and Learning log, offered when you start a new note.
              </Feature>
              <Feature title="From a note to a session">
                Study this starts a session on the note&apos;s topic; Make a review task puts it on your board. The note itself never counts as study.
              </Feature>
            </Grid>
            <div className="flex flex-wrap gap-2"><OpenLink href="/notes">Open Notes</OpenLink></div>
          </Section>

          <Section topic={topic('saved')} hidden={hide('saved')} lead="Pages you want to come back to, kept with the subject and topic they belong to.">
            <Grid>
              <Feature title="Three ways to save">
                Paste a link on Saved, add the Save to Kivo bookmark to your browser and send any page with one click (works on phones and Safari too), or use the browser extension.
              </Feature>
              <Feature title="Study from what you saved">
                A saved page can start a session on its topic, or open a new note with the page already named as its source.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('progress')} hidden={hide('progress')} lead="What has changed since your first session, read only from sessions you finished.">
            <Grid>
              <Feature title="Progress">
                An overview of your counted sessions and minutes, what changed lately, how your topics have grown, how steady your weeks have been, a journey of the milestones along the way, and your next exam.
              </Feature>
              <Feature title="Learning DNA">
                What Nova has learned about how you study: how long your sessions usually run and which length goes best, the part of the day that goes best, how often you study each week, how closely you follow the plan, how far apart revisits work best, and the topics you keep struggling with. Each comes with how sure it is and the sessions behind it, and it says nothing until there is enough to go on.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('creature')} hidden={hide('creature')} lead={`A small world that grows with the days you study: a level for every five study days. It never shrinks for a day off.`}>
            <Grid>
              <Feature title="Walk it around">
                The arrow keys send your creature to the nearest open place that way on screen; Shift with left or right (or Q and E) turns the camera. Or click a place in the Places list. Left alone, it keeps its own routine among the places you have opened.
              </Feature>
              <Feature title="Places open with your streak">
                <ul>
                  {PLACES.map(p => <li key={p.id}><span className="text-foreground/85">{p.name}</span>{p.unlockDays === 0 ? ', open from the start' : `, after ${p.unlockDays} days in a row`}</li>)}
                </ul>
              </Feature>
            </Grid>
            <div className="flex flex-wrap gap-2"><OpenLink href="/creature">Visit your world</OpenLink></div>
          </Section>

          <Section topic={topic('telegram')} hidden={hide('telegram')} lead="Connect your chat from Today or Settings. Commands and buttons answer instantly; a plain message is read and answered in your own words.">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
              <div className={`${CARD} p-6 sm:p-8`}>
                <ul className="divide-y divide-white/6">
                  {COMMANDS.map(c => <Command key={c.cmd} {...c} />)}
                </ul>
              </div>
              <ChatMock />
            </div>
            <div className={`${CARD} p-6`}>
              <p className={SUB}>No command needed</p>
              <p className={`mt-2 ${BODY}`}>Say what is going on and Nova works out what to do with it.</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {SAY_IT.map(s => (
                  <li key={s} className="rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-xs text-foreground/75">“{s}”</li>
                ))}
              </ul>
            </div>
            <Grid>
              <Feature title="English, Hinglish or Hindi">
                Write in Hinglish and Nova answers in Hinglish, commands included; write in Hindi (Devanagari) and its replies are in Hindi. Each reply follows the message it answers, so switching is just writing in the other language.
              </Feature>
              <Feature title="Nudges, not alarms">
                Nova checks in around the time you picked, on days you haven&apos;t studied yet, and otherwise messages first only when something is due: at most twice a day. Change the time in Settings; <span className="font-mono text-keppel-300">/settings</span> on Telegram turns it all off. It cannot set a one-off reminder yet, and says so if you ask.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('extension')} hidden={hide('extension')} lead="On any page, click the Kivo icon to save it under a subject or start a study session on it. Works in Chrome, Edge, Brave and Arc. Safari is not supported yet.">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center">
              <div>
                <ol className="space-y-4">
                  {EXTENSION_STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-4">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-keppel-400/30 bg-keppel-400/10 font-mono text-sm text-keppel-300">{i + 1}</span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{step.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-foreground/60">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <Link href="/saved" className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
                  <Puzzle className="size-4" /> Connect a browser
                </Link>
              </div>
              <PopupMock />
            </div>
            <div className={`${CARD} p-6 sm:p-8`}>
              <p className={SUB}>What the extension can see</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {EXTENSION_FACTS.map(fact => (
                  <li key={fact} className="flex gap-3 text-sm leading-relaxed text-foreground/70">
                    <Check className="mt-0.5 size-4 shrink-0 text-keppel-300" /> {fact}
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section topic={topic('counts')} hidden={hide('counts')} lead="Kivo would rather show you nothing than something made up. This is the whole rule.">
            <div className={`${CARD} p-6 sm:p-8`}>
              <ul className="space-y-4">
                {COUNTS.map(row => (
                  <li key={row.text} className="flex items-start gap-4">
                    <span className={`mt-0.5 inline-flex w-24 shrink-0 justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                      row.yes ? 'bg-keppel-400/15 text-keppel-300' : 'bg-white/5 text-foreground/50'
                    }`}>
                      {row.yes ? 'Counts' : 'Does not'}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground/75">{row.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section topic={topic('plans')} hidden={hide('plans')} lead="Kivo is free to use. Pro is for when you lean on Nova every day.">
            <Grid>
              {[PLANS.free, pro].map(plan => (
                <div key={plan.key} className={`${CARD} p-6 ${plan.key === pro.key ? 'border-keppel-400/30' : ''}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={SUB}>{plan.name}</p>
                    <p className="text-lg font-semibold text-foreground">{formatPrice(plan)}<span className="text-sm font-normal text-foreground/50">{plan.interval ? `/${plan.interval}` : ''}</span></p>
                  </div>
                  <p className={`mt-1 ${BODY}`}>{plan.tagline}</p>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map(f => <li key={f} className="flex gap-2.5 text-sm text-foreground/75"><Check className="mt-0.5 size-4 shrink-0 text-keppel-300" /> {f}</li>)}
                  </ul>
                </div>
              ))}
            </Grid>
            <p className={BODY}>Your notes, Knowledge, saved pages and history are yours on every plan; nothing is deleted when a trial or a subscription ends.</p>
          </Section>

          <Section topic={topic('shortcuts')} hidden={hide('shortcuts')} lead="The keys that save you a click. On Windows and Linux, Ctrl stands in for ⌘.">
            <div className={`${CARD} overflow-hidden`}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/8 text-[11px] uppercase tracking-[0.14em] text-foreground/45">
                  <tr><th className="px-5 py-3 font-medium">Keys</th><th className="px-5 py-3 font-medium">Where</th><th className="px-5 py-3 font-medium">What it does</th></tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {SHORTCUTS.map(s => (
                    <tr key={`${s.where}-${s.what}`}>
                      <td className="whitespace-nowrap px-5 py-3"><span className="flex flex-wrap gap-1">{s.keys.map(k => <kbd key={k} className={KBD}>{k}</kbd>)}</span></td>
                      <td className="px-5 py-3 text-foreground/55">{s.where}</td>
                      <td className="px-5 py-3 text-foreground/80">{s.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section topic={topic('privacy')} hidden={hide('privacy')} lead="What Kivo keeps, and how you stay in charge of it.">
            <Grid>
              <Feature title="Yours, and only yours">
                Your notes, subjects, sessions and saved pages belong to your account and no one else sees them. Nova reads them to plan and to answer you; it never posts or shares anything.
              </Feature>
              <Feature title="Settings">
                Light, dark or match your device; your check-in time and timezone; your Telegram connection and connected browsers. Deleting your account removes it and everything in it.
              </Feature>
            </Grid>
            <div className="flex flex-wrap gap-2"><OpenLink href="/settings"><Settings className="size-4" /> Settings</OpenLink><OpenLink href="/privacy">Privacy</OpenLink></div>
          </Section>

          <Section topic={topic('faq')} hidden={hide('faq')} lead="The questions people ask most.">
            <div className="space-y-2">
              {FAQ.map(item => (
                <details key={item.q} className={`${CARD} group p-0`}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                    {item.q}<span aria-hidden className="text-lg text-foreground/40 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className={`px-6 pb-5 ${BODY}`}>{item.a}</p>
                </details>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight, BookOpen, Bookmark, Calendar, Check, Copy, Dna, Home, Map, NotebookPen,
  Puzzle, Send, Settings, Timer, TrendingUp, Waypoints,
} from 'lucide-react'

// What Nova does, in one place. Everything here describes behaviour that
// exists: the commands are the ones the Telegram bot answers, the extension
// facts are the ones its README and tests hold it to.

const SECTIONS = [
  { id: 'loop',      label: 'The loop' },
  { id: 'telegram',  label: 'Telegram' },
  { id: 'extension', label: 'Browser extension' },
  { id: 'pages',     label: 'Your pages' },
  { id: 'counts',    label: 'What counts' },
]

const LOOP = [
  { title: 'Ask what is next',   body: 'Today picks one topic from your subjects, exam dates and what you have studied least. Tell it how long you have and it fits the time.' },
  { title: 'Focus on it',        body: 'Start a session. Nova times it on the server, so you can close the tab or switch to Telegram and it is still running.' },
  { title: 'Say how it went',    body: 'Struggled, Okay, Good or Crushed it. That answer, with the minutes, is the only thing that moves a topic forward.' },
  { title: 'Watch it add up',    body: 'Progress, the Knowledge Map and your creature all read the same record. Nothing is estimated from a quiz or a guess.' },
]

const COMMANDS = [
  { cmd: '/today',    desc: 'What to do now, from your plan.' },
  { cmd: '/focus',    desc: 'Start a session. Add a topic to choose it yourself: /focus deadlocks.' },
  { cmd: '/done',     desc: 'End the session and say how it went.' },
  { cmd: '/status',   desc: 'Where you stand: a running session, your next exam, what is due for review.' },
  { cmd: '/settings', desc: 'Turn nudges on or off and check your timezone.' },
  { cmd: '/help',     desc: 'This list, inside the chat.' },
]

const SAY_IT = [
  'I have 40 minutes',
  'something came up, can’t study today',
  'recursion isn’t clicking',
  'my OS exam is on the 24th',
  'aaj kya padhna hai?',
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
  'It reads the address and the title. Never the text, forms, passwords or cookies.',
  'It cannot see your other tabs or your history.',
  'It does nothing while the popup is closed.',
]

const PAGES = [
  { href: '/home',         label: 'Today',         icon: Home,        body: 'The one thing to do next, your tasks, deadlines and where you left off.' },
  { href: '/planner',      label: 'Planner',       icon: Calendar,    body: 'The study plan for the days ahead, and a task board you drag cards across.' },
  { href: '/focus',        label: 'Focus',         icon: Timer,       body: 'The session timer. Ends by asking how it went.' },
  { href: '/knowledge',    label: 'Knowledge',     icon: BookOpen,    body: 'Every topic by subject, with where each one stands.' },
  { href: '/map',          label: 'Knowledge Map', icon: Waypoints,   body: 'Subjects, topics, notes and saved pages as a graph you can pan, zoom and filter.' },
  { href: '/notes',        label: 'Notes',         icon: NotebookPen, body: 'Your own notes, filed under a subject and topic.' },
  { href: '/saved',        label: 'Saved',         icon: Bookmark,    body: 'Pages sent from the browser extension, and where you connect a browser.' },
  { href: '/progress',     label: 'Progress',      icon: TrendingUp,  body: 'What has changed since your first session, from sessions you finished.' },
  { href: '/learning-dna', label: 'Learning DNA',  icon: Dna,         body: 'What Nova has learned about how you study, with how sure it is and why.' },
  { href: '/creature',     label: 'Creature',      icon: Map,         body: 'A small world that grows with the days you study. It never shrinks for a day off.' },
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

function Section({ id, eyebrow, title, lead, children }: { id: string; eyebrow: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 pt-16">
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/60">{lead}</p>
      <div className="mt-7">{children}</div>
    </section>
  )
}

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

export function NovaGuide() {
  return (
    <div className="mx-auto w-full max-w-6xl pb-24 pt-10 lg:pt-4">
      {/* Hero */}
      <header className={`${CARD} relative overflow-hidden p-7 sm:p-11`}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full bg-keppel-400/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 left-1/4 size-80 rounded-full bg-keppel-400/8 blur-3xl" />
        <div className="relative">
          <p className={EYEBROW}>Guide</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.08]">
            Everything Nova can do, and how to ask for it.
          </h1>
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-foreground/60 sm:text-base">
            Nova lives in three places: this web app, a Telegram chat and a browser extension. They share one record, so what you do in one shows up in the others.
          </p>
          <nav aria-label="Guide sections" className="mt-7 flex flex-wrap gap-2">
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`} className="inline-flex h-9 items-center rounded-full border border-white/12 px-4 text-sm text-foreground/80 transition-colors hover:border-keppel-400/50 hover:text-foreground">
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <Section id="loop" eyebrow="The loop" title="Four steps, every day" lead="Nova is built around one loop. Everything else on this page is a way into it.">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map((step, i) => (
            <li key={step.title} className={`${CARD} p-6`}>
              <p className="font-mono text-3xl font-semibold text-keppel-300/80">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-4 text-base font-semibold text-foreground">{step.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/60">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="telegram" eyebrow="Telegram" title="Commands, or just say it" lead="Connect your chat from Today or Settings. Commands and buttons answer instantly; a plain message is read and answered in your own words.">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
          <div className={`${CARD} p-6 sm:p-8`}>
            <ul className="divide-y divide-white/6">
              {COMMANDS.map(c => <Command key={c.cmd} {...c} />)}
            </ul>
          </div>
          <ChatMock />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className={`${CARD} p-6 lg:col-span-2`}>
            <p className="text-base font-semibold text-foreground">No command needed</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/60">Say what is going on and Nova works out what to do with it.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SAY_IT.map(s => (
                <li key={s} className="rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-xs text-foreground/75">“{s}”</li>
              ))}
            </ul>
          </div>
          <div className={`${CARD} p-6`}>
            <p className="text-base font-semibold text-foreground">English or Hinglish</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/60">
              Write in Hinglish and Nova answers in Hinglish, commands included. Switch back to English any time by writing in English.
            </p>
          </div>
          <div className={`${CARD} p-6`}>
            <p className="text-base font-semibold text-foreground">Nudges, not alarms</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/60">
              Nova messages first only when something is due, at most twice a day, and <span className="font-mono text-keppel-300">/settings</span> turns that off. It cannot set a reminder for a time you choose yet.
            </p>
          </div>
        </div>
      </Section>

      <Section id="extension" eyebrow="Browser extension" title="Save what you are reading" lead="On any page, click the Nova icon to save it under a subject or start a study session on it. Works in Chrome, Edge, Brave and Arc. Safari is not supported yet.">
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

        <div className={`${CARD} mt-6 p-6 sm:p-8`}>
          <p className="text-base font-semibold text-foreground">What the extension can see</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {EXTENSION_FACTS.map(fact => (
              <li key={fact} className="flex gap-3 text-sm leading-relaxed text-foreground/70">
                <Check className="mt-0.5 size-4 shrink-0 text-keppel-300" /> {fact}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="pages" eyebrow="Your pages" title="Where everything lives" lead="Ten pages, one record behind them.">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAGES.map(page => (
            <li key={page.href}>
              <Link href={page.href} className={`${CARD} group flex h-full flex-col p-6 transition-colors hover:border-keppel-400/40`}>
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl border border-keppel-400/25 bg-keppel-400/8 text-keppel-300"><page.icon className="size-5" /></span>
                  <ArrowUpRight className="size-4 text-foreground/30 transition-colors group-hover:text-keppel-300" />
                </div>
                <p className="mt-5 text-base font-semibold text-foreground">{page.label}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/60">{page.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="counts" eyebrow="What counts" title="Only real study moves the record" lead="Nova would rather show you nothing than something made up. This is the whole rule.">
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

        <div className={`${CARD} mt-6 flex flex-wrap items-center justify-between gap-4 p-6 sm:px-8`}>
          <div>
            <p className="text-base font-semibold text-foreground">Make it yours</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/60">Light or dark theme, your subjects and exam dates, templates, and your Telegram connection.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5">
              <Settings className="size-4" /> Settings
            </Link>
            <Link href="/settings/study" className="inline-flex h-10 items-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5">
              Subjects and templates
            </Link>
          </div>
        </div>
      </Section>
    </div>
  )
}

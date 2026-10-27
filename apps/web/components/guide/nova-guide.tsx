'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight, BookOpen, Bookmark, CalendarDays, Check, CircleHelp, Copy, CreditCard, Gamepad2, Home, Keyboard,
  NotebookPen, Puzzle, Rocket, Search, Send, Settings, ShieldCheck, Sparkles, Timer, TrendingUp, Waypoints, X,
} from 'lucide-react'
import { PLANS, formatPrice } from '@repo/api/billing/plans'
import { NOVA_ROUTES } from '@repo/api/nova/product/companion'
import { PLACES } from '@/lib/creature/places'

// Kio's Docs: every page and every feature, in one place. Everything
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
  { title: 'Get a code',       body: 'Kio opens its Browser Extension page. Connect a browser shows a one-time code, good for ten minutes.' },
  { title: 'Type it in',       body: 'Enter the code in the popup. That browser is now connected until you disconnect it or leave it unused for thirty days.' },
]

const EXTENSION_FACTS = [
  'It sees a page only when you click its icon on that page.',
  'Select text before you click, and you can save that passage. It is sent only if you press Save selection.',
  'Add to notes opens Kio\'s capture page with the page and your selection, for you to check and save as a note. The extension itself sends nothing for it.',
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
  { id: 'today',     label: 'Today',            icon: Home,        group: 'Plan',         keywords: 'home plan day flow nova proposal apply discard approve undo new chat close subject focus board tasks kanban deadlines week ahead planner untimed custom keyboard shortcuts keys' },
  { id: 'build',     label: 'Build with Nova',  icon: Sparkles,    group: 'Plan',         keywords: 'workspace create project exam skill templates syllabus pdf photo milestones tasks versions approve recovery missed days' },
  { id: 'calendar',  label: 'Calendar',         icon: CalendarDays, group: 'Plan',        keywords: 'events classes meetings month week agenda reminders deadlines dates schedule repeat recurring weekly daily monthly' },
  { id: 'focus',     label: 'Focus room',       icon: Timer,       group: 'Plan',         keywords: 'session timer pomodoro pause end scenes sound music rain lofi spotify apple music youtube playlist fullscreen keyboard shortcuts keys' },
  { id: 'knowledge', label: 'Knowledge',        icon: BookOpen,    group: 'Knowledge',    keywords: 'subjects topics level review due board subject studio archive keyboard shortcuts keys' },
  { id: 'map',       label: 'Knowledge Map',    icon: Waypoints,   group: 'Knowledge',    keywords: 'graph links pan zoom filter layout drag explore inside nested subjects topics connect unlink add delete fold keyboard shortcuts keys' },
  { id: 'notes',     label: 'Notes',            icon: NotebookPen, group: 'Knowledge',    keywords: 'editor callout highlight tag link source pdf template ask nova summarise tutor explain quiz practice flashcards brainstorm capture import ipad goodnotes notability research paper arxiv doi pubmed keyboard shortcuts keys' },
  { id: 'saved',     label: 'Saved pages',      icon: Bookmark,    group: 'Knowledge',    keywords: 'links bookmark save to kio study this browser extension' },
  { id: 'progress',  label: 'Progress & DNA',   icon: TrendingUp,  group: 'Growth',       keywords: 'progress learning dna streak weeks signals insights' },
  { id: 'creature',  label: 'Your creature',    icon: Gamepad2,    group: 'Growth',       keywords: 'world level places arrow keys unlock days in a row keyboard shortcuts keys' },
  { id: 'telegram',  label: 'Nova on Telegram', icon: Send,        group: 'Nova',         keywords: 'commands chat hinglish hindi nudges check-in language' },
  { id: 'extension', label: 'Browser Extension',icon: Puzzle,      group: 'Nova',         keywords: 'chrome edge brave arc save page selection code connect install' },
  { id: 'counts',    label: 'What counts',      icon: Check,       group: 'Nova',         keywords: 'record ten minutes rules honest' },
  { id: 'plans',     label: 'Plans',            icon: CreditCard,  group: 'Account',      keywords: 'free pro price trial billing upgrade rupees' },
  { id: 'privacy',   label: 'Your data',        icon: ShieldCheck, group: 'Account',      keywords: 'privacy delete account export settings theme password reset email verified profile terms' },
  { id: 'faq',       label: 'Questions',        icon: CircleHelp,  group: 'Account',      keywords: 'faq help problems troubleshooting not applied stale disconnected planner missing' },
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

// Keyboard shortcuts, each list under the feature it belongs to. Every key
// here is one the page's own handler answers (focus-session.tsx,
// knowledge-map/map-shortcuts.ts, notes/notes-shortcuts.ts, the command
// palette, today/flow-list.tsx and copilot-panel.tsx, the creature page).
// `pc` is given only where Windows and Linux differ from the Mac.
type Shortcut = { mac: string[]; pc?: string[]; what: string }

const TODAY_KEYS: Shortcut[] = [
  { mac: ['Enter'], what: 'Send your message to Nova (Shift Enter for a new line)' },
  { mac: ['⌥', '↑ / ↓'], pc: ['Alt', '↑ / ↓'], what: 'Move the focused item in your flow up or down' },
  { mac: ['Esc'], what: 'Close Nova’s drawer on a phone or tablet' },
]
const FOCUS_KEYS: Shortcut[] = [
  { mac: ['Space'], what: 'Pause or resume the session' },
  { mac: ['F'], what: 'Fullscreen' },
  { mac: ['S'], what: 'Open or close the sound panel' },
  { mac: ['M'], what: 'Mute or unmute' },
  { mac: ['Esc'], what: 'Close the sound panel' },
]
const KNOWLEDGE_KEYS: Shortcut[] = [
  { mac: ['⌘', 'K'], pc: ['Ctrl', 'K'], what: 'Search any page, subject, topic, note, saved page or task' },
]
const MAP_KEYS: Shortcut[] = [
  { mac: ['/'], what: 'Find a card (⌘ K or Ctrl K works too)' },
  { mac: ['← → ↑ ↓'], what: 'Move between connected cards; with nothing selected, move the view' },
  { mac: ['⇧', '← → ↑ ↓'], pc: ['Shift', '← → ↑ ↓'], what: 'Move the view' },
  { mac: ['⌥', '← → ↑ ↓'], pc: ['Alt', '← → ↑ ↓'], what: 'Move the selected card (with Shift, further)' },
  { mac: ['Enter'], what: 'Explore inside the selected card' },
  { mac: ['⇧', 'Enter'], pc: ['Shift', 'Enter'], what: 'Show the selected card’s details' },
  { mac: ['U'], what: 'Up one level' },
  { mac: ['Space'], what: 'Fold or show what is inside the selected card' },
  { mac: ['+ / −'], what: 'Zoom in or out' },
  { mac: ['F'], what: 'Fit the map (or the explored card) on screen' },
  { mac: ['0'], what: 'Zoom to 100%, centred on the selected card' },
  { mac: ['N'], what: 'Add a card inside or beside the selected one' },
  { mac: ['Delete'], what: 'Delete the selected card (Backspace too); you always confirm first' },
  { mac: ['Esc'], what: 'Close a menu or panel, then clear the selection' },
  { mac: ['?'], what: 'Show these shortcuts on the map' },
]
const NOTES_KEYS: Shortcut[] = [
  { mac: ['⌘', 'P'], pc: ['Ctrl', 'P'], what: 'Import a research paper (on Notes pages only; Print elsewhere)' },
  { mac: ['⌘', 'K'], pc: ['Ctrl', 'K'], what: 'Commands and search: notes, subjects, Nova' },
  { mac: ['E'], what: 'Edit the note you are reading' },
  { mac: ['⌘', 'S'], pc: ['Ctrl', 'S'], what: 'Save now (notes also save as you pause)' },
  { mac: ['⌘', 'B'], pc: ['Ctrl', 'B'], what: 'Bold' },
  { mac: ['⌘', 'I'], pc: ['Ctrl', 'I'], what: 'Italic' },
  { mac: ['⌘', '⇧', 'E'], pc: ['Ctrl', 'Shift', 'E'], what: 'Highlight' },
  { mac: ['Enter'], what: 'Send to Nova (Shift Enter for a new line)' },
  { mac: ['Esc'], what: 'Close a dialog, the source or the PDF; stop Nova' },
  { mac: ['?'], what: 'Show the Notes shortcuts (when not typing)' },
]
const CREATURE_KEYS: Shortcut[] = [
  { mac: ['← → ↑ ↓'], what: 'Walk to the nearest open place that way' },
  { mac: ['⇧', '← / →'], pc: ['Shift', '← / →'], what: 'Turn the camera (Q and E too)' },
]

function KeyCombo({ keys }: { keys: string[] }) {
  return <span className="flex flex-wrap gap-1">{keys.map(k => <kbd key={k} className={KBD}>{k}</kbd>)}</span>
}

// A short "Keyboard shortcuts" list inside a feature's section. Where Windows
// and Linux use other keys, both are shown.
function Shortcuts({ items }: { items: Shortcut[] }) {
  const differs = items.some(i => i.pc)
  return (
    <div className={`${CARD} overflow-hidden`} data-guide-shortcuts>
      <p className={`${SUB} px-5 pt-4`}><Keyboard aria-hidden className="mr-2 inline size-4 align-[-2px] text-keppel-300" />Keyboard shortcuts</p>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="border-b border-white/8 text-[11px] uppercase tracking-[0.14em] text-foreground/45">
          <tr>{differs ? <><th className="px-5 py-2 font-medium">Mac</th><th className="px-5 py-2 font-medium">Windows and Linux</th></> : <th className="px-5 py-2 font-medium">Keys</th>}<th className="px-5 py-2 font-medium">What it does</th></tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {items.map(i => (
            <tr key={i.what}>
              {differs && !i.pc
                ? <td colSpan={2} className="whitespace-nowrap px-5 py-2.5"><KeyCombo keys={i.mac} /></td>
                : <>
                    <td className="whitespace-nowrap px-5 py-2.5"><KeyCombo keys={i.mac} /></td>
                    {differs && <td className="whitespace-nowrap px-5 py-2.5"><KeyCombo keys={i.pc!} /></td>}
                  </>}
              <td className="px-5 py-2.5 text-foreground/80">{i.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FAQ = [
  { q: 'I closed the tab mid-session. Is it lost?', a: 'No. Sessions are timed on Kio’s server, not in the page. Open Focus again, here or on another device, and the clock is where it should be. Telegram sees the same session.' },
  { q: 'Why did a session not change my Knowledge?', a: 'Sessions under ten minutes are kept but move nothing, and a session on a topic that isn’t filed under one of your subjects can’t be tied to Knowledge yet. Finish ten minutes or more, on a topic of a subject, and say how it went.' },
  { q: 'Nova proposed a day I don’t want.', a: 'Nothing is changed until you apply it. Press Discard and your plan stays as it was, or Change something and say what to change. To keep only part of a proposal, use Edit flow.' },
  { q: 'A proposal says “Not applied · your flow had changed”.', a: 'Your flow changed after Nova made the proposal (you edited it, or another tab did), so it was not applied. Your flow is as you left it; ask Nova again and it proposes from the flow as it is now.' },
  { q: 'Where did the Planner go?', a: 'Daily planning is on Today, and your task board opens there with Board. Old Planner links open Today, with the board open if the link was to the board. The week ahead and why the day is sized as it is are under More for today.' },
  { q: 'Will New chat or closing Nova change my plan?', a: 'No. Closing only hides Nova; the conversation is there when you open it again. New chat clears the conversation and nothing else. If a proposal is still waiting, it asks first, because starting over discards that proposal.' },
  { q: 'A paper’s PDF shows a message instead of the paper.', a: 'Some sources (PubMed Central, for one) don’t allow their PDF to be shown inside another site, and some ask for a sign-in or a check first. Kio says which, and Open the original opens it in a new tab. Your note stays open.' },
  { q: 'I didn’t get the password-reset email.', a: 'Check spam, and that Profile shows the address you expect. A link works once, for an hour, and asking again makes the earlier one stop working. After a few requests in an hour, wait before asking again.' },
  { q: 'I can’t find the extension in the Chrome Web Store.', a: 'It isn’t listed there yet. Until it is, the Save to Kio bookmark on the Browser Extension page saves any page from any browser, phones and Safari included.' },
  { q: 'The extension says it was disconnected.', a: 'Its connection ends if you disconnect it or leave it unused for thirty days. Open the Browser Extension page, press Connect a browser and type the new code into the extension.' },
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
            <p className={EYEBROW}>Kio Docs</p>
            <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.08]">
              Everything Kio does, and how to get the most from it.
            </h1>
            <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-foreground/60">
              Kio is one learning environment in three places: this web app, Nova in a Telegram chat, and a browser extension. They share one record, so what you do in one shows up in the others. These docs cover every page and every feature.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-center lg:grid-cols-1 lg:text-left">
            {[['Pages', String(NOVA_ROUTES.length)], ['Telegram commands', String(COMMANDS.length)], ['Rule that matters', 'Only real study counts']].map(([k, v]) => (
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
        <nav aria-label="Docs contents" className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <label className="relative block">
            <span className="sr-only">Search the docs</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/40" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the docs"
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
          {shown.size === 0 && <p className="rounded-2xl border border-dashed border-white/12 px-5 py-8 text-sm text-foreground/60">Nothing in the docs matches “{query}”. Try a page name, like Focus or Notes.</p>}

          <Section topic={topic('start')} hidden={hide('start')} lead="Five minutes to set up, and Nova has what it needs to plan your days.">
            <Steps steps={[
              { title: 'Make your account', body: 'Sign up with email (Kio sends an eight-digit code to confirm it) or continue with Google.' },
              { title: 'Answer nine short questions', body: 'What Nova should call you, what you do, what you’re working on, how much time you have each week, what usually gets in the way, the language and tone Nova should use, whether you use Telegram, and a name for your creature. They set Nova’s words, tone, language and your usual daily time; they create no tasks or reminders, and you can change every answer in Settings.' },
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

          <Section topic={topic('loop')} hidden={hide('loop')} lead="Kio is built around one loop. Every page is a way into it, or a view of what it has recorded.">
            <Steps steps={[
              { title: 'Plan the day', body: 'On Today, tell Nova what you want the day to be about and how long you have. It proposes a flow from your own subjects and tasks; you apply it, change it or plan it yourself.' },
              { title: 'Focus on it', body: 'Start a session. Kio times it on its server, so you can close the tab or switch to Telegram and it keeps running.' },
              { title: 'Say how it went', body: 'Struggled, Okay, Good or Crushed it. That answer, with the minutes, is what moves a topic forward and sets when to revisit it.' },
              { title: 'Watch it add up', body: 'Knowledge, Progress, Learning DNA and your creature all read the same record. Nothing is estimated from a quiz or a guess.' },
            ]} />
          </Section>

          <Section topic={topic('today')} hidden={hide('today')} lead="Where you plan the day with Nova and work through it. Nothing goes into your day until you choose it.">
            <Steps steps={[
              { title: 'Tell Nova', body: 'Say what you want today to be about, or tap a starter. Nova asks a question or two and suggests topics from your own Knowledge Map.' },
              { title: 'See the proposal', body: 'The flow appears in the middle, marked Not applied yet: what is new, moved or removed, and the minutes it adds up to.' },
              { title: 'Apply or change it', body: 'Apply plan saves it. Edit flow keeps only the changes you tick, Change something tells Nova what to change, and Discard leaves your plan as it was.' },
              { title: 'Work through it', body: 'Start an item to focus on it, tick it done, or reorder it. Undo takes back the last change.' },
            ]} />
            <Grid>
              <Feature title="Your saved flow">
                The day you applied stays as it is: reload, come back later or open another device, and it is the same. Nothing rebuilds it for you. A new day starts empty. Add myself puts a task, topic or anything else in the day without Nova; drag an item to reorder it, switch between List and Schedule, and use Time left today? to fit what is open into the time you have.
              </Feature>
              <Feature title="Nova on Today">
                Nova plans today and nothing else. Ask it to explain a topic or change a note and it points you to Focus or Notes. Tasks, deadlines and your map are changed on their own pages, never from this chat.
                <ul><li>Close hides Nova. Open it again and the conversation is where you left it.</li><li>New chat starts a fresh conversation and keeps your saved flow. If a proposal is still waiting, Nova asks before discarding it.</li><li>The conversation is kept in this browser tab for today only. There is no chat history to manage.</li></ul>
              </Feature>
              <Feature title="Subjects">
                The cards under the greeting are your top-level subjects; a subject inside one counts toward it. Picking one tells Nova what you have in mind. It adds nothing to the day by itself.
              </Feature>
              <Feature title="How long to focus">
                Start uses the suggested length: today’s time for the item, the task’s estimate, or a standard block. The arrow beside it offers shorter and longer lengths, your own number of minutes, or No time limit, a session that counts up until you end it.
              </Feature>
              <Feature title="The Board">
                Press Board in the header and your task board opens below the day: To do, In progress and Done. Drag a card to move it, open one to edit it or tick it. It is the same list of tasks as everywhere else in Kio. Opening the board adds nothing to today, and taking an item out of today leaves the task on the board.
              </Feature>
              <Feature title="More for today">
                Exams and dated tasks coming up, work that slipped after missed days (Nova offers to spread it over the coming days; nothing moves until you say so), the week ahead and why today is sized as it is.
              </Feature>
            </Grid>
            <Shortcuts items={TODAY_KEYS} />
            <div className="flex flex-wrap gap-2"><OpenLink href="/home">Open Today</OpenLink></div>
          </Section>

          <Section topic={topic('build')} hidden={hide('build')} lead="A conversation with Nova that sets up something bigger than a day: a project, an exam, a skill or a semester.">
            <Grid>
              <Feature title="Talk it through">
                Say what you&apos;re working on in your own words. Nova asks what it needs, one question at a time. Attach a PDF or a photo (a syllabus, your notes, a picture of a plan) and Nova reads it; files stay with that conversation until it&apos;s built or cancelled.
              </Feature>
              <Feature title="You decide what gets made">
                Nova drafts a workspace only when you ask it to, and adds tasks only when you ask for them. The proposal on the right holds milestones, topics, notes and dates; edit any of it there, or tell Nova what to change. Each change is a new version.
              </Feature>
              <Feature title="Approve, then it's real">
                Nothing is created until you approve a version. Then tasks go to your Board, subjects and topics to Knowledge and the Knowledge Map, notes to Notes and dates to the calendar. Come back to improve a workspace later; Nova removes something only when you ask it to.
              </Feature>
              <Feature title="Templates">
                Ready-made starting points for college, work or a competitive exam, linked from Build with Nova. &ldquo;Start from a document&rdquo; there reads a syllabus PDF or a photo and proposes a workspace from it. You see and trim everything before it is created.
              </Feature>
            </Grid>
            <p className={BODY}>Ask Nova on Telegram to set something up and it sends you a link to the same conversation. Nova doesn&apos;t search the web, so the resources it names are suggestions.</p>
            <div className="flex flex-wrap gap-2"><OpenLink href="/build">Open Build with Nova</OpenLink></div>
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
                A large clock that counts down the length you chose; tap it to show time studied instead. A session with no time limit counts up instead. Pause and resume as often as you need (breaks are counted), then End session and say how it went.
              </Feature>
              <Feature title="Scenes">
                Five backdrops drawn live in Kio&apos;s colours: Aurora, Rain, Night sky, Embers and Forest. They pause when the tab is hidden and stay still if your device asks for reduced motion.
              </Feature>
              <Feature title="Soundscapes">
                Rain, forest, ocean, fireplace, café, brown noise and white noise, made in your browser, so nothing downloads. Turn on several and set each one&apos;s volume; Kio remembers your mix on this device.
              </Feature>
              <Feature title="Playlists">
                Lo-fi in YouTube&apos;s, Spotify&apos;s or Apple Music&apos;s own player: Lofi Girl&apos;s lofi hip hop radio and synthwave radio (YouTube live), Lofi Girl&apos;s playlist on Spotify and on Apple Music, Deep Focus, lofi beats and Peaceful Piano. If YouTube&apos;s player stays empty, the network may be blocking YouTube (many college and office Wi-Fi networks do): the panel says so and offers Lofi Girl on Spotify or Apple Music. Or paste a link to your own Spotify, Apple Music or YouTube playlist, album or song: it is kept in that browser under Your music. Music keeps playing when you close the sound panel, alongside any soundscapes. Spotify and Apple Music play whole songs when you are signed in to them in that browser, otherwise short previews.
              </Feature>
              <Feature title="On this topic">
                A panel with where the topic stands on the record and the notes and pages you filed under it, without leaving the room.
              </Feature>
              <Feature title="The ten-minute rule">
                A session of ten minutes or more, with your answer to How did it go?, updates the topic and when to revisit it. Shorter ones are logged and move nothing.
              </Feature>
            </Grid>
            <Shortcuts items={FOCUS_KEYS} />
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
            <Shortcuts items={KNOWLEDGE_KEYS} />
          </Section>

          <Section topic={topic('map')} hidden={hide('map')} lead="Your subjects, topics, tasks, notes and saved pages as one map, with each card inside the one it belongs to.">
            <Grid>
              <Feature title="Find your way">
                Pan, zoom and filter by kind. Select a card to see its details and what it links to. Links come from what you wrote: a note that writes [[Deadlocks]] is joined to Deadlocks. Press <kbd className={KBD}>/</kbd> to find a card by name.
              </Feature>
              <Feature title="Explore inside">
                Subjects can sit inside subjects, and topics inside topics. Double-click a card or press Enter to explore what is inside it; U or the path at the top takes you back up. Space folds a card to tidy the view.
              </Feature>
              <Feature title="Add, connect and remove">
                N adds a card inside or beside the selected one. Connect existing joins a card you already have: filing it moves it (it has one place), a link leaves it where it is. Removing a connection deletes no card. Deleting a card always asks first.
              </Feature>
              <Feature title="Arrange it your way">
                Drag cards where you want them; Kio remembers each position for you, and anything you have not moved is placed for you. Press ? on the map for every shortcut.
              </Feature>
            </Grid>
            <Shortcuts items={MAP_KEYS} />
            <div className="flex flex-wrap gap-2"><OpenLink href="/map">Open Knowledge Map</OpenLink></div>
          </Section>

          <Section topic={topic('notes')} hidden={hide('notes')} lead="A notebook that reads like a good book: your own notes, filed under a subject and topic, linked to each other.">
            <Grid>
              <Feature title="The workspace">
                Your notebook by subject and topic on the left, the note in the middle, its outline, tags and backlinks on the right, and a status line with links and words. A note with a <code className="rounded bg-white/8 px-1">Source:</code> line can open that page or PDF beside it (Source, or Paper, in the note’s bar), so you read and write side by side.
              </Feature>
              <Feature title="Writing">
                A toolbar for headings, bold, italic, highlight, code, lists, note links, tags and dividers; Write, Split (live preview beside the text) and Preview. While you edit, the note saves itself a moment after you pause, and a save never overwrites a newer version: if the note changed elsewhere, you choose which to keep.
              </Feature>
              <Feature title="Callouts for what you read">
                Paste a passage, select it and press the quote button: it becomes a callout, and the cursor waits under it for your own words. Callouts can also be ideas, questions, warnings, summaries, examples and definitions, and can fold.
                <ul><li><code className="rounded bg-white/8 px-1">&gt; [!quote] Title</code> starts one</li><li><code className="rounded bg-white/8 px-1">==text==</code> highlights, <code className="rounded bg-white/8 px-1">#tag</code> tags, <code className="rounded bg-white/8 px-1">[[Title]]</code> links a note</li></ul>
              </Feature>
              <Feature title="Study it with Nova, beside the note">
                Nova sits beside the note (a panel you can resize, or a drawer on a phone or tablet). Select a passage and press Ask Nova, or just ask. It explains from what you wrote, gives examples, walks you through step by step, sets a practice question and checks your answer, quizzes you, brainstorms, makes flashcards, or suggests how to organise raw notes. What comes from your notes is labelled apart from Nova&apos;s own knowledge, and Nova says when your notes don&apos;t cover something.
                <ul><li>Nothing goes into your note until you press Add and confirm the preview; it is added on its own lines, marked as Nova&apos;s, and can be undone.</li><li>The conversation stays in this tab; Nova stores none of it.</li></ul>
              </Feature>
              <Feature title="Nova as your editor">
                Ask Nova to structure a note, clarify it, fill out an explanation, remove repetition, add a summary or examples. It shows each change it suggests, with what would go struck through, and you apply the ones you want. Nothing changes until you do.
              </Feature>
              <Feature title="Research papers">
                Press <kbd className={KBD}>⌘</kbd> <kbd className={KBD}>P</kbd> (Ctrl P) on Notes and paste a paper&apos;s link: arXiv, a DOI, Semantic Scholar, OpenReview, PubMed or PubMed Central, or a PDF link. Kio brings in its details, the abstract and any text the source shares openly, as one note with My notes at the end for your own. The note says how much of the paper it holds.
                <ul><li>Read the PDF here, on the paper’s card, opens the PDF beside your note in your browser’s own viewer: scroll, zoom and move between pages there. Drag the edge between them to resize, or use the widen button. On a phone it fills the screen.</li><li>Close it (Esc) and open it again with Paper: it is where you left it, while the note stays open.</li><li>Some sources don’t allow their PDF to be shown inside another site. Kio checks first and says so, with a button to open the original in a new tab.</li></ul>
              </Feature>
              <Feature title="Capture and import">
                Capture or import (on Notes) brings in what you wrote or read elsewhere: paste text, send a passage with the extension&apos;s Add to notes or the Send to Kio Notes bookmarklet (it works in Safari on iPad), or import a Markdown, text, PDF or photo file. Text files are kept exactly; a PDF or photo is transcribed by Nova for you to check, and the note says so. From Goodnotes, Notability or Apple Notes, export the page as a PDF and import it. It becomes a new note or is added to the end of one you have; a note with the same source or title is offered first, never merged by itself.
              </Feature>
              <Feature title="Templates">
                Concept, Source notes, Class notes, Chapter summary, Doubts and mistakes, Decision and Learning log, offered when you start a new note.
              </Feature>
              <Feature title="From a note to a session">
                Study this starts a session on the note&apos;s topic; Make a review task puts it on your board. The note itself never counts as study.
              </Feature>
            </Grid>
            <Shortcuts items={NOTES_KEYS} />
            <div className="flex flex-wrap gap-2"><OpenLink href="/notes">Open Notes</OpenLink></div>
          </Section>

          <Section topic={topic('saved')} hidden={hide('saved')} lead="Pages you want to come back to, kept with the subject and topic they belong to.">
            <Grid>
              <Feature title="Three ways to save">
                Paste a link on the Browser Extension page, add the Save to Kio bookmark to your browser and send any page with one click (works on phones and Safari too), or use the browser extension.
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
            <Shortcuts items={CREATURE_KEYS} />
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
                Write in Hinglish and Nova answers in Hinglish, commands included; write in Hindi (Devanagari) and its replies are in Hindi. Each reply follows the message it answers, so switching is just writing in the other language. When a message doesn’t say, and when Nova messages first, it uses the language you chose in Settings → How Nova helps you.
              </Feature>
              <Feature title="Nudges, not alarms">
                Nova checks in around the time you picked, on days you haven&apos;t studied yet, and otherwise messages first only when something is due: at most twice a day. Change the time in Settings; <span className="font-mono text-keppel-300">/settings</span> on Telegram turns it all off. It cannot set a one-off reminder yet, and says so if you ask.
              </Feature>
            </Grid>
          </Section>

          <Section topic={topic('extension')} hidden={hide('extension')} lead="On any page, click the Kio icon to save it under a subject or start a study session on it. Works in Chrome, Edge, Brave and Arc. It isn’t listed in the Chrome Web Store yet, and Safari is not supported yet; the Save to Kio bookmark works everywhere meanwhile.">
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

          <Section topic={topic('counts')} hidden={hide('counts')} lead="Kio would rather show you nothing than something made up. This is the whole rule.">
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

          <Section topic={topic('plans')} hidden={hide('plans')} lead="Kio is free to use. Pro is for when you lean on Nova every day.">
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

          <Section topic={topic('privacy')} hidden={hide('privacy')} lead="What Kio keeps, and how you stay in charge of it.">
            <Grid>
              <Feature title="Yours, and only yours">
                Your notes, subjects, sessions and saved pages belong to your account and no one else sees them. Nova reads them to plan and to answer you; it never posts or shares anything.
              </Feature>
              <Feature title="Settings">
                Light, dark or match your device; your check-in time and timezone; your Telegram connection. Connected browsers are on the Browser Extension page. Your Profile shows the email address your account uses and whether it is verified, and Email me a reset link sends a password-reset link to it (an account that signs in only with Google has no Kio password). Deleting your account removes it and everything in it.
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

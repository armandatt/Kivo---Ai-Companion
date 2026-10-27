// The landing page's product story, in the order a visitor meets it: Nova
// helps build the workspace, the AI-powered Second Brain (the Knowledge Map,
// by its marketing name) shows it connected, notes and papers become
// something to learn from, Today turns it into a day, then the rest. The
// words render on the server; each preview is a client island that loads as
// the visitor nears it (demos.tsx). Every claim is about something the app
// does today; where something is not finished (the extension's store
// listing), it says so.

import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, Bookmark, Brain, CalendarDays, Compass, Dna, FileText, GraduationCap, KanbanSquare, KeyRound, LayoutTemplate, Map as MapIcon, Search, Send, Sparkles, Sprout, Target, Timer, TrendingUp, Briefcase } from 'lucide-react'
import { AuthAwareLink } from '@/components/auth-aware-link'
import { Reveal } from './frame'
import { LazyBuildDemo, LazyMapDemo, LazyNotesDemo, LazyPaperDemo, LazyTodayDemo } from './demos'

const SECTION = 'relative scroll-mt-20 border-t border-[var(--color-baltic-sea-900)] px-4 py-24 sm:py-32'
const BG = { background: '#060810' }

function Intro({ eyebrow, title, children, id }: { eyebrow: string; title: string; children: ReactNode; id: string }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#00E5A0]">{eyebrow}</p>
      <h2 id={`${id}-title`} className="mt-3 text-balance text-4xl font-bold tracking-tight text-[#e8eaf0] md:text-5xl md:leading-[1.08]">{title}</h2>
      <p className="mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-slate-400">{children}</p>
    </Reveal>
  )
}

function Points({ items }: { items: Array<{ title: string; body: string }> }) {
  return (
    <Reveal>
      <ul className="grid gap-x-10 gap-y-6 border-t border-white/6 pt-10 sm:grid-cols-3">
        {items.map(p => (
          <li key={p.title}>
            <p className="text-sm font-semibold text-slate-100">{p.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{p.body}</p>
          </li>
        ))}
      </ul>
    </Reveal>
  )
}

function SectionCta({ children }: { children: ReactNode }) {
  return (
    <div className="text-center">
      <AuthAwareLink className="inline-flex items-center gap-1.5 rounded-full border border-[#00E5A0]/35 px-5 py-2.5 text-sm font-semibold text-[#00E5A0] transition-colors hover:bg-[#00E5A0]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
        {children} <ArrowRight aria-hidden className="size-4" />
      </AuthAwareLink>
    </div>
  )
}

export function BuildSection() {
  return (
    <section id="build" aria-labelledby="build-title" className={SECTION} style={BG}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(0,229,160,0.08),transparent)]" />
      <div className="relative mx-auto max-w-6xl space-y-14">
        <Intro id="build" eyebrow="Build with Nova" title="Your goals. Your structure. Nova’s help.">
          Think it through together, then turn it into a workspace. Nothing is created until you approve it.
        </Intro>
        <Reveal><LazyBuildDemo /></Reveal>
        <Points items={[
          { title: 'Questions first', body: 'Nova asks what it needs before it drafts anything.' },
          { title: 'Every change is a version', body: 'Edit the draft yourself or tell Nova what to change.' },
          { title: 'Yours once approved', body: 'Approve, and your subjects, topics and dates appear.' },
        ]} />
      </div>
    </section>
  )
}

export function MapSection() {
  return (
    <section id="map" aria-labelledby="map-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="map" eyebrow="AI-powered Second Brain" title="An AI-powered second brain.">
          See how your ideas connect. Explore the knowledge you’ve built.
        </Intro>
        <Reveal><LazyMapDemo /></Reveal>
        <Points items={[
          { title: 'As deep as you think', body: 'Subjects inside subjects, topics inside topics. Open any card to explore inside it.' },
          { title: 'Connections you can see', body: 'Select a card and everything joined to it lights up.' },
          { title: 'Grows as you learn', body: 'Every subject, note, paper and task you add takes its place.' },
        ]} />
        <SectionCta>Start your second brain</SectionCta>
      </div>
    </section>
  )
}

export function NotesSection() {
  return (
    <section id="notes" aria-labelledby="notes-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="notes" eyebrow="Notes and research" title="Read less passively. Understand more.">
          Bring your notes and research into one place, then learn directly from them.
        </Intro>
        <Reveal><LazyNotesDemo /></Reveal>
        <div className="grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Reveal className="space-y-4">
            <h3 className="text-2xl font-bold tracking-tight text-[#e8eaf0] md:text-3xl">Bring a paper in with its link.</h3>
            <p className="text-base leading-relaxed text-slate-400">One note, filed where it belongs, with your own notes kept apart from the paper.</p>
            <ul className="flex flex-wrap gap-2 text-xs text-slate-300" aria-label="Sources Kio can import from">
              {['arXiv', 'DOI', 'Semantic Scholar', 'OpenReview', 'PubMed', 'PubMed Central', 'A PDF link'].map(s => <li key={s} className="rounded-full border border-white/10 px-2.5 py-1">{s}</li>)}
            </ul>
            <p className="text-sm leading-relaxed text-slate-500">Full text where the source shares it openly (arXiv’s HTML versions, Europe PMC’s open-access set); otherwise the details and abstract.</p>
          </Reveal>
          <Reveal delay={0.1}><LazyPaperDemo /></Reveal>
        </div>
      </div>
    </section>
  )
}

export function TodaySection() {
  return (
    <section id="today" aria-labelledby="today-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="today" eyebrow="Today" title="Make today yours.">
          Choose what matters, shape your flow, and get to work.
        </Intro>
        <Reveal><LazyTodayDemo /></Reveal>
        <Points items={[
          { title: 'Your call', body: 'Nova proposes a flow. Nothing changes until you apply it.' },
          { title: 'List or schedule', body: 'See the day as a list, or laid out in time.' },
          { title: 'Focus your way', body: 'The suggested length, your own, or no time limit.' },
        ]} />
      </div>
    </section>
  )
}

const GROUPS: Array<{ title: string; items: Array<{ icon: typeof Compass; title: string; body: string }> }> = [
  {
    title: 'Getting work done',
    items: [
      { icon: KanbanSquare, title: 'A board inside Today', body: 'To do, In progress, Done. A task joins today only when you add it.' },
      { icon: CalendarDays, title: 'Calendar', body: 'Classes, deadlines and study blocks, with repeats and Telegram reminders.' },
      { icon: Timer, title: 'A focus room', body: 'Scenes, soundscapes and playlists, with the topic’s notes a click away.' },
    ],
  },
  {
    title: 'Wherever you learn',
    items: [
      { icon: Send, title: 'Nova on Telegram', body: 'Start sessions, see your day, or just talk. English, Hinglish or Hindi.' },
      { icon: Bookmark, title: 'Save what you read', body: 'A bookmark sends any page to Kio, phones included. A browser extension is built, not yet in the Chrome Web Store.' },
      { icon: Search, title: 'Find anything', body: '⌘K (Ctrl K) on Knowledge finds any subject, topic, note, page or task.' },
    ],
  },
  {
    title: 'Progress you can trust',
    items: [
      { icon: TrendingUp, title: 'Progress', body: 'Built only from focus sessions of ten minutes or more.' },
      { icon: Brain, title: 'Reviews on time', body: 'How a session went sets when its topic comes back.' },
      { icon: Dna, title: 'Learning DNA', body: 'What works for you, shown once there’s enough to go on.' },
      { icon: Sprout, title: 'Your creature', body: 'A small world that grows with the days you study.' },
    ],
  },
  {
    title: 'Set up in minutes',
    items: [
      { icon: Sparkles, title: 'Nine short questions', body: 'Your work, your time, and Nova’s tone and language.' },
      { icon: LayoutTemplate, title: 'Templates', body: 'A semester, an exam, a skill, interview prep or a certification.' },
      { icon: KeyRound, title: 'Your account', body: 'Light or dark, password reset, Docs, and full deletion.' },
    ],
  },
]

export function Capabilities() {
  return (
    <section id="features" aria-labelledby="features-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="features" eyebrow="Everything else" title="The rest of your workspace.">
          Small tools that keep the plan moving.
        </Intro>
        <div className="space-y-10">
          {GROUPS.map(g => (
            <Reveal key={g.title}>
              <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
                <h3 className="pt-1 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">{g.title}</h3>
                <ul className={`grid gap-4 sm:grid-cols-2 ${g.items.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
                  {g.items.map(it => (
                    <li key={it.title} className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 transition-colors hover:border-[#00E5A0]/30 hover:bg-[#00E5A0]/[0.03]">
                      <it.icon aria-hidden className="size-5 text-[#00E5A0]" />
                      <p className="mt-3 text-sm font-semibold text-slate-100">{it.title}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{it.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const JOURNEY = [
  { icon: Compass, title: 'Set it up with Nova', body: 'Share a goal; approve the structure.', href: '#build' },
  { icon: MapIcon, title: 'Connect it', body: 'Subjects and topics on your second brain.', href: '#map' },
  { icon: FileText, title: 'Understand it', body: 'Notes and papers, with the Tutor.', href: '#notes' },
  { icon: Target, title: 'Shape your day', body: 'Choose what matters today.', href: '#today' },
  { icon: BookOpen, title: 'Make progress', body: 'Every finished session counts.', href: '#features' },
]

export function Journey() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="how" eyebrow="How it fits together" title="One loop, from a goal to what you know.">
          Each step opens its preview above.
        </Intro>
        <Reveal>
          <ol className="relative grid gap-4 md:grid-cols-5">
            <span aria-hidden className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-[#00E5A0]/30 to-transparent md:block" />
            {JOURNEY.map((j, i) => (
              <li key={j.title} className="relative">
                <a href={j.href} className="group block h-full rounded-2xl border border-white/8 bg-[#090c14] p-5 transition-colors hover:border-[#00E5A0]/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full border border-[#00E5A0]/30 bg-[#00E5A0]/10 font-mono text-sm text-[#00E5A0]">{i + 1}</span>
                    <j.icon aria-hidden className="size-4 text-slate-500 transition-colors group-hover:text-[#00E5A0]" />
                  </span>
                  <span className="mt-4 block text-sm font-semibold text-slate-100">{j.title}</span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-slate-400">{j.body}</span>
                </a>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  )
}

export function UseCases() {
  const cases = [
    { icon: GraduationCap, who: 'Students', lines: ['A semester’s subjects and exam dates, mapped.', 'Course papers studied beside your notes.', 'Each day planned from what’s due.'] },
    { icon: Briefcase, who: 'Working professionals', lines: ['A roadmap for a skill, a certification or interviews.', 'A project’s reading, notes and tasks on one map.', 'Learning that fits a working day.'] },
  ]
  return (
    <section id="use-cases" aria-labelledby="cases-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="cases" eyebrow="Who it’s for" title="For anyone learning something that matters.">
          A semester or a skill for work: Kio grows from your own goals.
        </Intro>
        <Reveal>
          <div className="grid gap-5 md:grid-cols-2">
            {cases.map(c => (
              <div key={c.who} className="h-full rounded-3xl border border-white/8 bg-gradient-to-b from-white/[0.03] to-transparent p-7">
                <c.icon aria-hidden className="size-6 text-[#00E5A0]" />
                <h3 className="mt-4 text-xl font-semibold text-slate-100">{c.who}</h3>
                <ul className="mt-4 space-y-2.5">
                  {c.lines.map(l => <li key={l} className="flex gap-2.5 text-sm leading-relaxed text-slate-400"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[#00E5A0]" />{l}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

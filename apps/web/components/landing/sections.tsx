// The landing page's product story, section by section: create your system,
// connect your knowledge, understand your sources, shape your day, make
// progress. The words render on the server; each preview is a client island
// that loads as the visitor nears it (demos.tsx). Every claim here is about
// something the app does today; where something is not finished (the
// extension's store listing), it says so.

import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, Bookmark, Brain, CalendarDays, Compass, Dna, FileText, GraduationCap, KanbanSquare, KeyRound, LayoutTemplate, Map as MapIcon, Search, Send, Sparkles, Sprout, Target, Timer, TrendingUp, Briefcase } from 'lucide-react'
import { AuthAwareLink } from '@/components/auth-aware-link'
import { Reveal } from './frame'
import { LazyBuildDemo, LazyMapDemo, LazyNotesDemo, LazyPaperDemo, LazyTodayDemo } from './demos'

const SECTION = 'relative scroll-mt-20 border-t border-[var(--color-baltic-sea-900)] px-4 py-24 sm:py-28'
const BG = { background: '#060810' }

function Intro({ eyebrow, title, children, id }: { eyebrow: string; title: string; children: ReactNode; id: string }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#00E5A0]">{eyebrow}</p>
      <h2 id={`${id}-title`} className="mt-3 text-balance text-3xl font-bold tracking-tight text-[#e8eaf0] md:text-[2.75rem] md:leading-[1.1]">{title}</h2>
      <div className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-slate-400">{children}</div>
    </Reveal>
  )
}

function Points({ items }: { items: Array<{ title: string; body: string }> }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      {items.map((p, i) => (
        <li key={p.title}>
          <Reveal delay={i * 0.06} className="h-full rounded-2xl border border-white/8 bg-white/[0.02] p-5">
            <p className="text-sm font-semibold text-slate-100">{p.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{p.body}</p>
          </Reveal>
        </li>
      ))}
    </ul>
  )
}

function SectionCta({ children }: { children: ReactNode }) {
  return (
    <div className="mt-10 text-center">
      <AuthAwareLink className="inline-flex items-center gap-1.5 rounded-full border border-[#00E5A0]/35 px-5 py-2.5 text-sm font-semibold text-[#00E5A0] transition-colors hover:bg-[#00E5A0]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
        {children} <ArrowRight aria-hidden className="size-4" />
      </AuthAwareLink>
    </div>
  )
}

export function MapSection() {
  return (
    <section id="map" aria-labelledby="map-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="map" eyebrow="Knowledge Map" title="Don’t just collect information. Connect it.">
          Your subjects, topics, notes, saved pages and tasks on one map, each inside the one it belongs to. Subjects can sit inside subjects and topics inside topics, so a semester or a whole field stays readable. Try it: select a card, explore inside one, find a topic.
        </Intro>
        <Reveal><LazyMapDemo /></Reveal>
        <Points items={[
          { title: 'Explore inside', body: 'Open any card with something in it and the map becomes that subject or topic. Come back up a level whenever you like.' },
          { title: 'See what connects', body: 'Select a card and what it’s joined to lights up: its topics, the notes filed under it, a [[link]] you wrote in a note.' },
          { title: 'Shape it yourself', body: 'Add a card inside or beside another, connect ones you already have, or remove a link. Deleting a card always asks first.' },
        ]} />
        <SectionCta>Build your knowledge system</SectionCta>
      </div>
    </section>
  )
}

export function BuildSection() {
  return (
    <section id="build" aria-labelledby="build-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="build" eyebrow="Build with Nova" title="Build your learning system with Nova.">
          Say what you’re working toward: an exam, a semester, a skill, a project at work. Nova asks what it needs, drafts when you ask, and changes the draft as you talk. Nothing reaches your account until you approve a version.
        </Intro>
        <Reveal><LazyBuildDemo /></Reveal>
        <Points items={[
          { title: 'Questions before plans', body: 'Nova asks one thing at a time, and drafts only when you ask it to. Tasks are added only if you ask for tasks.' },
          { title: 'A draft you can see', body: 'The proposal sits beside the conversation. Edit it directly or tell Nova what to change; each change is a new version.' },
          { title: 'Yours once approved', body: 'Approve and build creates the subjects, topics, notes and dates. Come back later to refine it as your goals change.' },
        ]} />
      </div>
    </section>
  )
}

export function NotesSection() {
  return (
    <section id="notes" aria-labelledby="notes-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="notes" eyebrow="Notes, Tutor and Editor" title="Your notes become a place to understand.">
          Write, capture and import into notes filed under your subjects and topics. Beside every note, Nova teaches from what you wrote as a Tutor, or improves the note itself as an Editor. Either way, it shows you before anything changes.
        </Intro>
        <Reveal><LazyNotesDemo /></Reveal>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <Reveal className="space-y-4 lg:pt-6">
            <h3 className="text-2xl font-bold tracking-tight text-[#e8eaf0]">Bring your research in.</h3>
            <p className="text-base leading-relaxed text-slate-400">Paste a paper’s link and choose where it goes. Kivo brings in its details, the abstract and whatever text the source shares openly, as one note, with your own notes kept apart from the paper.</p>
            <ul className="flex flex-wrap gap-2 text-xs text-slate-300" aria-label="Sources Kivo can import from">
              {['arXiv', 'DOI', 'Semantic Scholar', 'OpenReview', 'PubMed', 'PubMed Central', 'A PDF link'].map(s => <li key={s} className="rounded-full border border-white/10 px-2.5 py-1">{s}</li>)}
            </ul>
            <p className="text-sm leading-relaxed text-slate-500">Full text comes only from what’s open: arXiv’s HTML versions and Europe PMC’s open-access set. Otherwise you get the details and abstract, and Nova can transcribe a PDF you point to or upload. Read the PDF beside your note where the source allows it.</p>
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
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="today" eyebrow="Today" title="Make today count, on your terms.">
          Today starts empty. Tell Nova what the day is about and how long you have; it proposes a flow from your own subjects and tasks. You reorder it, change the times, apply it, and start a focus session.
        </Intro>
        <Reveal><LazyTodayDemo /></Reveal>
        <Points items={[
          { title: 'Your day, your call', body: 'Nova’s flow is a proposal until you apply it. Add things yourself, drag them into order, or ask Nova for one specific change.' },
          { title: 'List or schedule', body: 'See the day as a list or laid out in time, and fit what’s left into the time you still have.' },
          { title: 'Focus your way', body: 'Start at the suggested length, choose your own, or study with no time limit. Sessions are timed on Kivo’s server, so closing the tab loses nothing.' },
        ]} />
      </div>
    </section>
  )
}

const GROUPS: Array<{ title: string; lead: string; items: Array<{ icon: typeof Compass; title: string; body: string }> }> = [
  {
    title: 'Getting work done', lead: 'Where today’s plan turns into finished work.',
    items: [
      { icon: KanbanSquare, title: 'A board inside Today', body: 'Your tasks in To do, In progress and Done, opened under your day. A task joins today only when you add it.' },
      { icon: CalendarDays, title: 'Calendar', body: 'Classes, deadlines and study blocks by month, week or agenda. Events can repeat, and reminders arrive on Telegram.' },
      { icon: Timer, title: 'A focus room', body: 'Scenes, soundscapes and playlists for a session, with the topic’s notes a click away.' },
    ],
  },
  {
    title: 'Wherever you learn', lead: 'The same workspace, reached from where you already are.',
    items: [
      { icon: Send, title: 'Nova on Telegram', body: 'Start and end sessions, see today and the week, or just say what’s going on. Nova writes back in English, Hinglish or Hindi.' },
      { icon: Bookmark, title: 'Save what you read', body: 'The Save to Kivo bookmark sends any page to Kivo from any browser, phones included. A browser extension for Chrome, Edge, Brave and Arc is built but not yet in the Chrome Web Store.' },
      { icon: Search, title: 'Find anything', body: 'On Knowledge, ⌘K (Ctrl K) finds any subject, topic, note, saved page or task. Notes and the map have their own search too.' },
    ],
  },
  {
    title: 'Progress you can trust', lead: 'Measured from real study, not guesses.',
    items: [
      { icon: TrendingUp, title: 'Progress', body: 'Built only from focus sessions of ten minutes or more, with how you said each one went.' },
      { icon: Brain, title: 'Reviews when they’re due', body: 'How a session went sets when a topic comes back. Topics due for review wait for you in Knowledge.' },
      { icon: Dna, title: 'Learning DNA', body: 'What tends to work for you, like session length and time of day, shown only once there’s enough to go on.' },
      { icon: Sprout, title: 'Your creature', body: 'A small world that grows with the days you study. It never shrinks for a day off.' },
    ],
  },
  {
    title: 'Set up in minutes', lead: 'A start that fits you, and settings you control.',
    items: [
      { icon: Sparkles, title: 'Nine short questions', body: 'What you do, what you’re working on, your time and Nova’s tone and language. Change any answer later.' },
      { icon: LayoutTemplate, title: 'Templates', body: 'Start from a semester, exam preparation, a skill, interview prep or a certification, and trim it before anything is created.' },
      { icon: KeyRound, title: 'Your account', body: 'Your profile, light or dark theme, password reset, Docs for every page, and deleting everything with your account.' },
    ],
  },
]

export function Capabilities() {
  return (
    <section id="features" aria-labelledby="features-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="features" eyebrow="Everything else" title="One workspace, from the plan to the proof.">
          The rest of Kivo, grouped by what it’s for.
        </Intro>
        <div className="space-y-12">
          {GROUPS.map((g, gi) => (
            <Reveal key={g.title} delay={gi * 0.04}>
              <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{g.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{g.lead}</p>
                </div>
                <ul className={`grid gap-4 sm:grid-cols-2 ${g.items.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
                  {g.items.map(it => (
                    <li key={it.title} className="group rounded-2xl border border-white/8 bg-white/[0.02] p-5 transition-colors hover:border-[#00E5A0]/30 hover:bg-[#00E5A0]/[0.03]">
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
  { icon: Compass, title: 'Set up your learning workspace', body: 'Share your goal and context with Nova, and approve the structure it proposes.', href: '#build' },
  { icon: MapIcon, title: 'Connect your knowledge', body: 'Organise subjects and nested topics on your Knowledge Map.', href: '#map' },
  { icon: FileText, title: 'Capture and understand', body: 'Bring in notes and papers, and learn from them with the Tutor.', href: '#notes' },
  { icon: Target, title: 'Shape your day', body: 'Decide what matters today and refine the flow with Nova.', href: '#today' },
  { icon: BookOpen, title: 'Study and build progress', body: 'Work through focus sessions; every finished one adds to your record.', href: '#features' },
]

export function Journey() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="how" eyebrow="How it works" title="One loop, from a goal to what you know.">
          Create your system, connect your knowledge, understand your sources, shape your day, and make progress. Each step opens its preview above.
        </Intro>
        <ol className="relative grid gap-4 md:grid-cols-5">
          <span aria-hidden className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-[#00E5A0]/30 to-transparent md:block" />
          {JOURNEY.map((j, i) => (
            <li key={j.title} className="relative">
              <Reveal delay={i * 0.08} className="h-full">
                <a href={j.href} className="group block h-full rounded-2xl border border-white/8 bg-[#090c14] p-5 transition-colors hover:border-[#00E5A0]/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full border border-[#00E5A0]/30 bg-[#00E5A0]/10 font-mono text-sm text-[#00E5A0]">{i + 1}</span>
                    <j.icon aria-hidden className="size-4 text-slate-500 transition-colors group-hover:text-[#00E5A0]" />
                  </span>
                  <span className="mt-4 block text-sm font-semibold text-slate-100">{j.title}</span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-slate-400">{j.body}</span>
                </a>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function UseCases() {
  const cases = [
    { icon: GraduationCap, who: 'Students', lines: ['Map a semester’s subjects and topics, with exam dates Nova plans around.', 'Import the papers for a course and study them beside your notes.', 'Plan each day from what’s due, then focus and review on time.'] },
    { icon: Briefcase, who: 'Working professionals', lines: ['Build a roadmap for a new skill, a certification or interview prep, in the hours you really have.', 'Keep reading, notes and tasks for a project on one map.', 'Fit learning into a working day, an hour at a time.'] },
  ]
  return (
    <section id="use-cases" aria-labelledby="cases-title" className={SECTION} style={BG}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="cases" eyebrow="Who it’s for" title="For anyone learning something that matters.">
          Kivo grows from your own goals, so it fits a semester as well as a skill you’re building for work.
        </Intro>
        <div className="grid gap-5 md:grid-cols-2">
          {cases.map((c, i) => (
            <Reveal key={c.who} delay={i * 0.08}>
              <div className="h-full rounded-3xl border border-white/8 bg-gradient-to-b from-white/[0.03] to-transparent p-7">
                <c.icon aria-hidden className="size-6 text-[#00E5A0]" />
                <h3 className="mt-4 text-xl font-semibold text-slate-100">{c.who}</h3>
                <ul className="mt-4 space-y-2.5">
                  {c.lines.map(l => <li key={l} className="flex gap-2.5 text-sm leading-relaxed text-slate-400"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[#00E5A0]" />{l}</li>)}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

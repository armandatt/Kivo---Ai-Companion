// The landing page's product story, in the order a visitor meets it: Nova
// helps build the workspace, the AI-powered Second Brain (the Knowledge Map,
// by its marketing name) shows it connected, notes and papers become
// something to learn from, anything read on the web is a click away (Nova
// for Chrome), Today turns it into a day; then the loop that
// keeps it going: Nova writes first on Telegram, the focus room holds the
// session, and the creature's world grows with the days; then the rest. The
// words render on the server; each preview is a client island that loads as
// the visitor nears it (demos.tsx). Every claim is about something the app
// does today; where something is not finished (the extension's store
// listing), it says so.

import type { ReactNode } from 'react'
import { ArrowRight, Bookmark, Brain, CalendarDays, Compass, Dna, FileText, GraduationCap, KanbanSquare, KeyRound, LayoutTemplate, Map as MapIcon, Puzzle, Search, Send, Sparkles, Sprout, Target, Timer, TrendingUp, Briefcase } from 'lucide-react'
import { AuthAwareLink } from '@/components/auth-aware-link'
import { Reveal } from './frame'
import { LazyBuildDemo, LazyCreatureDemo, LazyExtensionDemo, LazyFocusDemo, LazyMapDemo, LazyNotesDemo, LazyPaperDemo, LazyTelegramDemo, LazyWorkspaceDemo } from './demos'

// One continuous page: sections share the page's background (page.tsx draws
// the light that runs down it), with no rule between them; each opens with a
// short line leading into its words.
const SECTION = 'relative scroll-mt-20 px-4 py-20 sm:py-24'

function Intro({ eyebrow, title, children, id }: { eyebrow: string; title: string; children: ReactNode; id: string }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <span aria-hidden className="mx-auto mb-5 block h-10 w-px bg-gradient-to-b from-transparent to-[#00E5A0]/50" />
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
    <section id="build" aria-labelledby="build-title" className={SECTION}>
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
    <section id="map" aria-labelledby="map-title" className={SECTION}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="map" eyebrow="AI-powered Second Brain" title="Your AI-powered second brain.">
          Subjects inside subjects, topics inside topics, and the notes and papers that connect them. Open any card to go deeper.
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
    <section id="notes" aria-labelledby="notes-title" className={SECTION}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="notes" eyebrow="Notes and research" title="Learn from what you’ve already written.">
          Your notes and papers sit beside the Tutor. Choose a passage; it explains from your own words and keeps its additions apart from yours.
        </Intro>
        <Reveal><LazyNotesDemo /></Reveal>
        <div className="grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Reveal className="space-y-4">
            <h3 className="text-2xl font-bold tracking-tight text-[#e8eaf0] md:text-3xl">Bring a paper in with its link.</h3>
            <p className="text-base leading-relaxed text-slate-400">One note, filed where it belongs, with your own notes kept apart from the paper.</p>
            <ul className="flex flex-wrap gap-2 text-xs text-slate-300" aria-label="Sources Kivo can import from">
              {['arXiv', 'DOI', 'Semantic Scholar', 'OpenReview', 'PubMed', 'PubMed Central', 'A PDF link'].map(s => <li key={s} className="rounded-full border border-white/10 px-2.5 py-1">{s}</li>)}
            </ul>
            <p className="text-sm leading-relaxed text-slate-500">Full text where the source shares it openly (arXiv’s HTML versions, Europe PMC’s open-access set); otherwise the details and abstract.</p>
          </Reveal>
          <Reveal><LazyPaperDemo /></Reveal>
        </div>
      </div>
    </section>
  )
}

export function WorkspaceSection() {
  return (
    <section id="workspace" aria-labelledby="workspace-title" className={SECTION}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(0,229,160,0.07),transparent)]" />
      <div className="relative mx-auto max-w-6xl space-y-12">
        <Intro id="workspace" eyebrow="One connected workspace" title="Map it. Understand it. Plan it.">
          One topic, three views: where it sits in your second brain, your note with the Tutor beside it, and the day Nova helps you plan from both.
        </Intro>
        <Reveal><LazyWorkspaceDemo /></Reveal>
      </div>
    </section>
  )
}

// Nova for Chrome's listing. Until it is set, the button leads to sign-up.
const CHROME_STORE_URL: string | null = null

export function ExtensionSection() {
  return (
    <section id="extension" aria-labelledby="extension-title" className={SECTION}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(0,229,160,0.07),transparent)]" />
      <div className="relative mx-auto max-w-6xl space-y-14">
        <Intro id="extension" eyebrow="Nova for Chrome" title="A doubt mid-article? Ask it right there.">
          No copying into a chatbot tab and losing the answer in its history. Select the line, ask Nova, keep the passage under its topic, and write down what clicked in your own notes.
        </Intro>
        <Reveal><LazyExtensionDemo /></Reveal>
        <Points items={[
          { title: 'Ask where you read', body: 'Nova answers from the passage you selected, in a popup on the page. No new tab, no explaining the context again.' },
          { title: 'Kept where you’ll look', body: 'The passage and its page go under your subject and topic, and come up in the focus room when you study it.' },
          { title: 'Only when you click', body: 'It sees the address, the title and your selection, and only when you press a button. Nothing runs in the background.' },
        ]} />
        <div className="flex flex-col items-center gap-3">
          {CHROME_STORE_URL ? (
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#00E5A0] px-5 py-2.5 text-sm font-semibold text-[#04130e] transition-colors hover:bg-[#33ebb3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]">
              Add Nova to Chrome <ArrowRight aria-hidden className="size-4" />
            </a>
          ) : <SectionCta>Get Nova for Chrome</SectionCta>}
          <p className="text-sm text-slate-500">Free on the Chrome Web Store. Connect it with a code from your Kivo account. On a phone, a bookmark saves any page too.</p>
        </div>
      </div>
    </section>
  )
}

// The loop that keeps the plan going, told as one evening: Nova writes, you
// focus, your world grows. A thin line joins the three (StoryThread).
function StoryThread({ from, to }: { from: string; to: string }) {
  return (
    <Reveal className="mx-auto flex max-w-xs items-center justify-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500" >
      <span>{from}</span>
      <span aria-hidden className="relative h-px w-16 overflow-hidden bg-white/10"><span className="story-thread absolute inset-y-0 w-6 bg-gradient-to-r from-transparent via-[#00E5A0] to-transparent" /></span>
      <span className="text-[#7ef5cf]">{to}</span>
    </Reveal>
  )
}

export function MentorSection() {
  return (
    <section id="mentor" aria-labelledby="mentor-title" className={SECTION}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(45%_55%_at_50%_0%,rgba(42,171,238,0.07),transparent)]" />
      <div className="relative mx-auto max-w-6xl space-y-14">
        <Intro id="mentor" eyebrow="Proactive mentoring · on Telegram" title="A mentor that reaches out first.">
          Nova writes when it matters: today’s first block, a review that’s due, an exam close. Tap to start, or reply in your own words, in English or Hinglish.
        </Intro>
        <Reveal><LazyTelegramDemo /></Reveal>
        <Points items={[
          { title: 'One tap, real sessions', body: 'Start, pause and end from the chat. It’s the same session the web app shows.' },
          { title: 'Your tone, your language', body: 'Gentle to no-mercy coach. English, Hinglish or Hindi, following how you write.' },
          { title: 'Quiet when it should be', body: 'Not at night, not mid-session, at most twice a day. “Not today” pauses it to midnight.' },
        ]} />
        <p className="text-center text-sm text-slate-500">Telegram is optional: everything works on the web, and connect it while you set up, or later in Settings.</p>
      </div>
    </section>
  )
}

export function FocusSection() {
  return (
    <section id="focus" aria-labelledby="focus-title" className={SECTION}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(63,182,168,0.08),transparent)]" />
      <div className="relative mx-auto max-w-6xl space-y-14">
        <StoryThread from="Nova writes" to="You focus" />
        <Intro id="focus" eyebrow="Focus room" title="A room to think in.">
          A scene behind you, a sound you mixed, the clock in front, and everything you filed under the topic one click away.
        </Intro>
        <Reveal><LazyFocusDemo /></Reveal>
        <Points items={[
          { title: 'Five living scenes', body: 'Aurora, Rain, Night sky, Embers and Forest, drawn as you watch. Nothing to download.' },
          { title: 'Sound you mix', body: 'Rain, café, fireplace, brown noise and more at their own volumes, or your own playlist.' },
          { title: 'Every session counts honestly', body: 'Timed or untimed. Sessions of ten minutes or more move your progress.' },
        ]} />
      </div>
    </section>
  )
}

export function CreatureSection() {
  return (
    <section id="creature" aria-labelledby="creature-title" className={SECTION}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(255,177,92,0.06),transparent)]" />
      <div className="relative mx-auto max-w-6xl space-y-14">
        <StoryThread from="You focus" to="It grows" />
        <Intro id="creature" eyebrow="Your creature" title="A world that grows with you.">
          Every day you study, your creature’s world grows. Days in a row open new places in its village, and every five days of study is a new level.
        </Intro>
        <Reveal><LazyCreatureDemo /></Reveal>
        <Points items={[
          { title: 'Yours alone', body: 'Your terrain grows from a seed of your own, so no two worlds are the same.' },
          { title: 'Kind about time off', body: 'A missed week takes away some sparkle. It never brings fog.' },
          { title: 'Never a nag', body: 'Nova doesn’t bring it up in chat. It’s there when you want to visit.' },
        ]} />
        <SectionCta>Start your world</SectionCta>
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
    ],
  },
  {
    title: 'Wherever you learn',
    items: [
      { icon: Bookmark, title: 'Save from your phone', body: 'A bookmark sends any page to Kivo from any browser, phones included.' },
      { icon: Search, title: 'Find anything', body: '⌘K (Ctrl K) on Knowledge finds any subject, topic, note, page or task.' },
    ],
  },
  {
    title: 'Progress you can trust',
    items: [
      { icon: TrendingUp, title: 'Progress', body: 'Built only from focus sessions of ten minutes or more.' },
      { icon: Brain, title: 'Reviews on time', body: 'How a session went sets when its topic comes back.' },
      { icon: Dna, title: 'Learning DNA', body: 'What works for you, shown once there’s enough to go on.' },
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
    <section id="features" aria-labelledby="features-title" className={SECTION}>
      <div className="mx-auto max-w-6xl space-y-14">
        <Intro id="features" eyebrow="Everything else" title="The rest of your workspace.">
          Small tools that keep the plan moving.
        </Intro>
        <div className="space-y-10">
          {GROUPS.map(g => (
            <Reveal key={g.title}>
              <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
                <h3 className="pt-1 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">{g.title}</h3>
                <ul className={`grid gap-4 sm:grid-cols-2 ${g.items.length === 2 ? '' : 'xl:grid-cols-3'}`}>
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
  { icon: Puzzle, title: 'Save as you read', body: 'One click from any page, with Nova for Chrome.', href: '#extension' },
  { icon: Target, title: 'Shape your day', body: 'Plan today from what you know.', href: '#workspace' },
  { icon: Send, title: 'Hear from Nova', body: 'A nudge when it matters, on Telegram.', href: '#mentor' },
  { icon: Timer, title: 'Focus', body: 'A room for the session.', href: '#focus' },
  { icon: Sprout, title: 'Watch it grow', body: 'Every day you study counts.', href: '#creature' },
]

export function Journey() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={SECTION}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="how" eyebrow="How it fits together" title="One second brain, from a goal to what you know.">
          Each step opens its preview above.
        </Intro>
        <Reveal>
          <ol className="relative grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            
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
    <section id="use-cases" aria-labelledby="cases-title" className={SECTION}>
      <div className="mx-auto max-w-6xl space-y-12">
        <Intro id="cases" eyebrow="Who it’s for" title="For anyone learning something that matters.">
          A semester or a skill for work: Kivo grows from your own goals.
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

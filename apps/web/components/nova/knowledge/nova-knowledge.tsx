'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Bookmark, LayoutGrid, Library, List, NotebookPen, Search, Settings2, Waypoints } from 'lucide-react'
import type { KnowledgeSubject, KnowledgeTopic, NovaKnowledgeReady } from '@repo/api/nova/product/knowledge.types'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import { cn } from '@/lib/utils'
import { useStartSession } from '../use-start-session'
import { useNovaView } from '../use-nova-view'
import { useTasks } from '../tasks/use-tasks'
import { CommandButton, CommandPalette, useCommandShortcut } from '../workspace/command-palette'
import { BUTTON_PRIMARY, BUTTON_QUIET, LoadFailed, SectionHeading, Skeleton, SURFACE, SURFACE_RAISED, TEXT_LINK } from '../workspace/ui'
import { DueReviews } from './due-reviews'
import { searchSubjects } from './knowledge-search'
import { LEVEL_TONE } from './labels'
import { ArchivedTopics, RecentLearning, SubjectTopics } from './subject-topics'
import { SubjectStudio } from './subject-studio'
import { SubjectBoardView } from './subject-board-view'
import { heroStyle, toneStyle } from '../subject-color'

// The pages next to this one, with the sidebar's icons. None is this page, so
// none is marked current.
const quickLinks = [
  { href: '/notes', label: 'Notes', icon: NotebookPen },
  { href: '/saved', label: 'Saved pages', icon: Bookmark },
  { href: '/map', label: 'Knowledge Map', icon: Waypoints },
]

const ALL = 'all'
// The length of a session started from a topic: the Knowledge Map's.
const TOPIC_SESSION_MINUTES = 25
type View = 'list' | 'board'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// How a subject's topics stand, from the Knowledge view's own levels.
function SubjectLevels({ subject, className }: { subject: KnowledgeSubject; className?: string }) {
  const total = subject.topics.length
  if (total === 0) return null
  const order = ['solid', 'developing', 'weak', 'unverified'] as const
  const count = (level: typeof order[number]) => subject.topics.filter(t => t.level === level).length
  return (
    <div aria-hidden className={cn('flex h-1 gap-px overflow-hidden rounded-full', className)}>
      {order.map(level => count(level) > 0 && <span key={level} className={level === 'unverified' ? 'bg-white/10' : LEVEL_TONE[level]} style={{ width: `${(count(level) / total) * 100}%` }} />)}
    </div>
  )
}

// The Knowledge Space: every subject on record in an outline, one subject at
// a time beside it as a list of its topics or as a board of what is filed
// under them, and what is due. Read from the Knowledge view; the board and
// search also read the Knowledge Map. Levels change only when a session
// ends; names, filing and archiving are the learner's to edit (Subject
// Studio, Archive this topic).
export function NovaKnowledge({ view, onChanged }: { view: NovaKnowledgeReady; onChanged?: () => void }) {
  const { start, starting, error } = useStartSession()
  // Subject Studio: names, filing and archiving are the learner's to edit.
  const [editing, setEditing] = useState(false)
  const map   = useNovaView<NovaKnowledgeMapView>('/api/nova/knowledge-map')
  const board = useTasks()
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<string>(ALL)
  const [mode, setMode]         = useState<View>('list')
  const [focusTopic, setFocusTopic] = useState<{ id: string; n: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  useCommandShortcut(setPaletteOpen)

  const noSubjects = view.totals.subjectCount === 0
  const noTopics   = view.totals.topicCount === 0
  const subjects   = useMemo(() => searchSubjects(view.subjects, query), [view.subjects, query])
  const current    = selected === ALL ? null : view.subjects.find(s => s.subjectId === selected) ?? null
  const mapReady   = map.view?.status === 'ready' ? map.view : null
  // The board is wide: while it shows, it takes the margin's column too, and
  // the margin moves under it.
  const boardShown = current !== null && mode === 'board'

  // A link into this page names a subject (?subject=<id>) or a topic
  // (?topic=<id>): that subject is the one shown. Read once in the browser.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const topic  = params.get('topic')
    const owner  = topic ? view.subjects.find(s => s.topics.some(t => t.id === topic)) : undefined
    const wanted = owner?.subjectId ?? params.get('subject')
    if (wanted && view.subjects.some(s => s.subjectId === wanted)) setSelected(wanted)
    // Only on arrival: later choices are the learner's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = (subjectId: string) => {
    setSelected(subjectId)
    setFocusTopic(null)
    // The address names what is shown, so it can be reloaded or shared.
    const url = subjectId === ALL ? window.location.pathname : `${window.location.pathname}?subject=${encodeURIComponent(subjectId)}`
    window.history.replaceState(null, '', url)
  }

  // Opens a topic's own record in the list: its subject is chosen first, so a
  // related topic in another subject opens there.
  const openTopic = (topicId: string) => {
    const owner = view.subjects.find(s => s.topics.some(t => t.id === topicId))
    if (owner && owner.subjectId !== selected) choose(owner.subjectId)
    setMode('list')
    setFocusTopic(f => ({ id: topicId, n: (f?.n ?? 0) + 1 }))
  }

  // What a topic row can do here: show its connections, open a related
  // topic, and start the same 25-minute session the Knowledge Map starts.
  const actions = {
    map: mapReady,
    onOpenTopic: openTopic,
    onStudy: view.activeSession ? undefined : (topic: KnowledgeTopic) =>
      void start({ topicName: topic.topicName, subjectName: topic.subjectName, durationMinutes: TOPIC_SESSION_MINUTES }, topic.id),
    studying: starting,
  }

  return (
    <div className="mx-auto w-full max-w-7xl pb-20 pt-12 lg:pt-2">
      <header className="nova-hero relative overflow-hidden rounded-[1.75rem] border border-white/8 p-5 shadow-soft sm:p-8" style={heroStyle(view.subjects.map(sub => sub.subjectName))}>
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-keppel-300">Knowledge Space</p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[2.6rem]">Your learning, connected</h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
              Every subject and topic on record, what you filed under them, and what is due to revisit.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 md:flex-none"><CommandButton onOpen={() => setPaletteOpen(true)} /></div>
            <button type="button" onClick={() => setEditing(e => !e)} aria-expanded={editing} data-edit-subjects className={cn(BUTTON_QUIET, 'h-9 bg-card/70')}>
              <Settings2 aria-hidden className="size-4" /> Edit subjects
            </button>
            <Link href="/notes/new" className={cn(BUTTON_PRIMARY, 'h-9 px-3')}><NotebookPen aria-hidden className="size-4" /> New note</Link>
          </div>
        </div>
        {!noSubjects && (
          <dl aria-label="On record" className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-3xl">
            {[
              { label: 'Subjects', value: view.totals.subjectCount },
              { label: 'Topics', value: view.totals.topicCount },
              ...(mapReady ? [{ label: 'Notes', value: mapReady.counts.note }, { label: 'Saved pages', value: mapReady.counts.resource }] : []),
              ...(view.totals.dueCount > 0 ? [{ label: 'Due to revisit', value: view.totals.dueCount, due: true }] : []),
            ].map(stat => (
              <div key={stat.label} className="rounded-2xl border border-white/8 bg-card/70 px-4 py-3 backdrop-blur-sm">
                <dt className="text-[11px] font-medium text-foreground/55">{stat.label}</dt>
                <dd className={cn('mt-0.5 text-2xl font-semibold tabular-nums tracking-tight', 'due' in stat && stat.due ? 'text-amber-300' : 'text-foreground')}>{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <nav aria-label="Knowledge navigation" className="mt-6 flex flex-wrap items-center gap-2">
          {quickLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-card/60 px-3 text-xs font-medium text-foreground/70 transition-colors hover:border-white/25 hover:text-foreground"><Icon aria-hidden className="size-3.5" /> {label}</Link>
          ))}
          <Link href="/home" className={cn(TEXT_LINK, 'ml-1')}>Back to Today <ArrowRight aria-hidden className="size-3" /></Link>
        </nav>
      </header>

      {editing && <SubjectStudio onChanged={() => onChanged?.()} onClose={() => setEditing(false)} />}

      {noSubjects ? (
        <section className={cn(SURFACE_RAISED, 'relative isolate mt-8 overflow-hidden p-6 sm:p-8')} data-empty="subjects">
          <div aria-hidden className="nova-canvas pointer-events-none absolute inset-0 -z-10 opacity-70 [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Nova doesn&apos;t have enough learning context yet</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
            It doesn&apos;t know which subjects you are taking. Tell it on Today and this page will start to fill in.
          </p>
          <Link href="/home" className={cn(BUTTON_PRIMARY, 'mt-5')}>Go to Today</Link>
        </section>
      ) : (
        <>

          {view.activeSession && (
            <div className={cn(SURFACE, 'mt-5 flex items-center justify-between gap-4 border-keppel-400/30 p-4')} data-active-session>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-keppel-300">Session in progress</p>
                <p className="mt-0.5 truncate text-base font-medium text-foreground">{view.activeSession.topicName ?? 'Study session'}</p>
              </div>
              <Link href="/focus" className={cn(BUTTON_PRIMARY, 'h-9 shrink-0')}>Resume</Link>
            </div>
          )}

          <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_17rem]">
            {/* ── The outline: every subject, and a search over their names ── */}
            <nav aria-label="Subjects" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
              <label className="relative block">
                <span className="sr-only">Search subjects and topics</span>
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground/40" />
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter subjects and topics"
                  className="h-9 w-full rounded-lg border border-white/10 bg-transparent pl-8 pr-3 text-sm text-foreground placeholder:text-foreground/40 focus:border-keppel-400/60 focus:outline-none" />
              </label>
              <ul className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
                <li className="shrink-0">
                  <OutlineItem active={selected === ALL} onClick={() => choose(ALL)} label="All subjects" detail={plural(view.totals.topicCount, 'topic', 'topics')} />
                </li>
                {subjects.map(subject => (
                  <li key={subject.subjectId} className="shrink-0">
                    <OutlineItem
                      active={selected === subject.subjectId} onClick={() => choose(subject.subjectId)}
                      label={subject.subjectName}
                      detail={`${plural(subject.summary.topicCount, 'topic', 'topics')}${subject.summary.dueCount > 0 ? ` · ${subject.summary.dueCount} due` : ''}`}
                      due={subject.summary.dueCount > 0}
                      levels={<SubjectLevels subject={subject} className="mt-1.5 hidden lg:flex" />}
                      subjectName={subject.subjectName}
                    />
                  </li>
                ))}
              </ul>
              {subjects.length === 0 && <p className="mt-2 text-xs text-foreground/55">No subject or topic by that name.</p>}
            </nav>

            {/* ── The subject: its topics as a list, or as a board ─────────── */}
            <div className={cn('min-w-0 space-y-8', boardShown && 'xl:col-span-2')}>
              {(selected === ALL || (current?.summary.dueCount ?? 0) > 0) && (
                <DueReviews
                  reviews={current ? view.dueReviews.filter(r => r.subjectName === current.subjectName) : view.dueReviews}
                  hasTopics={!noTopics}
                  blocked={view.activeSession !== null}
                  onStart={review => void start({ topicName: review.topicName, subjectName: review.subjectName, durationMinutes: review.reviewMinutes }, review.id)}
                  starting={starting}
                  error={error}
                />
              )}

              {current ? (
                <section aria-labelledby="knowledge-subject">
                  <div className="subject-tone relative overflow-hidden rounded-2xl border border-[var(--sc-edge)] bg-linear-to-br from-[var(--sc-soft)] via-[var(--sc-faint)] to-transparent p-4 sm:p-5" style={toneStyle(current.subjectName)}>
                    <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-36 rounded-full bg-[var(--sc-soft)] blur-2xl" />
                    <div className="relative flex flex-wrap items-end justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sc-ink)]">Subject</p>
                        <h2 id="knowledge-subject" className="mt-1 flex items-center gap-2.5 text-2xl font-semibold tracking-[-0.02em] text-foreground">
                          <span aria-hidden className="size-3 shrink-0 rounded-full bg-[var(--sc)] ring-4 ring-[var(--sc-soft)]" />{current.subjectName}
                        </h2>
                        <p className="mt-1 text-xs text-foreground/60">
                          {current.summary.topicCount === 0 ? 'No topics yet' : plural(current.summary.topicCount, 'topic', 'topics')}
                          {current.summary.dueCount > 0 && <> · <span className="font-medium text-amber-300">{current.summary.dueCount} due</span></>}
                        </p>
                        <SubjectLevels subject={current} className="mt-2.5 w-56" />
                        {/* Due reviews show a start's error; without them, it is said here. */}
                        {error && current.summary.dueCount === 0 && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <div role="group" aria-label="Show as" className="flex rounded-xl border border-white/10 bg-card/80 p-1 shadow-sm">
                          {([['list', 'List', List], ['board', 'Board', LayoutGrid]] as const).map(([key, label, Icon]) => (
                            <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}
                              className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-keppel-400',
                                mode === key ? 'bg-[var(--sc)] text-[oklch(20%_0.03_var(--sh))] shadow-sm' : 'text-foreground/60 hover:text-foreground')}>
                              <Icon aria-hidden className="size-3.5" /> {label}
                            </button>
                          ))}
                        </div>
                        <Link href={`/notes/new?subjectId=${encodeURIComponent(current.subjectId)}`} className={cn(BUTTON_QUIET, 'bg-card/80')}>
                          <NotebookPen aria-hidden className="size-3.5" /> Note
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    {mode === 'list' ? (
                      <SubjectTopics key={current.subjectId} subject={current} focusTopic={focusTopic} showHeading={false} actions={actions} onChanged={onChanged} />
                    ) : mapReady ? (
                      <SubjectBoardView map={mapReady} subject={current} onOpenTopic={openTopic} />
                    ) : map.loading ? (
                      <div aria-busy="true" aria-label="Loading the board" className="nova-canvas grid gap-4 rounded-2xl border border-white/8 p-4 sm:grid-cols-2">
                        {[0, 1, 2, 3].map(i => <Skeleton key={i} className={cn('rounded-2xl', i % 2 ? 'h-40' : 'h-28')} />)}
                      </div>
                    ) : (
                      <LoadFailed what="The board" onRetry={map.refresh} />
                    )}
                  </div>
                </section>
              ) : (
                <section aria-labelledby="knowledge-subjects">
                  <SectionHeading id="knowledge-subjects" icon={Library}>All subjects</SectionHeading>
                  {noTopics && (
                    <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/60" data-empty="knowledge">
                      Start a focused session and Nova will begin building your knowledge map.
                    </p>
                  )}
                  <div className="mt-4 space-y-8">
                    {subjects.length > 0 ? subjects.map(subject => <SubjectTopics key={subject.subjectName} subject={subject} actions={actions} onChanged={onChanged} />) : (
                      <p className="rounded-lg border border-dashed border-white/12 px-4 py-6 text-sm text-foreground/60">No subjects or topics match that search.</p>
                    )}
                  </div>
                </section>
              )}
            </div>

            {/* ── What happened lately, and how to read the levels ─────────── */}
            <aside aria-label="About your knowledge" className={cn('min-w-0 space-y-6 lg:col-start-2', boardShown ? 'xl:col-start-2' : 'xl:col-start-auto')}>
              {/* Re-read whenever the page's data is: an archive or a restore changes both. */}
              {onChanged && <ArchivedTopics onChanged={onChanged} version={view.generatedAt} />}
              <RecentLearning sessions={view.recentLearning} />
              <section aria-labelledby="knowledge-how" className="border-t border-white/8 pt-5 first:border-t-0 first:pt-0">
                <h2 id="knowledge-how" className="text-[13px] font-semibold text-foreground/90">How to read this</h2>
                <ul className="mt-2 space-y-2 text-sm leading-relaxed text-foreground/60">
                  <li>A topic&apos;s level moves with how you say each session went. It is an estimate, not a test result.</li>
                  <li>The more sessions behind a topic, the more that level is worth.</li>
                  <li>A topic is due when its scheduled review date arrives. How you said the last session went sets that date.</li>
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}

      <CommandPalette
        open={paletteOpen} onClose={() => setPaletteOpen(false)} map={map}
        tasks={board.tasks} onCreateTask={title => board.create({ title })}
      />
    </div>
  )
}

function OutlineItem({ active, onClick, label, detail, due = false, levels, subjectName }: {
  active: boolean; onClick: () => void; label: string; detail: string; due?: boolean; levels?: React.ReactNode
  // Absent for "All subjects".
  subjectName?: string
}) {
  const tone = subjectName !== undefined
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined} style={tone ? toneStyle(subjectName) : undefined}
      className={cn('relative block w-full min-w-36 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-[background-color,box-shadow,color] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-keppel-400 lg:min-w-0',
        tone && 'subject-tone',
        active
          ? tone ? 'bg-[var(--sc-soft)] text-foreground shadow-sm ring-1 ring-[var(--sc-edge)]' : 'bg-white/8 text-foreground'
          : 'text-foreground/80 hover:bg-white/4 hover:text-foreground')}>
      {tone && <span aria-hidden className={cn('absolute inset-y-2 left-0 w-1 rounded-r-full bg-[var(--sc)] transition-opacity', active ? 'opacity-100' : 'opacity-0')} />}
      <span className="flex items-center gap-2 text-sm font-medium">
        {tone && <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--sc)]" />}
        <span className={cn('truncate', active && tone && 'font-semibold')}>{label}</span>
      </span>
      <span className={cn('block truncate text-[11px]', due ? 'text-amber-300/90' : 'text-foreground/55')}>{detail}</span>
      {levels}
    </button>
  )
}

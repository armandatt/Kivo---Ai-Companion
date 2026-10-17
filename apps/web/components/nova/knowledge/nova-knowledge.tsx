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
import { BUTTON_PRIMARY, BUTTON_QUIET, LoadFailed, SectionHeading, Skeleton, SURFACE, TEXT_LINK } from '../workspace/ui'
import { DueReviews } from './due-reviews'
import { searchSubjects } from './knowledge-search'
import { LEVEL_TONE } from './labels'
import { ArchivedTopics, RecentLearning, SubjectTopics } from './subject-topics'
import { SubjectStudio } from './subject-studio'
import { SubjectBoardView } from './subject-board-view'
import { subjectColor } from '../subject-color'

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
// search also read the Knowledge Map. A topic changes when a session on it
// ends, never from here.
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
      <header className="flex flex-col gap-4 border-b border-white/8 pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-keppel-300/90">Knowledge Space</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">Your learning, connected</h1>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-foreground/60">
            Every subject and topic on record, what you filed under them, and what is due to revisit.
          </p>
          <nav aria-label="Knowledge navigation" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {quickLinks.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={TEXT_LINK}><Icon aria-hidden className="size-3.5" /> {label}</Link>
            ))}
            <Link href="/home" className={TEXT_LINK}>Back to Today <ArrowRight aria-hidden className="size-3" /></Link>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1 md:flex-none"><CommandButton onOpen={() => setPaletteOpen(true)} /></div>
          <button type="button" onClick={() => setEditing(e => !e)} aria-expanded={editing} data-edit-subjects className={cn(BUTTON_QUIET, 'h-9')}>
            <Settings2 aria-hidden className="size-4" /> Edit subjects
          </button>
          <Link href="/notes/new" className={cn(BUTTON_PRIMARY, 'h-9 px-3')}><NotebookPen aria-hidden className="size-4" /> New note</Link>
        </div>
      </header>

      {editing && <SubjectStudio onChanged={() => onChanged?.()} onClose={() => setEditing(false)} />}

      {noSubjects ? (
        <section className={cn(SURFACE, 'mt-8 p-5 sm:p-6')} data-empty="subjects">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Nova doesn&apos;t have enough learning context yet</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
            It doesn&apos;t know which subjects you are taking. Tell it on Today and this page will start to fill in.
          </p>
          <Link href="/home" className={cn(BUTTON_PRIMARY, 'mt-5')}>Go to Today</Link>
        </section>
      ) : (
        <>
          <p className="mt-4 text-xs text-foreground/60">
            {plural(view.totals.subjectCount, 'subject', 'subjects')} · {plural(view.totals.topicCount, 'topic', 'topics')}
            {view.totals.dueCount > 0 && <> · <span className="font-medium text-amber-300">{view.totals.dueCount} due</span></>}
            {mapReady && <> · {plural(mapReady.counts.note, 'note', 'notes')} · {plural(mapReady.counts.resource, 'saved page', 'saved pages')}</>}
          </p>

          {view.activeSession && (
            <div className={cn(SURFACE, 'mt-5 flex items-center justify-between gap-4 border-keppel-400/30 p-4')} data-active-session>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-keppel-300">Session in progress</p>
                <p className="mt-0.5 truncate text-base font-medium text-foreground">{view.activeSession.topicName ?? 'Study session'}</p>
              </div>
              <Link href="/focus" className={cn(BUTTON_PRIMARY, 'h-9 shrink-0')}>Resume</Link>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_17rem]">
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
                      dot={subjectColor(subject.subjectName).dot}
                    />
                  </li>
                ))}
              </ul>
              {subjects.length === 0 && <p className="mt-2 text-xs text-foreground/55">No subject or topic by that name.</p>}
            </nav>

            {/* ── The subject: its topics as a list, or as a board ─────────── */}
            <div className="min-w-0 space-y-8">
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
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h2 id="knowledge-subject" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', subjectColor(current.subjectName).dot)} />{current.subjectName}
                      </h2>
                      <p className="mt-0.5 text-xs text-foreground/60">
                        {current.summary.topicCount === 0 ? 'No topics yet' : plural(current.summary.topicCount, 'topic', 'topics')}
                        {current.summary.dueCount > 0 && ` · ${current.summary.dueCount} due`}
                      </p>
                      <SubjectLevels subject={current} className="mt-2 w-48" />
                      {/* Due reviews show a start's error; without them, it is said here. */}
                      {error && current.summary.dueCount === 0 && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div role="group" aria-label="Show as" className="flex rounded-lg border border-white/10 p-0.5">
                        {([['list', 'List', List], ['board', 'Board', LayoutGrid]] as const).map(([key, label, Icon]) => (
                          <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}
                            className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                              mode === key ? 'bg-white/10 text-foreground' : 'text-foreground/60 hover:text-foreground')}>
                            <Icon aria-hidden className="size-3.5" /> {label}
                          </button>
                        ))}
                      </div>
                      <Link href={`/notes/new?subjectId=${encodeURIComponent(current.subjectId)}`} className={BUTTON_QUIET}>
                        <NotebookPen aria-hidden className="size-3.5" /> Note
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4">
                    {mode === 'list' ? (
                      <SubjectTopics key={current.subjectId} subject={current} focusTopic={focusTopic} showHeading={false} actions={actions} onChanged={onChanged} />
                    ) : mapReady ? (
                      <SubjectBoardView map={mapReady} subject={current} onOpenTopic={openTopic} />
                    ) : map.loading ? (
                      <div aria-busy="true" aria-label="Loading the board" className="grid gap-3 sm:grid-cols-2">
                        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
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
            <aside aria-label="About your knowledge" className="min-w-0 space-y-6 lg:col-start-2 xl:col-start-auto">
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

function OutlineItem({ active, onClick, label, detail, due = false, levels, dot }: {
  active: boolean; onClick: () => void; label: string; detail: string; due?: boolean; levels?: React.ReactNode; dot?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined}
      className={cn('block w-full min-w-36 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-keppel-400 lg:min-w-0',
        active ? 'bg-white/8 text-foreground' : 'text-foreground/80 hover:bg-white/4 hover:text-foreground')}>
      <span className="flex items-center gap-2 text-sm font-medium">
        {dot && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot)} />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('block truncate text-[11px]', due ? 'text-amber-300/90' : 'text-foreground/55')}>{detail}</span>
      {levels}
    </button>
  )
}

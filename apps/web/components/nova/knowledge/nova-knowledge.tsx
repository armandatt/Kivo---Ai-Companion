'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Flag, NotebookPen, PencilRuler, Play, Waypoints } from 'lucide-react'
import type { KnowledgeSubject, KnowledgeTopic, NovaKnowledgeReady } from '@repo/api/nova/product/knowledge.types'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { WorkspacesView } from '@repo/api/nova/product/workspaces.types'
import { cn } from '@/lib/utils'
import { useStartSession } from '../use-start-session'
import { useNovaView } from '../use-nova-view'
import { useTasks } from '../tasks/use-tasks'
import { CommandPalette, useCommandShortcut } from '../workspace/command-palette'
import { BUTTON_PRIMARY, BUTTON_QUIET, LoadFailed, Skeleton, TEXT_LINK } from '../workspace/ui'
import { subjectColor, toneStyle } from '../subject-color'
import { DueReviews } from './due-reviews'
import { LEVEL_LABEL, LEVEL_TONE, reviewLabel } from './labels'
import { ArchivedTopics, RecentLearning, TopicDetails, TopicNotes, type TopicActions } from './subject-topics'
import { TopicConnections } from './topic-connections'
import { SubjectBoardView } from './subject-board-view'
import { KnowledgeExplorer } from './knowledge-explorer'
import { buildKnowledgeTree, indexTree, keyOf, pathTo, selectionFrom, selectionHref, workspaceFor, type Selection, type TreeNode } from './knowledge-tree'

// The Knowledge page: an explorer of every subject and the topics inside it,
// and beside it what was chosen: a subject's board, a topic's own page, or,
// with nothing chosen, what is due and what happened lately. The address
// names the choice (?subject=<id> or ?topic=<id>), so back, forward, reload
// and links from the Knowledge Map land on the same view. This page reads;
// the structure is changed in Build with Nova ("Edit learning structure").

// The length of a session started from a topic: the Knowledge Map's.
const TOPIC_SESSION_MINUTES = 25
// Which branches are open, per browser: a convenience, not a record.
const OPEN_KEY = 'kivo-knowledge-tree'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function readOpen(): Set<string> {
  try { const raw = localStorage.getItem(OPEN_KEY); return new Set(raw ? (JSON.parse(raw) as string[]).filter(k => typeof k === 'string') : []) } catch { return new Set() }
}
function writeOpen(open: ReadonlySet<string>) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open].slice(0, 400))) } catch { /* private window */ }
}

// How a subject's studied topics stand, from the Knowledge view's own levels.
function LevelsBar({ topics, className }: { topics: KnowledgeTopic[]; className?: string }) {
  if (topics.length === 0) return null
  const order = ['solid', 'developing', 'weak', 'unverified'] as const
  return (
    <div aria-hidden className={cn('flex h-1 gap-px overflow-hidden rounded-full', className)}>
      {order.map(level => {
        const n = topics.filter(t => t.level === level).length
        return n > 0 && <span key={level} className={level === 'unverified' ? 'bg-white/10' : LEVEL_TONE[level]} style={{ width: `${(n / topics.length) * 100}%` }} />
      })}
    </div>
  )
}

// Every studied topic at or below a node.
function studiedBelow(node: TreeNode): KnowledgeTopic[] {
  return [...(node.topic ? [node.topic] : []), ...node.children.flatMap(studiedBelow)]
}

function Breadcrumbs({ path, onGo }: { path: TreeNode[]; onGo: (s: Selection | null) => void }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-foreground/55">
        <li><button type="button" onClick={() => onGo(null)} className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-keppel-400">Knowledge</button></li>
        {path.map((n, i) => (
          <li key={n.key} className="flex min-w-0 items-center gap-1">
            <ChevronRight aria-hidden className="size-3 shrink-0 text-foreground/30" />
            {i === path.length - 1
              ? <span aria-current="page" className="truncate text-foreground/80">{n.name}</span>
              : <button type="button" onClick={() => onGo({ kind: n.kind, id: n.id })} className="truncate rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-keppel-400">{n.name}</button>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

// A child of a subject or topic, as a row that opens it.
function ChildRow({ node, onGo }: { node: TreeNode; onGo: (s: Selection) => void }) {
  const t = node.topic
  return (
    <li>
      <button type="button" onClick={() => onGo({ kind: node.kind, id: node.id })} data-child={node.name}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/3 focus-visible:bg-white/4 focus-visible:outline-none">
        {node.kind === 'subject'
          ? <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', subjectColor(node.name).dot)} />
          : node.milestone ? <Flag aria-hidden className="size-3 shrink-0 text-foreground/45" />
          : <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', t && t.level !== 'unverified' ? LEVEL_TONE[t.level] : 'border border-foreground/35')} />}
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{node.name}</span>
        <span className={cn('shrink-0 text-xs', node.dueCount > 0 ? 'font-medium text-amber-300' : 'text-foreground/50')}>
          {t ? (t.reviewState === 'due' ? 'Due' : t.level === 'unverified' ? LEVEL_LABEL.unverified : `${LEVEL_LABEL[t.level]} · ${t.masteryPercent}%`)
            : node.topicCount > 0 ? `${plural(node.topicCount, 'topic', 'topics')}${node.dueCount ? ` · ${node.dueCount} due` : ''}` : node.children.length ? plural(node.children.length, 'item', 'items') : 'Nothing inside yet'}
        </span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-foreground/30" />
      </button>
    </li>
  )
}

export function NovaKnowledge({ view, onChanged }: { view: NovaKnowledgeReady; onChanged?: () => void }) {
  const { start, starting, error } = useStartSession()
  // Every workspace's map: the board and a topic's connections read it.
  const map = useNovaView<NovaKnowledgeMapView>('/api/nova/knowledge-map?workspace=all')
  const mapReady = map.view?.status === 'ready' ? map.view : null
  const tasks = useTasks()
  const [paletteOpen, setPaletteOpen] = useState(false)
  useCommandShortcut(setPaletteOpen)

  // A subject inside another: the Knowledge view says so; an older server
  // does not, and the map's subjects do.
  const roots = useMemo(() => {
    const fromMap = new Map((mapReady?.nodes ?? []).flatMap(n => (n.type === 'subject' && n.parentId && n.subjectId ? [[n.subjectId, n.parentId] as const] : [])))
    const own = new Map(view.subjects.map(s => [s.subjectId, s.parentId]))
    return buildKnowledgeTree(view.subjects, id => own.get(id) ?? fromMap.get(id))
  }, [view.subjects, mapReady])
  const index = useMemo(() => indexTree(roots), [roots])

  // ── What is shown: the address ──────────────────────────────────────────
  const [selection, setSelection] = useState<Selection | null>(null)
  const [browse, setBrowse] = useState(false)
  useEffect(() => {
    const read = () => setSelection(selectionFrom(window.location.search))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])
  const go = useCallback((next: Selection | null) => {
    const href = selectionHref(window.location.pathname, next)
    if (href !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, '', href)
    setSelection(next)
    setBrowse(false)
    window.scrollTo({ top: 0 })
  }, [])

  // ── Which branches are open: kept in this browser, and the way to what is shown ──
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [openLoaded, setOpenLoaded] = useState(false)
  useEffect(() => { setOpen(readOpen()); setOpenLoaded(true) }, [])
  useEffect(() => { if (openLoaded) writeOpen(open) }, [open, openLoaded])
  useEffect(() => {
    if (!selection || !openLoaded) return
    const path = pathTo(index, keyOf(selection)).filter(n => n.children.length > 0)
    setOpen(o => (path.every(n => o.has(n.key)) ? o : new Set([...o, ...path.map(n => n.key)])))
  }, [selection, index, openLoaded])
  const toggle = useCallback((key: string, to?: boolean) => setOpen(o => {
    const next = new Set(o)
    if (to ?? !o.has(key)) next.add(key); else next.delete(key)
    return next
  }), [])

  // ── Build with Nova: the workspace holding what is shown, when there is one ──
  const [workspaces, setWorkspaces] = useState<WorkspacesView['workspaces']>([])
  useEffect(() => {
    let gone = false
    fetch('/api/nova/workspaces', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() as Promise<WorkspacesView> : null))
      .then(v => { if (!gone && v?.status === 'ready') setWorkspaces(v.workspaces) })
      .catch(() => { /* the link still opens Build with Nova */ })
    return () => { gone = true }
  }, [])

  const node = selection ? index.get(keyOf(selection)) : undefined
  const path = node ? pathTo(index, node.key) : []
  const subject: KnowledgeSubject | undefined = node ? view.subjects.find(s => s.subjectId === node.subjectId) : undefined
  const workspace = node ? workspaceFor(index, node.subjectId, workspaces) : null
  const editHref = workspace ? `/build?improve=${encodeURIComponent(workspace)}` : '/build'
  const noteHref = node ? `/notes/new?subjectId=${encodeURIComponent(node.subjectId)}${node.kind === 'topic' ? `&topic=${encodeURIComponent(node.name)}` : ''}` : '/notes/new'

  const actions: TopicActions = {
    map: mapReady,
    onOpenTopic: id => go({ kind: 'topic', id }),
    onStudy: view.activeSession ? undefined : (topic: KnowledgeTopic) =>
      void start({ topicName: topic.topicName, subjectName: topic.subjectName, durationMinutes: TOPIC_SESSION_MINUTES }, topic.id),
    studying: starting,
  }

  const noSubjects = view.totals.subjectCount === 0
  const explorerShown = browse || selection === null

  return (
    <div className="mx-auto w-full max-w-[96rem] pb-20 pt-12 lg:pt-2">
      <div className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[17.5rem_minmax(0,1fr)]">
        {/* ── The explorer ─────────────────────────────────────────────── */}
        <aside aria-label="Knowledge explorer" className="lg:sticky lg:top-2 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col lg:self-start">
          <div className="flex items-center justify-between gap-2 pb-2">
            <button type="button" onClick={() => go(null)} className="rounded text-sm font-semibold text-foreground hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-keppel-400" data-knowledge-home>Knowledge</button>
            {selection !== null && (
              <button type="button" onClick={() => setBrowse(b => !b)} aria-expanded={browse} className={cn(TEXT_LINK, 'lg:hidden')}>
                Browse <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', browse && 'rotate-180')} />
              </button>
            )}
          </div>
          {noSubjects ? (
            <p className="text-xs leading-relaxed text-foreground/55">No subjects yet.</p>
          ) : (
            <KnowledgeExplorer roots={roots} selectedKey={node?.key ?? null} open={open} onToggle={toggle}
              onOpen={n => go({ kind: n.kind, id: n.id })}
              className={cn('max-h-[60vh] lg:max-h-none lg:min-h-0 lg:flex-1', explorerShown ? 'flex' : 'hidden lg:flex')} />
          )}
        </aside>

        {/* ── What was chosen ───────────────────────────────────────────── */}
        <div className="min-w-0 pt-4 lg:pt-0">
          {view.activeSession && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-keppel-400/25 bg-keppel-400/[0.05] px-4 py-2.5 text-sm" data-active-session>
              <span className="min-w-0 truncate text-foreground/80"><span className="font-medium text-keppel-300">Studying</span> · {view.activeSession.topicName ?? 'a session'}</span>
              <Link href="/focus" className={cn(TEXT_LINK, 'shrink-0 text-keppel-300')}>Resume</Link>
            </div>
          )}

          {selection && !node ? (
            <div className="view-in rounded-2xl border border-dashed border-white/12 px-6 py-10 text-center" data-missing={selection.kind}>
              <p className="text-base font-semibold text-foreground">That {selection.kind} isn&apos;t in your knowledge any more</p>
              <p className="mt-1 text-sm text-foreground/60">It may have been renamed, archived or removed.</p>
              <button type="button" onClick={() => go(null)} className={cn(BUTTON_QUIET, 'mt-5')}>Back to Knowledge</button>
            </div>
          ) : node ? (
            <div key={node.key} className="view-in">
              <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-white/8 pb-4">
                <div className="min-w-0">
                  <Breadcrumbs path={path.slice(0, -1)} onGo={go} />
                  <h1 className="mt-1.5 flex items-center gap-2.5 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[1.75rem]" data-view={node.kind}>
                    {node.kind === 'subject' && <span aria-hidden className={cn('size-3 shrink-0 rounded-[4px]', subjectColor(node.name).dot)} />}
                    {node.milestone && <Flag aria-hidden className="size-5 shrink-0 text-foreground/50" />}
                    <span className="min-w-0 break-words">{node.name}</span>
                  </h1>
                  <p className="mt-1 text-[13px] text-foreground/55">
                    {node.topic
                      ? <>{node.topic.level === 'unverified' ? LEVEL_LABEL.unverified : `${LEVEL_LABEL[node.topic.level]} · ${node.topic.masteryPercent}%`} · <span className={node.topic.reviewState === 'due' ? 'font-medium text-amber-300' : undefined}>{reviewLabel(node.topic)}</span></>
                      : <>{node.topicCount === 0 ? 'No topics yet' : plural(node.topicCount, 'topic', 'topics')}{node.dueCount > 0 && <> · <span className="font-medium text-amber-300">{node.dueCount} due</span></>}</>}
                    {node.milestone && ' · Milestone'}
                  </p>
                  {!node.topic && <LevelsBar topics={studiedBelow(node)} className="mt-2 w-48" />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={noteHref} className={BUTTON_QUIET}><NotebookPen aria-hidden className="size-3.5" /> Note</Link>
                  <Link href={`/map?focus=${encodeURIComponent(`${node.kind}:${node.id}`)}`} className={BUTTON_QUIET} aria-label="Open on the Knowledge Map" title="Open on the Knowledge Map"><Waypoints aria-hidden className="size-3.5" /></Link>
                  <Link href={editHref} className={cn(TEXT_LINK, 'ml-1')} data-edit-structure><PencilRuler aria-hidden className="size-3.5" /> Edit learning structure</Link>
                </div>
              </header>

              {node.kind === 'subject' ? (
                <div className="mt-5 space-y-5">
                  {node.children.some(c => c.kind === 'subject') && (
                    <ul aria-label={`Subjects inside ${node.name}`} className="flex flex-wrap gap-2">
                      {node.children.filter(c => c.kind === 'subject').map(c => (
                        <li key={c.key}>
                          <button type="button" onClick={() => go({ kind: 'subject', id: c.id })} style={toneStyle(c.name)}
                            className="subject-tone inline-flex h-8 items-center gap-2 rounded-full border border-[var(--sc-edge)] bg-[var(--sc-faint)] px-3 text-xs font-medium text-foreground/85 hover:text-foreground">
                            <span aria-hidden className={cn('size-2 rounded-[2px]', subjectColor(c.name).dot)} />{c.name}
                            <span className="text-foreground/50">{c.topicCount}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {subject && (mapReady ? (
                    <SubjectBoardView map={mapReady} subject={subject} onOpenTopic={id => go({ kind: 'topic', id })} />
                  ) : map.loading ? (
                    <div aria-busy="true" aria-label="Loading the board" className="nova-canvas grid gap-4 rounded-2xl border border-white/8 p-4 sm:grid-cols-2">
                      {[0, 1, 2, 3].map(i => <Skeleton key={i} className={cn('rounded-2xl', i % 2 ? 'h-40' : 'h-28')} />)}
                    </div>
                  ) : (
                    <LoadFailed what="The board" onRetry={map.refresh} />
                  ))}
                </div>
              ) : (
                <div className="mt-5 max-w-3xl space-y-6">
                  {node.children.length > 0 && (
                    <section aria-labelledby="topic-inside">
                      <h2 id="topic-inside" className="text-xs font-semibold text-foreground/60">Inside {node.name}</h2>
                      <ul className="mt-2 divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8" data-topic-children>
                        {node.children.map(c => <ChildRow key={c.key} node={c} onGo={go} />)}
                      </ul>
                    </section>
                  )}
                  {node.topic ? (
                    <section aria-label="Progress" style={toneStyle(node.topic.subjectName)} className="subject-tone" data-topic-detail={node.name}>
                      <TopicDetails topic={node.topic} subjectId={node.subjectId} actions={actions} onChanged={onChanged} />
                      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
                    </section>
                  ) : (
                    <section aria-label="Filed here" data-topic-detail={node.name}>
                      {node.children.length === 0 && (
                        <p className="text-sm text-foreground/60">{node.milestone ? 'A milestone with nothing inside it yet.' : 'Nothing inside this topic yet.'}</p>
                      )}
                      <TopicNotes subjectId={node.subjectId} topicName={node.name} />
                      <TopicConnections map={mapReady} topicId={node.id} topicName={node.name} onOpenTopic={id => go({ kind: 'topic', id })} />
                    </section>
                  )}
                </div>
              )}
            </div>
          ) : (
            <Overview view={view} roots={roots} onGo={go} start={start} starting={starting} error={error} onChanged={onChanged} />
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen} onClose={() => setPaletteOpen(false)} map={map}
        tasks={tasks.tasks} onCreateTask={title => tasks.create({ title })}
      />
    </div>
  )
}

// With nothing chosen: the subjects at a glance, what is due, what happened lately.
function Overview({ view, roots, onGo, start, starting, error, onChanged }: {
  view: NovaKnowledgeReady; roots: TreeNode[]; onGo: (s: Selection) => void
  start: ReturnType<typeof useStartSession>['start']; starting: string | null; error: string | null; onChanged?: () => void
}) {
  const { totals } = view
  return (
    <div className="view-in" data-view="overview">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-white/8 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[1.75rem]">Knowledge</h1>
          <p className="mt-1 text-[13px] text-foreground/55">
            {plural(totals.subjectCount, 'subject', 'subjects')} · {plural(totals.topicCount, 'topic', 'topics')}
            {totals.dueCount > 0 && <> · <span className="font-medium text-amber-300">{totals.dueCount} due</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/notes/new" className={BUTTON_QUIET}><NotebookPen aria-hidden className="size-3.5" /> Note</Link>
          <Link href="/build" className={cn(TEXT_LINK, 'ml-1')} data-edit-structure><PencilRuler aria-hidden className="size-3.5" /> Edit learning structure</Link>
        </div>
      </header>

      {roots.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/12 px-6 py-10 text-center" data-empty="subjects">
          <p className="text-base font-semibold text-foreground">No subjects yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-foreground/60">Build your learning structure with Nova, and its subjects and topics appear here.</p>
          <Link href="/build" className={cn(BUTTON_PRIMARY, 'mt-5')}><Play aria-hidden className="size-3.5" /> Build with Nova</Link>
        </div>
      ) : (
        <>
          <ul aria-label="Subjects" className="mt-6 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {roots.map(r => (
              <li key={r.key}>
                <button type="button" onClick={() => onGo({ kind: r.kind, id: r.id })} style={toneStyle(r.name)} data-subject-card={r.name}
                  className="subject-tone group block w-full rounded-xl border border-white/8 bg-card/60 p-4 text-left transition-colors hover:border-[var(--sc-edge)] hover:bg-[var(--sc-faint)] focus-visible:outline-2 focus-visible:outline-keppel-400">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', subjectColor(r.name).dot)} />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <span className="mt-1 block text-xs text-foreground/55">
                    {r.topicCount === 0 ? 'No topics yet' : plural(r.topicCount, 'topic', 'topics')}
                    {r.dueCount > 0 && <> · <span className="font-medium text-amber-300">{r.dueCount} due</span></>}
                  </span>
                  <LevelsBar topics={studiedBelow(r)} className="mt-3" />
                </button>
              </li>
            ))}
          </ul>

          {view.dueReviews.length > 0 && (
            <div className="mt-8">
              <DueReviews
                reviews={view.dueReviews} hasTopics={totals.topicCount > 0} blocked={view.activeSession !== null}
                onStart={review => void start({ topicName: review.topicName, subjectName: review.subjectName, durationMinutes: review.reviewMinutes }, review.id)}
                starting={starting} error={error}
              />
            </div>
          )}

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <RecentLearning sessions={view.recentLearning} />
            {onChanged && <ArchivedTopics onChanged={onChanged} version={view.generatedAt} />}
          </div>
        </>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useStartSession } from '../use-start-session'
import { ArrowUpRight, ChevronsDownUp, ChevronsUpDown, Focus, Link2, Maximize2, Minus, Plus, RotateCcw, Search, Waypoints, X } from 'lucide-react'
import type { MapEdgeKind, MapNode, MapNodeType, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { MAP_LAYOUT_COORD_MAX } from '@repo/api/nova/product/map-layout.types'
import { treeOrder } from '@repo/api/nova/product/task-tree'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '../workspace/ui'
import { toneStyle } from '../subject-color'
import { CARD, TREE_EDGES, layoutMap, treeOf, withPositions, type MapLayout } from './layout'
import { useMapLayout } from './use-map-layout'
import { filingChoices, placementLabel, placementOf, planLink, samePlacement, type Placement } from './map-edit'
import { addNoteLink, fileItem, type EditOutcome } from './map-actions'
import { revealDetail } from './reveal-detail'
import { fitKey, focusToApply, keepValid } from './view-state'

const TYPES: Array<{ type: MapNodeType; label: string; plural: string }> = [
  { type: 'subject',  label: 'Subject',    plural: 'Subjects' },
  { type: 'topic',    label: 'Topic',      plural: 'Topics' },
  { type: 'task',     label: 'Task',       plural: 'Tasks' },
  { type: 'note',     label: 'Note',       plural: 'Notes' },
  { type: 'resource', label: 'Saved page', plural: 'Saved pages' },
]
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.type, t.label])) as Record<MapNodeType, string>

// One colour per kind of thing, taken from the theme so both themes work.
// Teal (Nova's) marks subjects and learning; selection uses the action colour.
const FILL: Record<MapNodeType, string> = {
  subject: 'var(--nova)', topic: 'var(--map-topic)', task: 'var(--map-task)', note: 'var(--map-note)', resource: 'var(--map-resource)',
}
const LEVEL_TEXT = { weak: 'Weak', developing: 'Developing', solid: 'Solid' } as const

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const day   = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type View = { x: number; y: number; k: number }
const MIN_K = 0.2, MAX_K = 2.5

// A session started from the map has no planned block behind it, so it is
// the length of an ordinary one.
const MAP_SESSION_MINUTES = 25

// How far one arrow key moves the map, in screen pixels.
const PAN_STEP = 60
// How far Alt and an arrow key move a card, in map units (Shift for more).
const NUDGE = 20
// How far the pointer must travel before a press on a card becomes a drag.
// Under it, the press is a click and selects the card.
const DRAG_THRESHOLD = 5

const clampCoord = (v: number) => Math.max(-MAP_LAYOUT_COORD_MAX, Math.min(MAP_LAYOUT_COORD_MAX, v))

// How one item stands to another, in words, from the selected item's side.
const RELATION: Record<string, [string, string]> = {
  contains:    ['A subject inside this one', 'The subject it is inside'],
  has_topic:   ['Topic of this subject', 'Its subject'],
  subtopic:    ['A topic inside this one', 'The topic it is inside'],
  has_task:    ['Task filed here', 'Where it is filed'],
  step:        ['A step of this task', 'The task it is a step of'],
  depends_on:  ['Waits for it', 'Waiting on this'],
  about_topic: ['Filed under this topic', 'Its topic'],
  filed_under: ['Filed under this subject', 'Its subject'],
  links_to:    ['This note links to it', 'Links to this'],
}

// What a focused view shows: the item, everything inside it (a subject's
// subjects, topics, tasks and notes; a topic's topics; a task's steps), the
// items it sits inside up to the top, and what is one link away from any of
// those (a [[link]], a wait).
function around(id: string, edges: Array<{ from: string; to: string; kind?: string }>): Set<string> {
  const tree = edges.filter(e => e.kind && TREE_EDGES.has(e.kind as MapEdgeKind))
  const seen = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const e of tree) if (seen.has(e.from) && !seen.has(e.to)) { seen.add(e.to); grew = true }
  }
  for (let at: string | undefined = id, hops = 0; at && hops < 50; hops++) { const up: { from: string } | undefined = tree.find(e => e.to === at); if (!up) break; seen.add(up.from); at = up.from }
  const core = new Set(seen)
  for (const e of edges) if (!(e.kind && TREE_EDGES.has(e.kind as MapEdgeKind))) { if (core.has(e.from)) seen.add(e.to); if (core.has(e.to)) seen.add(e.from) }
  return seen
}

const rowId = (id: string) => id.slice(id.indexOf(':') + 1)

// ── Editing, from the detail panel ───────────────────────────────────────────
// Each is an explicit action with its own confirmation. Moving a card never
// files or links anything.

function Outcome({ outcome }: { outcome: EditOutcome | null }) {
  if (!outcome) return null
  const bad = outcome.kind === 'failed' || outcome.kind === 'conflict'
  return <p role={bad ? 'alert' : 'status'} className={cn('mt-2 text-xs leading-relaxed', bad ? 'text-red-400' : 'text-foreground/75')}>{outcome.message}</p>
}

function LinkEditor({ node, view, onChanged }: { node: MapNode; view: NovaKnowledgeMapReady; onChanged: () => void }) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [target, setTarget]   = useState<MapNode | null>(null)
  const [busy, setBusy]       = useState(false)
  const [outcome, setOutcome] = useState<EditOutcome | null>(null)

  const linked = useMemo(() => new Set(view.edges.filter(e => e.kind === 'links_to' && e.from === node.id).map(e => e.to)), [view.edges, node.id])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return view.nodes
      .filter(n => (n.type === 'note' || n.type === 'topic') && n.id !== node.id)
      .filter(n => !q || n.label.toLowerCase().includes(q) || ('subjectName' in n && n.subjectName?.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [view.nodes, node.id, query])
  const plan = target ? planLink(node, target, view.nodes, view.edges) : null

  const confirm = async () => {
    if (!plan?.ok) return
    setBusy(true)
    const result = await addNoteLink(rowId(node.id), plan)
    setBusy(false)
    setOutcome(result)
    if (result.kind === 'done' || result.kind === 'conflict') { setTarget(null); setOpen(false); onChanged() }
  }

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => { setOpen(true); setOutcome(null) }} className={BUTTON_QUIET} data-link-open>
          <Link2 aria-hidden className="size-3.5" /> Link to a note or topic
        </button>
        <Outcome outcome={outcome} />
      </div>
    )
  }
  return (
    <section aria-label="Link this note" className="rounded-xl border border-white/10 bg-white/3 p-3">
      {!target ? (
        <>
          <label className="block text-xs font-medium text-foreground/75" htmlFor={`link-q-${node.id}`}>Link “{short(node.label, 40)}” to</label>
          <input id={`link-q-${node.id}`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note or topic" autoFocus
            className="mt-2 h-9 w-full rounded-lg border border-white/12 bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle focus-visible:border-ring" />
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
            {candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-subtle">No note or topic on the map matches.</li>}
            {candidates.map(c => (
              <li key={c.id}>
                <button type="button" onClick={() => setTarget(c)} disabled={linked.has(c.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5 disabled:opacity-60">
                  <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[c.type] }} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="shrink-0 text-[11px] text-subtle">{linked.has(c.id) ? 'Linked' : TYPE_LABEL[c.type]}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end"><button type="button" onClick={() => setOpen(false)} className={BUTTON_QUIET}>Cancel</button></div>
        </>
      ) : plan && plan.ok ? (
        <>
          <p className="text-sm leading-relaxed text-foreground/85">
            Add <code className="rounded bg-white/6 px-1 py-0.5 text-[13px]">[[{plan.title}]]</code> on a new line at the end of “{node.label}”, linking it to the {TYPE_LABEL[target.type].toLowerCase()} “{target.label}”.
          </p>
          <p className="mt-1.5 text-xs text-subtle">Nothing else in the note changes. Remove the brackets in the note to remove the link.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void confirm()} disabled={busy} className={BUTTON_PRIMARY} data-link-confirm>{busy ? 'Adding…' : 'Add link'}</button>
            <button type="button" onClick={() => setTarget(null)} disabled={busy} className={BUTTON_QUIET}>Choose another</button>
          </div>
        </>
      ) : (
        <>
          <p role="alert" className="text-sm leading-relaxed text-foreground/85">{plan && !plan.ok ? plan.reason : ''}</p>
          <div className="mt-3 flex gap-2"><button type="button" onClick={() => setTarget(null)} className={BUTTON_QUIET}>Choose another</button></div>
        </>
      )}
      <Outcome outcome={outcome} />
    </section>
  )
}

function FileEditor({ node, view, onChanged }: { node: MapNode; view: NovaKnowledgeMapReady; onChanged: () => void }) {
  const choices = useMemo(() => filingChoices(view.nodes), [view.nodes])
  const current = placementOf(node)
  const [open, setOpen]       = useState(false)
  const [subjectId, setSubjectId] = useState(current?.subjectId ?? choices[0]?.subjectId ?? '')
  const [topic, setTopic]     = useState<string>(current?.topicName ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [outcome, setOutcome] = useState<EditOutcome | null>(null)
  if (node.type !== 'note' && node.type !== 'resource') return null

  const topics = choices.find(c => c.subjectId === subjectId)?.topics ?? []
  const to: Placement | null = subjectId ? { subjectId, topicName: topic && topics.includes(topic) ? topic : null } : null
  const unchanged = samePlacement(current, to)
  const what = node.type === 'note' ? 'note' : 'saved page'

  const confirm = async () => {
    if (!to) return
    setBusy(true)
    const result = await fileItem(node.type === 'note' ? 'note' : 'resource', rowId(node.id), to, node.type === 'note' ? node.updatedAt : null, placementLabel(to, view.nodes))
    setBusy(false)
    setOutcome(result)
    setConfirming(false)
    if (result.kind === 'done' || result.kind === 'conflict') { setOpen(false); onChanged() }
  }

  if (choices.length === 0) return null
  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => { setOpen(true); setOutcome(null) }} className={BUTTON_QUIET} data-file-open>
          <Waypoints aria-hidden className="size-3.5" /> File under…
        </button>
        <Outcome outcome={outcome} />
      </div>
    )
  }
  const select = 'h-9 w-full rounded-lg border border-white/12 bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring'
  return (
    <section aria-label={`File this ${what}`} className="rounded-xl border border-white/10 bg-white/3 p-3">
      <p className="text-xs text-subtle">Now: <span className="text-foreground/85">{placementLabel(current, view.nodes)}</span></p>
      <div className="mt-2 grid gap-2">
        <div>
          <label htmlFor={`file-subject-${node.id}`} className="text-xs font-medium text-foreground/75">Subject</label>
          <select id={`file-subject-${node.id}`} value={subjectId} onChange={e => { setSubjectId(e.target.value); setTopic(''); setConfirming(false) }} className={cn(select, 'mt-1')}>
            {choices.map(c => <option key={c.subjectId} value={c.subjectId}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`file-topic-${node.id}`} className="text-xs font-medium text-foreground/75">Topic</label>
          <select id={`file-topic-${node.id}`} value={to?.topicName ?? ''} onChange={e => { setTopic(e.target.value); setConfirming(false) }} className={cn(select, 'mt-1')}>
            <option value="">The subject only</option>
            {topics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {confirming && to ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-foreground/85">Move this {what} from {placementLabel(current, view.nodes)} to {placementLabel(to, view.nodes)}?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void confirm()} disabled={busy} className={BUTTON_PRIMARY} data-file-confirm>{busy ? 'Moving…' : 'Move it'}</button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={BUTTON_QUIET}>Not yet</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfirming(true)} disabled={!to || unchanged} className={BUTTON_PRIMARY}>{unchanged ? 'Already filed here' : 'Review move'}</button>
          <button type="button" onClick={() => setOpen(false)} className={BUTTON_QUIET}>Cancel</button>
        </div>
      )}
      <Outcome outcome={outcome} />
    </section>
  )
}

function Detail({ node, neighbours, onPick, onClose, onScope, scoped, view, onChanged, panelRef, inside, collapsed, onCollapse }: {
  node: MapNode; neighbours: Array<{ node: MapNode; relation: string }>; onPick: (id: string) => void; onClose: () => void
  onScope: () => void; scoped: boolean; view: NovaKnowledgeMapReady; onChanged: () => void
  panelRef?: React.Ref<HTMLElement>
  // How many cards hang from it, and whether they are folded away.
  inside: number; collapsed: boolean; onCollapse: () => void
}) {
  const { start, starting, error: startError } = useStartSession()
  const facts: Array<[string, string]> = []
  if (node.type === 'subject') {
    const parent = node.parentId ? view.nodes.find(n => n.id === `subject:${node.parentId}`) : undefined
    if (parent) facts.push(['Inside', parent.label])
    const inside = view.edges.filter(e => e.kind === 'contains' && e.from === node.id).length
    if (inside) facts.push(['Subjects inside', String(inside)])
    facts.push(['Topics', String(node.topics)], ['Notes', String(node.notes)], ['Saved pages', String(node.resources)])
  } else if (node.type === 'topic') {
    facts.push(['Subject', node.subjectName])
    const parent = node.parentId ? view.nodes.find(n => n.id === `topic:${node.parentId}`) : undefined
    if (parent) facts.push(['Inside', parent.label])
    const within = view.edges.filter(e => e.kind === 'subtopic' && e.from === node.id).length
    if (within) facts.push(['Topics inside', String(within)])
    if (node.kind === 'milestone') {
      facts.push(['Kind', 'A milestone (a stage of work, not studied)'])
      const d = node.details
      if (d?.weeks || d?.hoursPerWeek) facts.push(['Effort (an estimate)', [d.weeks ? `${d.weeks} week${d.weeks === 1 ? '' : 's'}` : null, d.hoursPerWeek ? `${d.hoursPerWeek} h a week` : null].filter(Boolean).join(', ')])
      if (d?.completion) facts.push(['Done when', d.completion])
    } else if (node.studied === false) {
      facts.push(['Studied', 'Through the topics inside it'])
    } else {
      facts.push(['Sessions behind it', node.sessions === 0 ? 'None yet' : String(node.sessions)])
      if (node.level && node.masteryPercent !== null) facts.push(['Your own estimate', `${LEVEL_TEXT[node.level]} · ${node.masteryPercent}%`])
    }
    facts.push(['Notes', String(node.notes)], ['Saved pages', String(node.resources)])
  } else if (node.type === 'task') {
    facts.push(['Status', node.status === 'done' ? 'Done' : node.status === 'in_progress' ? 'In progress' : 'To do'])
    if (node.subjectName) facts.push(['Subject', node.subjectName])
    if (node.topicName) facts.push(['Filed under', node.topicName])
    if (node.dueDay) facts.push(['Due', node.dueDay])
    if (node.estimatedMinutes) facts.push(['Estimate', `about ${node.estimatedMinutes} min`])
    if (node.priority) facts.push(['Priority', node.priority[0]!.toUpperCase() + node.priority.slice(1)])
    if (node.waitsOn) facts.push(['Waits for', `${node.waitsOn} task${node.waitsOn === 1 ? '' : 's'}`])
  } else if (node.type === 'note') {
    facts.push(['Subject', node.subjectName ?? 'Not filed under a subject'])
    if (node.topicName) facts.push(['Topic', node.topicLinked ? node.topicName : `${node.topicName} (not one of that subject's topics yet)`])
    facts.push(['Last edited', day(node.updatedAt)])
  } else {
    facts.push(['Site', node.domain])
    facts.push(['Subject', node.subjectName ?? 'Not filed under a subject'])
    if (node.topicName) facts.push(['Topic', node.topicLinked ? node.topicName : `${node.topicName} (not one of that subject's topics yet)`])
    if (node.filedBy === 'nova') facts.push(['Filed by', 'Nova, from a name match. Keep or undo it on Saved.'])
    facts.push([node.kind === 'study_requested' ? 'Asked to study' : 'Saved', day(node.savedAt)])
  }
  const open = node.type === 'note' ? 'Open note' : node.type === 'resource' ? 'Open in Saved' : node.type === 'topic' ? 'Open this topic' : node.type === 'task' ? 'Open on the board' : 'Open this subject'
  // A new note filed where this node is. The note editor reads both from the address.
  const noteHere = node.type === 'topic' ? `/notes/new?subjectId=${encodeURIComponent(node.subjectId ?? '')}&topic=${encodeURIComponent(node.label)}`
    : node.type === 'subject' ? `/notes/new?subjectId=${encodeURIComponent(node.subjectId ?? '')}` : null
  const tone = node.type === 'subject' ? node.label : node.subjectName ?? null
  const explanation = node.type === 'topic' ? node.details?.explanation ?? null : null
  const goals = node.type === 'topic' ? node.details?.goals ?? [] : []

  return (
    <aside ref={panelRef} aria-label="Selected item" className="subject-tone flex max-h-[52vh] flex-col overflow-y-auto border-t border-white/8 bg-card p-5 lg:max-h-none lg:w-[22rem] lg:shrink-0 lg:border-l lg:border-t-0" style={toneStyle(tone)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-subtle">
            <span className="inline-block size-2 rounded-full" style={{ background: FILL[node.type] }} />{TYPE_LABEL[node.type]}
            {tone && <><span aria-hidden>·</span><span className="truncate normal-case tracking-normal text-[var(--sc-ink)]">{tone}</span></>}
          </p>
          <h2 className="mt-2 break-words text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{node.label}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>
      </div>

      <dl className="mt-4 divide-y divide-white/6 border-y border-white/6 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="shrink-0 text-subtle">{k}</dt>
            <dd className="text-right text-foreground/90 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {node.type === 'topic' && node.level && node.studied !== false && (
        <p className="mt-3 text-xs leading-relaxed text-subtle">The estimate comes from how you said your sessions went. It is not a test result.</p>
      )}
      {explanation && <p className="mt-3 text-sm leading-relaxed text-foreground/80">{explanation}</p>}
      {goals.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-foreground/80" data-milestone-goals>{goals.map(g => <li key={g}>{g}</li>)}</ul>}

      <div className="mt-5 flex flex-wrap gap-2">
        {node.href && <Link href={node.href} className={BUTTON_PRIMARY}>{open}</Link>}
        {node.type === 'resource' && (
          <a href={node.url} target="_blank" rel="noopener noreferrer" className={cn(BUTTON_QUIET, 'h-10')}>
            Visit page <ArrowUpRight className="size-3.5" />
          </a>
        )}
        {/* The ordinary start, on a topic studied on its own, under its own subject. */}
        {node.type === 'topic' && node.studied !== false && node.kind !== 'milestone' && (
          <button type="button" disabled={starting !== null} data-start-topic
            onClick={() => void start({ topicName: node.label, subjectName: node.subjectName, durationMinutes: MAP_SESSION_MINUTES }, node.id)}
            className={cn(BUTTON_QUIET, 'h-10')}>
            {starting === node.id ? 'Starting…' : `Start a ${MAP_SESSION_MINUTES} min session`}
          </button>
        )}
        {noteHere && <Link href={noteHere} className={cn(BUTTON_QUIET, 'h-10')} data-note-here>New note here</Link>}
        {!scoped && <button type="button" onClick={onScope} className={cn(BUTTON_QUIET, 'h-10')} data-scope-here><Focus aria-hidden className="size-3.5" /> Focus on this branch</button>}
        {inside > 0 && <button type="button" onClick={onCollapse} className={cn(BUTTON_QUIET, 'h-10')} data-collapse aria-pressed={collapsed}>{collapsed ? <ChevronsUpDown aria-hidden className="size-3.5" /> : <ChevronsDownUp aria-hidden className="size-3.5" />} {collapsed ? `Show the ${inside} inside` : `Fold the ${inside} inside`}</button>}
      </div>
      {startError && <p role="alert" className="mt-3 text-sm text-red-400">{startError}</p>}

      {(node.type === 'note' || node.type === 'resource') && (
        <div className="mt-6 space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">Connect</h3>
          {node.type === 'note' && <LinkEditor key={`link-${node.id}`} node={node} view={view} onChanged={onChanged} />}
          <FileEditor key={`file-${node.id}`} node={node} view={view} onChanged={onChanged} />
        </div>
      )}

      {(node.type === 'topic' || node.type === 'subject') && node.tasks && node.tasks.length > 0 && (
        <div className="mt-6" data-map-tasks>
          <h3 className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">
            Tasks <span className="normal-case tracking-normal">{node.tasks.filter(t => t.status === 'done').length} of {node.tasks.length} done</span>
          </h3>
          <ul className="mt-2 space-y-0.5">
            {treeOrder(node.tasks.map(t => ({ ...t, parent: t.parentId }))).map(({ item: t, depth }) => (
              <li key={t.id} className="flex items-start gap-2 py-0.5 text-sm" style={{ paddingLeft: depth * 14 }} data-depth={depth}>
                <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', t.status === 'done' ? 'bg-action' : t.status === 'in_progress' ? 'bg-amber-400' : 'bg-foreground/30')} />
                <span className={cn('min-w-0 break-words', t.status === 'done' ? 'text-subtle line-through' : depth > 0 ? 'text-foreground/75' : 'text-foreground/90')}>{t.title}</span>
              </li>
            ))}
          </ul>
          <Link href="/planner?view=board" className="mt-2 inline-block text-xs font-medium text-foreground/60 underline-offset-4 hover:text-foreground hover:underline">Open on the board</Link>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">Connected to</h3>
        {neighbours.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground/65">
            Nothing. {node.type === 'note' || node.type === 'resource'
              ? 'It is not filed under a subject. File it under one and it joins that subject here.'
              : node.type === 'topic' ? 'No note or saved page names this topic yet.' : 'This subject has no topics, notes or saved pages yet.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {neighbours.map(({ node: n, relation }) => (
              <li key={`${n.id}:${relation}`}>
                <button type="button" onClick={() => onPick(n.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[n.type] }} />
                  <span className="min-w-0">
                    <span className="block truncate">{n.label}</span>
                    <span className="block text-[11px] text-subtle">{relation}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-subtle">{TYPE_LABEL[n.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

// ── The cards ────────────────────────────────────────────────────────────────
// What a card shows is what the map reported, nothing more: its title, its
// subject's colour, a topic's own estimate or that no session stands behind
// it, a subject's counts, when a note was edited, a saved page's site.

type CardDetail = 0 | 1 | 2   // shapes only; titles; titles and facts

function CardFace({ n, detail }: { n: MapNode; detail: CardDetail }) {
  const { w, h } = CARD[n.type]
  const x0 = -w / 2, y0 = -h / 2
  const text = 'fill-foreground'
  const meta = { fontSize: 10.5, className: 'fill-[var(--subtle)]' }
  if (n.type === 'subject') {
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={16} fill="var(--card)" stroke="var(--sc-edge)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <rect x={x0} y={y0} width={w} height={h} rx={16} fill="var(--sc-soft)" />
        <circle cx={x0 + 20} cy={0} r={6} fill="var(--sc)" />
        {detail >= 1 && (
          <text x={x0 + 34} y={detail === 2 ? -3 : 6} className={text} style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }} fontSize={16}>{short(n.label, 19)}</text>
        )}
        {detail === 2 && (
          <text x={x0 + 34} y={17} {...meta}>{[plural(n.topics, 'topic'), plural(n.notes, 'note'), plural(n.resources, 'page')].join(' · ')}</text>
        )}
      </>
    )
  }
  if (n.type === 'task') {
    const done = n.status === 'done'
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={9} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <rect x={x0 + 10} y={-5} width={10} height={10} rx={2.5} fill={done ? FILL.task : 'none'} stroke={FILL.task} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        {detail >= 1 && <text x={x0 + 28} y={detail === 2 ? -4 : 4.5} className={cn(text, done && 'opacity-60')} fontSize={12.5} fontWeight={500} textDecoration={done ? 'line-through' : undefined}>{short(n.label, 21)}</text>}
        {detail === 2 && <text x={x0 + 28} y={13} {...meta}>{[n.status === 'in_progress' ? 'In progress' : done ? 'Done' : 'To do', n.dueDay ? `due ${shortDay(`${n.dueDay}T12:00:00Z`)}` : null, n.waitsOn ? `waits on ${n.waitsOn}` : null].filter(Boolean).join(' · ')}</text>}
      </>
    )
  }
  if (n.type === 'topic' && (n.kind === 'milestone' || n.studied === false)) {
    // A milestone, or a topic that organises the topics inside it: not studied on its own.
    const milestone = n.kind === 'milestone'
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={milestone ? 6 : 14} fill="var(--card)" stroke={milestone ? 'var(--nova)' : 'var(--map-topic)'} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        {n.subjectName && <rect x={x0 + 7} y={y0 + 11} width={3} height={h - 22} rx={1.5} fill="var(--sc)" />}
        {milestone && <path d={`M ${x0 + 18} ${-8} v 16 M ${x0 + 18} ${-8} h 9 l -2.5 3.5 l 2.5 3.5 h -9`} fill="none" stroke="var(--nova)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {detail >= 1 && <text x={x0 + (milestone ? 34 : 18)} y={detail === 2 ? -7 : 5} className={text} fontSize={13} fontWeight={600}>{short(n.label, milestone ? 18 : 20)}</text>}
        {detail === 2 && <text x={x0 + (milestone ? 34 : 18)} y={10} {...meta}>{milestone ? (n.details?.weeks ? `Milestone · ≈ ${n.details.weeks} wk` : 'Milestone') : 'Its topics are studied'}</text>}
      </>
    )
  }
  if (n.type === 'topic') {
    const unstudied = n.sessions === 0
    const barW = w - 36
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={14} fill="var(--card)" stroke={unstudied ? 'var(--map-topic)' : 'var(--border)'}
          strokeWidth={unstudied ? 1.4 : 1} strokeDasharray={unstudied ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
        {n.subjectName && <rect x={x0 + 7} y={y0 + 11} width={3} height={h - 22} rx={1.5} fill="var(--sc)" />}
        {detail >= 1 && <text x={x0 + 18} y={detail === 2 ? -7 : 5} className={text} fontSize={13} fontWeight={600}>{short(n.label, 20)}</text>}
        {detail === 2 && (
          <>
            <text x={x0 + 18} y={9} {...meta}>{n.level && n.masteryPercent !== null ? `${LEVEL_TEXT[n.level]} · ${n.masteryPercent}%` : 'No session yet'}</text>
            {(n.notes > 0 || n.resources > 0) && (
              <text x={-x0 - 12} y={9} textAnchor="end" {...meta}>{[n.notes > 0 && `${n.notes} ✎`, n.resources > 0 && `${n.resources} ↗`].filter(Boolean).join('  ')}</text>
            )}
            {n.masteryPercent !== null && (
              <>
                <rect x={x0 + 18} y={16} width={barW} height={3} rx={1.5} fill="var(--map-line)" />
                <rect x={x0 + 18} y={16} width={(barW * n.masteryPercent) / 100} height={3} rx={1.5} fill="var(--nova)" />
              </>
            )}
          </>
        )}
      </>
    )
  }
  const resource = n.type === 'resource'
  return (
    <>
      <rect x={x0} y={y0} width={w} height={h} rx={resource ? 6 : 11} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {n.subjectName && <rect x={x0 + 6} y={y0 + 10} width={3} height={h - 20} rx={1.5} fill="var(--sc)" />}
      {resource
        ? <rect x={x0 + 16} y={detail === 2 ? 5 : -3} width={7} height={7} rx={1.5} fill={FILL.resource} />
        : <circle cx={x0 + 19.5} cy={detail === 2 ? 8.5 : 0.5} r={3.5} fill={FILL.note} />}
      {detail >= 1 && <text x={x0 + (detail === 2 ? 16 : 29)} y={detail === 2 ? -5 : 4.5} className={text} fontSize={12.5} fontWeight={500}>{short(n.label, detail === 2 ? 22 : 20)}</text>}
      {detail === 2 && <text x={x0 + 29} y={12.5} {...meta}>{resource ? short(n.domain, 22) : `Edited ${shortDay(n.updatedAt)}`}</text>}
    </>
  )
}

// The learner's knowledge as a canvas they can move around in and arrange.
// Every card is a real item and every line a link that is stored; the server
// decides both. Moving a card changes only where it is drawn.
export function KnowledgeMap({ view, onChanged, onWorkspace }: { view: NovaKnowledgeMapReady; onChanged: () => void; onWorkspace?: (id: string) => void }) {
  const [shown, setShown]       = useState<Record<MapNodeType, boolean>>({ subject: true, topic: true, task: true, note: true, resource: true })
  // Branches folded away: what hangs from these cards is not drawn.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [subject, setSubject]   = useState('')
  // Show [[links]] between notes (the learner's own links), or hide them.
  const [showLinks, setShowLinks] = useState(true)
  // A scoped view: one item and what is within two links of it.
  const [scope, setScope]       = useState<string | null>(null)
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover]       = useState<string | null>(null)
  const [t, setT]               = useState<View>({ x: 0, y: 0, k: 1 })
  const [dragAt, setDragAt]     = useState<{ id: string; x: number; y: number } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [said, setSaid]         = useState('')
  const frame = useRef<HTMLDivElement>(null)
  const drag  = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const cardDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; at: { x: number; y: number } | null } | null>(null)
  const swallowClick = useRef(false)
  // Set by an explicit selection (a click, Enter or Space on a card, a search
  // result): the details are then brought into view on a narrow screen.
  const revealNext = useRef(false)
  const panel = useRef<HTMLElement>(null)
  const layout = useMapLayout()

  const subjects = useMemo(() => view.nodes.filter(n => n.type === 'subject'), [view.nodes])

  // What the filters leave. A filter hides items; it never changes a link.
  const usable = useMemo(() => view.edges.filter(e => showLinks || e.kind !== 'links_to'), [view.edges, showLinks])
  const inScope = useMemo(() => (scope && view.nodes.some(n => n.id === scope) ? around(scope, usable) : null), [scope, usable, view.nodes])
  // The whole tree on record, and what a folded branch hides.
  const tree = useMemo(() => treeOf(view.nodes, view.edges), [view.nodes, view.edges])
  const folded = useMemo(() => {
    const out = new Set<string>()
    const hide = (id: string) => { for (const c of tree.children.get(id) ?? []) if (!out.has(c)) { out.add(c); hide(c) } }
    for (const id of collapsed) hide(id)
    return out
  }, [tree, collapsed])
  const insideOf = useCallback((id: string) => {
    let n = 0
    const count = (at: string) => { for (const c of tree.children.get(at) ?? []) { n++; count(c) } }
    count(id)
    return n
  }, [tree])
  const toggleFold = useCallback((id: string) => setCollapsed(c => { const next = new Set(c); if (next.has(id)) next.delete(id); else next.add(id); return next }), [])
  const nodes = useMemo(() => view.nodes.filter(n =>
    shown[n.type] && !folded.has(n.id) && (subject === '' || n.subjectId === subject) && (!inScope || inScope.has(n.id))), [view.nodes, shown, folded, subject, inScope])
  const ids   = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])
  const edges = useMemo(() => usable.filter(e => ids.has(e.from) && ids.has(e.to)), [usable, ids])
  const linkCount = useMemo(() => view.edges.filter(e => e.kind === 'links_to').length, [view.edges])

  // Every item on the map now, whatever the filters show.
  const allIds = useMemo(() => new Set(view.nodes.map(n => n.id)), [view.nodes])

  // A link from elsewhere names an item (?focus=note:<id>): open the map on
  // it, scoped to what is around it. On the first view only: a reload (every
  // minute, and after an edit) keeps what the learner has done since.
  const focusApplied = useRef(false)
  useEffect(() => {
    const focus = focusToApply(new URLSearchParams(window.location.search).get('focus'), allIds, focusApplied.current)
    focusApplied.current = true
    if (focus) { setScope(focus); setSelected(focus) }
  }, [allIds])
  // After a reload, a selection, scope or hover on an item that has gone
  // (deleted elsewhere, archived) is dropped; one still there is kept.
  useEffect(() => {
    setSelected(id => keepValid(id, allIds))
    setScope(id => keepValid(id, allIds))
    setHover(id => keepValid(id, allIds))
  }, [allIds])
  // Places a saved page was suggested for and is not filed under. Drawn, never laid out.
  const suggestions = useMemo(() => (view.suggestions ?? []).filter(s => ids.has(s.from) && ids.has(s.to)), [view.suggestions, ids])
  // A [[link]] is drawn but does not place anything: an item sits by what it
  // is filed under, wherever notes link to it from.
  // Drawn for the frame's shape: a phone's tall frame stacks the subjects.
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => setPortrait(el.clientWidth < el.clientHeight * 0.9))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const auto = useMemo(() => layoutMap(nodes, edges.filter(e => e.kind !== 'links_to'), { portrait }), [nodes, edges, portrait])
  // The learner's own positions over the computed ones, and the card being dragged.
  const placed: MapLayout = useMemo(() => {
    const positions = dragAt ? new Map(layout.positions).set(dragAt.id, { x: dragAt.x, y: dragAt.y }) : layout.positions
    return withPositions(auto, nodes, positions)
  }, [auto, nodes, layout.positions, dragAt])
  const byId   = useMemo(() => new Map(view.nodes.map(n => [n.id, n])), [view.nodes])

  const neighbourIds = useMemo(() => {
    const focus = hover ?? selected
    if (!focus) return null
    const set = new Set<string>([focus])
    for (const e of view.edges) { if (e.from === focus) set.add(e.to); if (e.to === focus) set.add(e.from) }
    return set
  }, [hover, selected, view.edges])

  const fit = useCallback(() => {
    const el = frame.current
    if (!el) return
    const { minX, minY, maxX, maxY } = placed.bounds
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY)
    const k = Math.max(MIN_K, Math.min(1.1, Math.min(el.clientWidth / w, el.clientHeight / h)))
    setT({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k })
  }, [placed])

  // Fitted when the learner asks for a different picture or the saved layout
  // arrives or is reset (fitKey), not when the data reloads and not when a
  // card is moved: a reload keeps the pan and zoom they had.
  const fitNow = useRef(fit)
  useEffect(() => { fitNow.current = fit }, [fit])
  const fitWhen = fitKey({ shown, subject, scope, showLinks, portrait, generation: layout.generation }) + `|${view.workspaceId ?? 'all'}|${collapsed.size}`
  useEffect(() => { fitNow.current() }, [fitWhen])

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = frame.current
    if (!el) return
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2
    setT(v => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor))
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
    })
  }, [])

  // The wheel zooms where the pointer is. Registered by hand so it can stop
  // the page from scrolling under the map.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const select = useCallback((id: string | null) => {
    setSelected(id)
    const p = id ? placed.at.get(id) : null
    const el = frame.current
    // Bring a node picked from a list into view.
    if (p && el) setT(v => ({ ...v, x: el.clientWidth / 2 - p.x * v.k, y: el.clientHeight / 2 - p.y * v.k }))
  }, [placed])

  // Moving a card: the pointer past the threshold, or Alt and an arrow key.
  // The scale is read when the drag starts and kept for it.
  const scale = useRef(1)
  useEffect(() => { scale.current = t.k }, [t.k])
  const placedNow = useRef(placed)
  useEffect(() => { placedNow.current = placed }, [placed])
  const moveCard = layout.move

  const onCardPointerDown = useCallback((e: React.PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const p = placedNow.current.at.get(id)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    cardDrag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false, at: null }
  }, [])
  const onCardPointerMove = useCallback((e: React.PointerEvent<SVGGElement>) => {
    const d = cardDrag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    d.at = { x: clampCoord(d.ox + dx / scale.current), y: clampCoord(d.oy + dy / scale.current) }
    setDragAt({ id: d.id, ...d.at })
  }, [])
  const onCardPointerUp = useCallback((e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation()
    const d = cardDrag.current
    cardDrag.current = null
    if (d?.moved && d.at) {
      swallowClick.current = true
      moveCard(d.id, d.at.x, d.at.y)
    }
    setDragAt(null)
  }, [moveCard])
  const onCardPointerCancel = useCallback(() => { cardDrag.current = null; setDragAt(null) }, [])

  const picked = selected ? byId.get(selected) ?? null : null

  // After an explicit selection has rendered its details: on a narrow screen,
  // where they sit under the canvas, scroll them into view.
  useEffect(() => {
    const explicit = revealNext.current
    revealNext.current = false
    if (!explicit || !selected) return
    revealDetail(panel.current, window)
  }, [selected])
  const neighbours = useMemo(() => {
    if (!picked) return []
    const out: Array<{ node: MapNode; relation: string }> = []
    for (const e of view.edges) {
      const outgoing = e.from === picked.id, incoming = e.to === picked.id
      const node = outgoing ? byId.get(e.to) : incoming ? byId.get(e.from) : null
      if (node) out.push({ node, relation: RELATION[e.kind]![outgoing ? 0 : 1] })
    }
    return out
  }, [picked, view.edges, byId])

  // Found by its name, and by what it is filed under or comes from.
  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const about = (n: MapNode) => [n.label, 'subjectName' in n ? n.subjectName : null, 'topicName' in n ? n.topicName : null, n.type === 'resource' ? n.domain : null]
      .filter(Boolean).join('\n').toLowerCase()
    return nodes.filter(n => about(n).includes(q)).slice(0, 8)
  }, [query, nodes])

  // How much a card says at this zoom: far out, only the shapes and the
  // subjects' names (drawn at a readable size); then titles; then facts.
  const detail: CardDetail = t.k >= 0.62 ? 2 : t.k >= 0.36 ? 1 : 0
  const textScale = 1 / Math.max(t.k, 0.0001)
  const focusId = hover ?? selected

  // Lines between cards. Memoised apart from the pan, which only moves the
  // group they sit in.
  const edgeLayer = useMemo(() => edges.map(e => {
    const a = placed.at.get(e.from), b = placed.at.get(e.to)
    if (!a || !b) return null
    const lit = focusId !== null && (e.from === focusId || e.to === focusId)
    const dim = focusId !== null && !lit
    if (e.kind === 'depends_on') {
      // A wait: from the task that waits to the one it waits for, dashed in the tasks' colour.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
      return (
        <path key={e.id} d={`M ${a.x} ${a.y} Q ${mx + dy * 0.22} ${my - dx * 0.22} ${b.x} ${b.y}`} fill="none" data-edge={e.kind}
          stroke={lit ? 'var(--action)' : 'var(--map-task)'} strokeWidth={lit ? 2 : 1.4} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" opacity={dim ? 0.2 : 0.9} />
      )
    }
    if (e.kind === 'links_to') {
      // A [[link]] curves, so it reads apart from where things are filed.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
      return (
        <path key={e.id} d={`M ${a.x} ${a.y} Q ${mx - dy * 0.18} ${my + dx * 0.18} ${b.x} ${b.y}`} fill="none" data-edge={e.kind}
          stroke={lit ? 'var(--action)' : 'var(--nova)'} strokeWidth={lit ? 2 : 1.5} vectorEffect="non-scaling-stroke" opacity={dim ? 0.2 : 0.9} />
      )
    }
    return (
      <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={lit ? 'var(--action)' : 'var(--map-line)'}
        strokeWidth={lit ? 2.4 : e.kind === 'contains' ? 2.2 : e.kind === 'has_topic' || e.kind === 'subtopic' ? 1.6 : 1.1}
        strokeDasharray={e.kind === 'filed_under' ? '5 4' : undefined}
        vectorEffect="non-scaling-stroke" data-edge={e.kind}
        opacity={dim ? 0.25 : 1} />
    )
  }), [edges, placed, focusId])

  const suggestionLayer = useMemo(() => suggestions.map(s => {
    const a = placed.at.get(s.from), b = placed.at.get(s.to)
    if (!a || !b) return null
    const lit = focusId !== null && (s.from === focusId || s.to === focusId)
    return (
      <line key={s.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-suggestion={s.confidence}
        stroke={lit ? 'var(--action)' : 'var(--map-line)'}
        strokeWidth={1.2} strokeDasharray="1 6" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        opacity={focusId !== null && !lit ? 0.15 : 0.8} />
    )
  }), [suggestions, placed, focusId])

  // The cards. Memoised apart from the pan; the zoom only changes them when
  // it crosses into another level of detail.
  const nodeLayer = useMemo(() => nodes.map(n => {
    const p = placed.at.get(n.id)
    if (!p) return null
    const { w, h } = CARD[n.type]
    const dim = neighbourIds !== null && !neighbourIds.has(n.id)
    const on  = selected === n.id
    const dragging = dragAt?.id === n.id
    const tone = n.type === 'subject' ? n.label : n.subjectName
    return (
      <g
        key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.38 : 1}
        role="button" tabIndex={0} aria-label={`${TYPE_LABEL[n.type]}: ${n.label}`} aria-pressed={on}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        className={cn('subject-tone outline-none [&:focus-visible_.map-focus]:opacity-100', dragging ? 'cursor-grabbing' : 'cursor-pointer')}
        style={toneStyle(tone)} data-node={n.type}
        onPointerDown={e => onCardPointerDown(e, n.id)} onPointerMove={onCardPointerMove}
        onPointerUp={onCardPointerUp} onPointerCancel={onCardPointerCancel}
        onClick={() => {
          if (swallowClick.current) { swallowClick.current = false; return }
          revealNext.current = !on
          setSelected(on ? null : n.id)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); revealNext.current = !on; setSelected(on ? null : n.id); return }
          const by = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
          if (e.altKey && by) {
            e.preventDefault()
            const step = e.shiftKey ? NUDGE * 4 : NUDGE
            moveCard(n.id, clampCoord(p.x + by[0] * step), clampCoord(p.y + by[1] * step))
            setSaid(`Moved ${n.label}.`)
          }
        }}
        onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
      >
        {(on || dragging) && <rect x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="none" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        <rect className="map-focus opacity-0" x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="none" stroke="var(--ring)" strokeWidth={2.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
        <g style={dragging ? { filter: 'drop-shadow(0 10px 18px rgb(0 0 0 / 0.25))' } : undefined}><CardFace n={n} detail={detail} /></g>
        {(tree.children.get(n.id)?.length ?? 0) > 0 && detail >= 1 && (
          // Fold or show what hangs from it.
          <g transform={`translate(${w / 2} 0)`} role="button" tabIndex={-1} aria-label={collapsed.has(n.id) ? `Show what is inside ${n.label}` : `Fold what is inside ${n.label}`} data-fold={collapsed.has(n.id) ? 'folded' : 'open'}
            onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleFold(n.id) }} className="cursor-pointer">
            <circle r={9} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {collapsed.has(n.id)
              ? <text textAnchor="middle" y={3.5} fontSize={9.5} fontWeight={600} className="fill-foreground">{Math.min(99, insideOf(n.id))}</text>
              : <path d="M -4 0 h 8" stroke="var(--subtle)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />}
          </g>
        )}
      </g>
    )
  }), [nodes, placed, neighbourIds, selected, dragAt, detail, onCardPointerDown, onCardPointerMove, onCardPointerUp, onCardPointerCancel, moveCard, tree, collapsed, insideOf, toggleFold])

  // Far out, the subjects' names over their cards, at a size that can be read.
  const farLabels = detail === 0 ? nodes.filter(n => n.type === 'subject').map(n => {
    const p = placed.at.get(n.id)
    if (!p) return null
    const size = 13 * Math.min(textScale, 4)
    return (
      <text key={`far-${n.id}`} x={p.x} y={p.y - CARD.subject.h / 2 - size * 0.6} textAnchor="middle" fontSize={size}
        className="pointer-events-none fill-foreground" style={{ fontFamily: 'var(--font-display)', paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 4 * Math.min(textScale, 4), strokeLinejoin: 'round' }}>
        {short(n.label, 26)}
      </text>
    )
  }) : null

  const saver = layout.saver
  const hasLayout = layout.positions.size > 0 || saver.unsaved > 0
  const chip = (on: boolean) => cn(
    'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
    on ? 'border-white/16 bg-white/6 text-foreground' : 'border-white/8 text-subtle hover:text-foreground',
  )

  let layoutNote: ReactNode = null
  if (layout.load === 'failed') {
    layoutNote = (
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 bg-amber-400/8 px-3 py-2 text-xs text-foreground/80" data-layout-notice>
        <span>Your saved layout didn&apos;t load, so the map shows its own. Cards you move are still saved.</span>
        <button type="button" onClick={() => void layout.retryLoad()} className={cn(BUTTON_QUIET, 'h-7')}>Try again</button>
      </div>
    )
  } else if (saver.status === 'failed') {
    layoutNote = (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 bg-red-400/8 px-3 py-2 text-xs text-foreground/85" data-layout-error>
        <span>{saver.message ?? "Your layout didn't save."} {plural(saver.unsaved, 'card')} not saved yet; they stay where you put them.</span>
        <button type="button" onClick={layout.retrySave} className={cn(BUTTON_QUIET, 'h-7')}>Retry</button>
      </div>
    )
  } else if (layout.reset.error) {
    layoutNote = (
      <div role="alert" className="border-b border-white/8 bg-red-400/8 px-3 py-2 text-xs text-foreground/85">{layout.reset.error} Nothing was changed.</div>
    )
  }
  const saveText = saver.status === 'saving' ? 'Saving layout…' : saver.status === 'pending' ? 'Unsaved changes' : saver.status === 'failed' ? 'Layout not saved' : layout.positions.size > 0 ? 'Layout saved' : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-white/8 bg-card/60 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Filters. Each does what it says, and none changes what is stored. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/8 p-3">
          {(view.workspaces?.length ?? 0) > 0 && onWorkspace && (
            // One workspace's map at a time; everything together on request.
            <select value={view.workspaceId ?? 'all'} onChange={e => onWorkspace(e.target.value)} aria-label="Which workspace's map" data-workspace-switch
              className="h-8 max-w-[14rem] rounded-full border border-white/12 bg-background px-3 text-xs font-medium text-foreground outline-none focus-visible:border-ring">
              {view.workspaces!.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
              <option value="all">Everything you have</option>
            </select>
          )}
          {TYPES.map(({ type, plural: label }) => (
            <button key={type} type="button" aria-pressed={shown[type]} onClick={() => setShown(s => ({ ...s, [type]: !s[type] }))} className={chip(shown[type])}>
              <span className="inline-block size-2 rounded-full" style={{ background: FILL[type], opacity: shown[type] ? 1 : 0.35 }} />
              {label} <span className="tabular-nums text-subtle">{view.counts[type]}</span>
            </button>
          ))}
          {linkCount > 0 && (
            <button type="button" aria-pressed={showLinks} onClick={() => setShowLinks(v => !v)} className={chip(showLinks)}>
              Links between notes <span className="tabular-nums text-subtle">{linkCount}</span>
            </button>
          )}
          {subjects.length > 1 && (
            <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Show one subject"
              className="h-8 rounded-full border border-white/10 bg-background px-3 text-xs text-foreground outline-none focus-visible:border-ring">
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.subjectId ?? ''}>{s.label}</option>)}
            </select>
          )}
          <button type="button" onClick={() => setCollapsed(c => (c.size ? new Set() : new Set(view.nodes.filter(n => n.type !== 'subject' && (tree.children.get(n.id)?.length ?? 0) > 0).map(n => n.id))))} className={chip(collapsed.size > 0)} data-fold-all>
            {collapsed.size ? <ChevronsUpDown aria-hidden className="size-3.5" /> : <ChevronsDownUp aria-hidden className="size-3.5" />} {collapsed.size ? 'Show everything inside' : 'Fold topics and tasks'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span role="status" className={cn('text-xs tabular-nums', saver.status === 'failed' ? 'text-red-400' : 'text-subtle')} data-layout-status={saver.status}>
              {layout.load === 'loading' ? 'Loading layout…' : saveText}
            </span>
            <button type="button" onClick={() => setConfirmReset(true)} disabled={!hasLayout || confirmReset} className={cn(BUTTON_QUIET, 'h-8 rounded-full')} data-reset-layout>
              <RotateCcw aria-hidden className="size-3" /> Reset layout
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find on the map" aria-label="Find on the map"
              className="h-8 w-44 rounded-full border border-white/10 bg-background pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-subtle focus-visible:border-ring" />
            {query.trim() && found.length === 0 && (
              <p role="status" className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-white/10 bg-popover px-3 py-2 text-xs text-foreground/70 shadow-float">Nothing on the map matches. Hidden types and subjects are not searched.</p>
            )}
            {found.length > 0 && (
              <ul className="absolute right-0 top-10 z-20 w-64 overflow-hidden rounded-xl border border-white/10 bg-popover shadow-float">
                {found.map(n => (
                  <li key={n.id}>
                    <button type="button" onClick={() => { revealNext.current = true; select(n.id); setQuery('') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/85 hover:bg-white/6">
                      <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[n.type] }} />
                      <span className="truncate">{n.label}</span>
                      <span className="ml-auto shrink-0 text-subtle">{TYPE_LABEL[n.type]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {confirmReset && (
          <div role="group" aria-label="Reset layout" className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 bg-action-soft px-3 py-2 text-xs text-foreground/85">
            <span>Put every card back where Kivo places it? Your notes, pages and links stay as they are.</span>
            <span className="flex gap-2">
              <button type="button" disabled={layout.reset.busy} data-reset-confirm
                onClick={() => void layout.resetPositions().then(ok => { if (ok) { setConfirmReset(false); setSaid('Layout reset.') } })}
                className={cn(BUTTON_PRIMARY, 'h-7 px-3 text-xs')}>{layout.reset.busy ? 'Resetting…' : 'Reset layout'}</button>
              <button type="button" onClick={() => setConfirmReset(false)} disabled={layout.reset.busy} className={cn(BUTTON_QUIET, 'h-7')}>Cancel</button>
            </span>
          </div>
        )}
        {layoutNote}

        {inScope && scope && (
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3 py-2 text-xs text-foreground/70" role="status" data-map-scope>
            <span>Showing <span className="text-foreground">{byId.get(scope)?.label}</span>, everything inside it, what it sits inside, and what links to them.</span>
            <button type="button" onClick={() => setScope(null)} className={cn(BUTTON_QUIET, 'h-7 rounded-full')}>Show everything</button>
          </div>
        )}

        <div
          ref={frame}
          className="nova-canvas relative min-h-[24rem] flex-1 touch-none select-none overflow-hidden bg-background/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
          // The map can be moved without a pointer: arrow keys pan it, plus and
          // minus zoom, 0 fits it. Only while the map itself has focus, so the
          // keys keep their meaning on a node or in the search box.
          tabIndex={0} role="group" aria-label="Knowledge map. Arrow keys move the view, plus and minus zoom, zero fits it all. Tab reaches each item; on an item, Alt and the arrow keys move it."
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            const step = e.shiftKey ? PAN_STEP * 3 : PAN_STEP
            const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
            const by = move[e.key]
            if (by) { e.preventDefault(); setT(v => ({ ...v, x: v.x + by[0], y: v.y + by[1] })) }
            else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25) }
            else if (e.key === '-') { e.preventDefault(); zoomAt(0.8) }
            else if (e.key === '0') { e.preventDefault(); fit() }
          }}
          onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, moved: false } }}
          onPointerMove={e => {
            const d = drag.current
            if (!d) return
            const dx = e.clientX - d.x, dy = e.clientY - d.y
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
            d.x = e.clientX; d.y = e.clientY
            setT(v => ({ ...v, x: v.x + dx, y: v.y + dy }))
          }}
          // A press on the background that did not pan clears the selection.
          onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) setSelected(null) }}
          onPointerCancel={() => { drag.current = null }}
        >
          {nodes.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-foreground/65">Nothing matches these filters{inScope ? ' around this item' : ''}. Turn one back on{inScope ? ', or show everything,' : ''} to see the map.</p>
          ) : (
            // A group, not an image: it holds the items a keyboard reaches.
            <svg className="absolute inset-0 size-full" role="group" aria-label={`${nodes.length} items and ${edges.length} links`}>
              <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
                {placed.loose && (
                  <text x={placed.loose.x - CARD.note.w / 2} y={placed.loose.y - 44} className="fill-[var(--subtle)]" fontSize={12 * Math.min(textScale, 2.5)}>Not filed under a subject</text>
                )}
                {edgeLayer}
                {suggestionLayer}
                {nodeLayer}
                {farLabels}
              </g>
            </svg>
          )}

          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-card/90 shadow-soft backdrop-blur" onPointerDown={e => e.stopPropagation()}>
            <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" className="p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Plus className="size-4" /></button>
            <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Minus className="size-4" /></button>
            <button type="button" onClick={fit} aria-label="Fit the whole map" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Maximize2 className="size-4" /></button>
          </div>

          <p className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[60%] rounded-lg bg-background/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/70 backdrop-blur-sm sm:block">
            Drag a card to arrange it (Alt and the arrow keys move a focused card); drag the background to move around; scroll to zoom. Each branch reads top to bottom in its saved order; the round button on a card folds what is inside it. A dashed card is a topic with no session yet; a flag is a milestone; a dashed green curve is a task waiting on another; a teal curve is a [[link]] you wrote in a note.{suggestions.length > 0 && <> A dotted line is a suggestion Nova made, not a link: file the page to make it one.</>}
            {view.unconnected > 0 && <> {view.unconnected} {view.unconnected === 1 ? 'item is' : 'items are'} not connected to anything.</>}
            {(view.notShown.notes > 0 || view.notShown.resources > 0) && <> Older notes and pages beyond the newest 150 of each are not drawn.</>}
          </p>
          <p className="sr-only" role="status" aria-live="polite">{said}</p>
        </div>
      </div>

      {picked && (
        <Detail node={picked} neighbours={neighbours} onPick={select} onClose={() => setSelected(null)} onScope={() => setScope(picked.id)}
          scoped={scope === picked.id} view={view} onChanged={onChanged} panelRef={panel}
          inside={insideOf(picked.id)} collapsed={collapsed.has(picked.id)} onCollapse={() => toggleFold(picked.id)} />
      )}
    </div>
  )
}

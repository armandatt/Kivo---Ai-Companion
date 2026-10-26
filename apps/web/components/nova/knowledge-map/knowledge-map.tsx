'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useStartSession } from '../use-start-session'
import { ArrowUpRight, ChevronsDownUp, ChevronsUpDown, Focus, Info, Keyboard, Layers, Link2, Maximize2, Minus, PanelRightOpen, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, Unlink, Waypoints, X } from 'lucide-react'
import type { MapEdge, MapEdgeKind, MapNode, MapNodeType, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { MAP_LAYOUT_COORD_MAX } from '@repo/api/nova/product/map-layout.types'
import { treeOrder } from '@repo/api/nova/product/task-tree'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '../workspace/ui'
import { toneStyle } from '../subject-color'
import { CARD, TREE_EDGES, layoutMap, treeOf, withPositions, type MapLayout } from './layout'
import { useMapLayout } from './use-map-layout'
import { filingChoices, placementLabel, placementOf, planLink, samePlacement, type Placement } from './map-edit'
import { addNoteLink, fileItem, type EditOutcome } from './map-actions'
import { fitKey, focusToApply, keepValid } from './view-state'
import { START, back, canExplore, crossLinks, current, enter, insideOf, keepLevels, MARKER_R, pathTo, placeOutside, reach, up, type Level, type View } from './explore'
import { enterAction, enterTarget, isMacPlatform, isTypingTarget, navigate, shortcutFor } from './map-shortcuts'
import { OUTLINE_QUERY, browserStore, chooseOrientation, chosenOrientation, forgetViews, pictureKey, recallView, rememberView, type Orientation } from './view-memory'
import { NEW_SUBJECT } from './map-structure'
import { disconnectPlan } from './map-disconnect'
import { sendDisconnect } from './map-structure-api'
import { AddDialog, Breadcrumbs, DeleteDialog, Legend, ShortcutsHelp } from './map-panels'

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

// Removing one connection from the details panel: what it means first, then
// the one request. No card is deleted.
function Disconnect({ edge, view, onDone, onCancel }: { edge: MapEdge; view: NovaKnowledgeMapReady; onDone: (said: string, stale: boolean) => void; onCancel: () => void }) {
  const byId = useMemo(() => new Map(view.nodes.map(n => [n.id, n])), [view.nodes])
  const plan = disconnectPlan(edge, byId, { workspace: !!view.workspaceId })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    if (!plan.ok || busy) return
    setBusy(true); setError(null)
    const out = await sendDisconnect(plan.request, byId.get(edge.from)?.label ?? '')
    setBusy(false)
    if (out.ok) { onDone(out.said[0] ?? 'Connection removed. Nothing was deleted.', false); return }
    setError(out.message)
    if (out.stale) onDone(out.message, true)
  }
  return (
    <div role="group" aria-label="Remove this connection" className="mx-2 mb-2 rounded-xl border border-white/10 bg-white/3 p-3 text-xs leading-relaxed" data-disconnect
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onCancel() } }}>
      {plan.ok ? <>
        <p className="font-medium text-foreground">{plan.label}</p>
        <p className="mt-1 text-foreground/75">{plan.detail}</p>
      </> : <p className="text-foreground/80" data-disconnect-blocked>{plan.why}</p>}
      {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={cn(BUTTON_QUIET, 'h-7')} autoFocus={!plan.ok}>Cancel</button>
        {plan.ok && <button type="button" onClick={() => void go()} disabled={busy} className={cn(BUTTON_PRIMARY, 'h-7 px-3 text-xs')} autoFocus data-disconnect-confirm>{busy ? 'Removing…' : 'Remove connection'}</button>}
      </div>
    </div>
  )
}

function Detail({ node, neighbours, onPick, onClose, onScope, scoped, view, onChanged, inside, collapsed, onCollapse, onExplore, onAdd, onDelete, onDisconnected }: {
  node: MapNode; neighbours: Array<{ node: MapNode; relation: string; edge: MapEdge }>; onPick: (id: string) => void; onClose: () => void
  onDisconnected: (said: string, stale: boolean) => void
  onScope: (() => void) | null; scoped: boolean; view: NovaKnowledgeMapReady; onChanged: () => void
  // How many cards hang from it, and whether they are folded away.
  inside: number; collapsed: boolean; onCollapse: () => void
  // null: not offered for this card.
  onExplore: (() => void) | null; onAdd: (() => void) | null; onDelete: (() => void) | null
}) {
  const { start, starting, error: startError } = useStartSession()
  // The connection being removed, by edge id.
  const [removing, setRemoving] = useState<string | null>(null)
  const facts: Array<[string, string]> = []
  if (node.type === 'subject') {
    const parent = node.parentId ? view.nodes.find(n => n.id === `subject:${node.parentId}`) : undefined
    if (parent) facts.push(['Inside', parent.label])
    const inner = view.edges.filter(e => e.kind === 'contains' && e.from === node.id).length
    if (inner) facts.push(['Subjects inside', String(inner)])
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
  const action = cn(BUTTON_QUIET, 'h-9')

  return (
    <aside aria-label="Selected item" data-map-overlay data-detail
      className="subject-tone absolute inset-x-0 bottom-0 z-20 flex max-h-[58%] flex-col overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/10 bg-card/95 p-5 shadow-float backdrop-blur lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-3 lg:max-h-none lg:w-[22rem] lg:rounded-2xl lg:border"
      style={toneStyle(tone)} onPointerDown={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-subtle">
            <span className="inline-block size-2 rounded-full" style={{ background: FILL[node.type] }} />{TYPE_LABEL[node.type]}
            {tone && <><span aria-hidden>·</span><span className="truncate normal-case tracking-normal text-[var(--sc-ink)]">{tone}</span></>}
          </p>
          <h2 className="mt-2 break-words text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{node.label}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Hide details (the card stays selected)" title="Hide details" className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>
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
          <a href={node.url} target="_blank" rel="noopener noreferrer" className={action}>
            Visit page <ArrowUpRight className="size-3.5" />
          </a>
        )}
        {/* The ordinary start, on a topic studied on its own, under its own subject. */}
        {node.type === 'topic' && node.studied !== false && node.kind !== 'milestone' && (
          <button type="button" disabled={starting !== null} data-start-topic
            onClick={() => void start({ topicName: node.label, subjectName: node.subjectName, durationMinutes: MAP_SESSION_MINUTES }, node.id)}
            className={action}>
            {starting === node.id ? 'Starting…' : `Start a ${MAP_SESSION_MINUTES} min session`}
          </button>
        )}
        {noteHere && <Link href={noteHere} className={action} data-note-here>New note here</Link>}
      </div>
      {startError && <p role="alert" className="mt-3 text-sm text-red-400">{startError}</p>}

      <div className="mt-4 flex flex-wrap gap-2" data-node-actions>
        {onExplore && <button type="button" onClick={onExplore} className={action} data-explore title="Explore inside (Enter)"><Layers aria-hidden className="size-3.5" /> Explore inside</button>}
        {onScope && !scoped && <button type="button" onClick={onScope} className={action} data-scope-here><Focus aria-hidden className="size-3.5" /> Show what is around it</button>}
        {inside > 0 && <button type="button" onClick={onCollapse} className={action} data-collapse aria-pressed={collapsed} title="Space">{collapsed ? <ChevronsUpDown aria-hidden className="size-3.5" /> : <ChevronsDownUp aria-hidden className="size-3.5" />} {collapsed ? `Show the ${inside} inside` : `Fold the ${inside} inside`}</button>}
        {onAdd && <button type="button" onClick={onAdd} className={action} data-add-open title="N"><Plus aria-hidden className="size-3.5" /> Add…</button>}
        {onDelete && <button type="button" onClick={onDelete} className={cn(action, 'hover:text-red-400')} data-delete-open title="Delete"><Trash2 aria-hidden className="size-3.5" /> Delete…</button>}
      </div>

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
            {neighbours.map(({ node: n, relation, edge }) => (
              <li key={`${n.id}:${relation}`} className="group/row">
                <div className="flex items-center">
                <button type="button" onClick={() => onPick(n.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  <span className={cn('inline-block size-2 shrink-0', relation === RELATION.links_to![0] || relation === RELATION.links_to![1] ? 'rounded-full ring-1 ring-[var(--nova)]' : 'rounded-full')} style={{ background: FILL[n.type] }} />
                  <span className="min-w-0">
                    <span className="block truncate">{n.label}</span>
                    <span className="block text-[11px] text-subtle">{relation}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-subtle">{TYPE_LABEL[n.type]}</span>
                </button>
                <button type="button" onClick={() => setRemoving(r => (r === edge.id ? null : edge.id))} aria-expanded={removing === edge.id}
                  aria-label={`Remove the connection with ${n.label}`} title="Remove this connection (no card is deleted)" data-disconnect-open={n.label}
                  className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-medium text-foreground/70 transition-colors hover:border-white/20 hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-expanded:border-white/20 aria-expanded:text-foreground">
                  <Unlink aria-hidden className="size-3.5" /> Remove
                </button>
                </div>
                {removing === edge.id && <Disconnect edge={edge} view={view} onCancel={() => setRemoving(null)} onDone={(said, stale) => { setRemoving(null); onDisconnected(said, stale) }} />}
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
// decides both. Moving a card changes only where it is drawn. Adding or
// deleting a card goes through the route that owns it, and the map is read
// again from the server after.
type Panel =
  | { kind: 'add'; node: MapNode | null }
  | { kind: 'delete'; node: MapNode }
  | { kind: 'help' } | { kind: 'legend' } | { kind: 'filters' } | { kind: 'reset' }

const ADDABLE: ReadonlySet<MapNodeType> = new Set(['subject', 'topic', 'task'])
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const isMac = () => typeof navigator !== 'undefined' && isMacPlatform((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '')

// The point a [[link]]'s ring sits on: where the line, arriving from `from`,
// meets the edge of the card (or round marker) it links to.
function ringPoint(from: { x: number; y: number }, to: { x: number; y: number }, size: { w: number; h: number } | number) {
  const dx = from.x - to.x, dy = from.y - to.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const s = typeof size === 'number' ? size : Math.min(Math.abs(ux) > 1e-6 ? size.w / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? size.h / 2 / Math.abs(uy) : Infinity)
  return { x: to.x + ux * s, y: to.y + uy * s }
}

export function KnowledgeMap({ view, onChanged, onWorkspace }: { view: NovaKnowledgeMapReady; onChanged: () => void; onWorkspace?: (id: string) => void }) {
  const [shown, setShown]       = useState<Record<MapNodeType, boolean>>({ subject: true, topic: true, task: true, note: true, resource: true })
  // Branches folded away: what hangs from these cards is not drawn.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [subject, setSubject]   = useState('')
  // Show [[links]] between notes (the learner's own links), or hide them.
  const [showLinks, setShowLinks] = useState(true)
  // A scoped view: one item and what is around it (a ?focus= link, or a card with nothing inside).
  const [scope, setScope]       = useState<string | null>(null)
  // Where the learner is: the whole map, or a card explored, and the views below it.
  const [stack, setStack]       = useState<Level[]>(() => [...START])
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(true)
  const [hover, setHover]       = useState<string | null>(null)
  const [t, setT]               = useState<View>({ x: 0, y: 0, k: 1 })
  const [dragAt, setDragAt]     = useState<{ id: string; x: number; y: number } | null>(null)
  const [panel, setPanel]       = useState<Panel | null>(null)
  const [notice, setNotice]     = useState<{ text: string; n: number } | null>(null)
  const [mac, setMac]           = useState(false)
  const store = useMemo(() => browserStore(), [])
  // The orientation: the learner's choice, else the device's own (by width,
  // never by the frame's shape, so opening a panel never turns the map round).
  const [chosen, setChosen]     = useState<Orientation | null>(() => chosenOrientation(store))
  const [narrow, setNarrow]     = useState(() => typeof window !== 'undefined' && window.matchMedia(OUTLINE_QUERY).matches)
  const orientation: Orientation = chosen ?? (narrow ? 'outline' : 'tree')
  const portrait = orientation === 'outline'
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const drag  = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const pinch = useRef(new Map<number, { x: number; y: number }>())
  const cardDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; at: { x: number; y: number } | null } | null>(null)
  const swallowClick = useRef(false)
  // A card to select once the map has it (after an add, or a jump to a card outside).
  const pendingSelect = useRef<string | null>(null)
  // The card the learner chose last: selected (a click, a search result, an
  // arrow key) or reached with Tab. Set at once, so Enter right after an
  // arrow key acts on the new card, not the one focus has not left yet.
  const lastChosen = useRef<string | null>(null)
  const layout = useMapLayout()

  useEffect(() => { setMac(isMac()) }, [])
  useEffect(() => {
    const q = window.matchMedia(OUTLINE_QUERY)
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  const say = useCallback((text: string) => setNotice(n => ({ text, n: (n?.n ?? 0) + 1 })), [])
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(id)
  }, [notice])

  const subjects = useMemo(() => view.nodes.filter(n => n.type === 'subject'), [view.nodes])
  const byId     = useMemo(() => new Map(view.nodes.map(n => [n.id, n])), [view.nodes])
  const allIds   = useMemo(() => new Set(view.nodes.map(n => n.id)), [view.nodes])

  // What the filters leave. A filter hides items; it never changes a link.
  const usable = useMemo(() => view.edges.filter(e => showLinks || e.kind !== 'links_to'), [view.edges, showLinks])
  const inScope = useMemo(() => (scope && allIds.has(scope) ? around(scope, usable) : null), [scope, usable, allIds])
  // The whole tree on record, and what a folded branch hides.
  const tree = useMemo(() => treeOf(view.nodes, view.edges), [view.nodes, view.edges])
  const folded = useMemo(() => {
    const out = new Set<string>()
    const hide = (id: string) => { for (const c of tree.children.get(id) ?? []) if (!out.has(c)) { out.add(c); hide(c) } }
    for (const id of collapsed) hide(id)
    return out
  }, [tree, collapsed])
  const insideCount = useCallback((id: string) => insideOf(tree, id).size - 1, [tree])
  const toggleFold = useCallback((id: string) => setCollapsed(c => { const next = new Set(c); if (next.has(id)) next.delete(id); else next.add(id); return next }), [])
  // Every card the filters leave, explored or not: the layout is worked out
  // for these, so a card explored keeps the place it has on the whole map.
  const nodes = useMemo(() => view.nodes.filter(n =>
    shown[n.type] && !folded.has(n.id) && (subject === '' || n.subjectId === subject) && (!inScope || inScope.has(n.id))), [view.nodes, shown, folded, subject, inScope])
  const ids   = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])
  const edges = useMemo(() => usable.filter(e => ids.has(e.from) && ids.has(e.to)), [usable, ids])
  const linkCount = useMemo(() => view.edges.filter(e => e.kind === 'links_to').length, [view.edges])

  // The card explored, if any, and what of the map that shows.
  const level = current(stack)
  const focus = level.focus !== null && allIds.has(level.focus) ? level.focus : null
  const inside = useMemo(() => (focus ? insideOf(tree, focus) : null), [focus, tree])
  const drawn = useMemo(() => (inside ? nodes.filter(n => inside.has(n.id)) : nodes), [nodes, inside])
  const drawnIds = useMemo(() => new Set(drawn.map(n => n.id)), [drawn])
  const drawnEdges = useMemo(() => (inside ? edges.filter(e => drawnIds.has(e.from) && drawnIds.has(e.to)) : edges), [edges, inside, drawnIds])
  // Links from inside to cards outside, kept, to round markers beside the map.
  // Only to cards the filters leave (a folded one is unfolded when it is gone to).
  const cross = useMemo(() => (inside ? crossLinks(drawnIds, usable).filter(c => ids.has(c.outside) || (folded.has(c.outside) && shown[byId.get(c.outside)?.type ?? 'note'])) : []), [inside, drawnIds, usable, ids, folded, byId, shown])

  // A link from elsewhere names an item (?focus=note:<id>): open the map on
  // it, scoped to what is around it; ?explore=<id> opens inside a card. On
  // the first view only: a reload keeps what the learner has done since.
  const focusApplied = useRef(false)
  useEffect(() => {
    if (focusApplied.current) return
    const params = new URLSearchParams(window.location.search)
    const f = focusToApply(params.get('focus'), allIds, false)
    const ex = params.get('explore')
    focusApplied.current = true
    if (ex && allIds.has(ex) && canExplore(tree, ex)) setStack(s => enter(s, ex, null))
    if (f) { setScope(f); setSelected(f) }
  }, [allIds, tree])
  // The address says which card is explored, so a reload opens there again.
  useEffect(() => {
    if (!focusApplied.current) return
    const url = new URL(window.location.href)
    if (focus) url.searchParams.set('explore', focus); else url.searchParams.delete('explore')
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, '', url.toString())
  }, [focus])
  // After a reload, a selection, scope, hover or explored card that has gone
  // (deleted, archived) is dropped; one still there is kept.
  useEffect(() => {
    setSelected(id => keepValid(id, allIds))
    setScope(id => keepValid(id, allIds))
    setHover(id => keepValid(id, allIds))
    setStack(s => keepLevels(s, allIds, tree))
  }, [allIds, tree])
  // Places a saved page was suggested for and is not filed under. Drawn, never laid out.
  const suggestions = useMemo(() => (view.suggestions ?? []).filter(s => drawnIds.has(s.from) && drawnIds.has(s.to)), [view.suggestions, drawnIds])

  // A [[link]] or a wait is drawn but places nothing.
  const auto = useMemo(() => layoutMap(nodes, edges.filter(e => TREE_EDGES.has(e.kind)), { portrait }), [nodes, edges, portrait])
  // The learner's own positions over the computed ones, and the card being dragged.
  const placed: MapLayout = useMemo(() => {
    const positions = dragAt ? new Map(layout.positions).set(dragAt.id, { x: dragAt.x, y: dragAt.y }) : layout.positions
    return withPositions(auto, nodes, positions)
  }, [auto, nodes, layout.positions, dragAt])

  // The explored card's own box, and its markers to the right of it.
  const box = useMemo(() => {
    if (!inside) return placed.bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of drawn) {
      const p = placed.at.get(n.id); if (!p) continue
      const { w, h } = CARD[n.type]
      minX = Math.min(minX, p.x - w / 2); maxX = Math.max(maxX, p.x + w / 2); minY = Math.min(minY, p.y - h / 2); maxY = Math.max(maxY, p.y + h / 2)
    }
    return minX === Infinity ? placed.bounds : { minX: minX - 60, minY: minY - 60, maxX: maxX + 60, maxY: maxY + 90 }
  }, [inside, drawn, placed])
  const markers = useMemo(() => (inside ? placeOutside(cross, placed.at, box.maxX - 60) : new Map<string, { x: number; y: number }>()), [inside, cross, placed.at, box.maxX])
  const bounds = useMemo(() => {
    if (markers.size === 0) return box
    let { minY, maxX, maxY } = box
    for (const m of markers.values()) { maxX = Math.max(maxX, m.x + MARKER_R + 190); minY = Math.min(minY, m.y - MARKER_R - 30); maxY = Math.max(maxY, m.y + MARKER_R + 30) }
    return { minX: box.minX, minY, maxX, maxY }
  }, [box, markers])

  const neighbourIds = useMemo(() => {
    const f = hover ?? selected
    if (!f) return null
    const set = new Set<string>([f])
    for (const e of view.edges) { if (e.from === f) set.add(e.to); if (e.to === f) set.add(e.from) }
    return set
  }, [hover, selected, view.edges])

  // ── The view: pan and zoom ─────────────────────────────────────────────────
  const tNow = useRef(t)
  useEffect(() => { tNow.current = t }, [t])
  const anim = useRef<number | null>(null)
  const stopAnim = useCallback(() => { if (anim.current !== null) cancelAnimationFrame(anim.current); anim.current = null }, [])
  // Eased: the point at the centre of the screen glides, and the zoom changes
  // by the same proportion each frame, so going in reads as a zoom into it.
  const animateTo = useCallback((to: View, ms = 320) => {
    stopAnim()
    const el = frame.current
    if (!el || reducedMotion()) { setT(to); return }
    const from = tNow.current, cw = el.clientWidth / 2, ch = el.clientHeight / 2
    const a = { x: (cw - from.x) / from.k, y: (ch - from.y) / from.k }, b = { x: (cw - to.x) / to.k, y: (ch - to.y) / to.k }
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms), e = 1 - (1 - p) ** 3
      const k = from.k * (to.k / from.k) ** e
      const cx = a.x + (b.x - a.x) * e, cy = a.y + (b.y - a.y) * e
      setT(p === 1 ? to : { k, x: cw - cx * k, y: ch - cy * k })
      anim.current = p < 1 ? requestAnimationFrame(step) : null
    }
    anim.current = requestAnimationFrame(step)
  }, [stopAnim])

  // The details panel covers the right of a wide canvas: fit beside it.
  const besidePanel = useCallback((el: HTMLElement) => (selected && detailOpen && el.clientWidth >= 1024 ? 372 : 0), [selected, detailOpen])
  const fitTarget = useCallback((): View | null => {
    const el = frame.current
    if (!el) return null
    const { minX, minY, maxX, maxY } = bounds
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY)
    const room = el.clientWidth - besidePanel(el)
    // A phone's outline is read top down: fitted to the width, from its top,
    // never shrunk below reading size to show it all at once.
    // Rounded as a remembered view is, so a fitted view and the same view
    // brought back on the next visit are the same.
    const round = (v: View): View => ({ x: Math.round(v.x), y: Math.round(v.y), k: Math.round(v.k * 1000) / 1000 })
    if (portrait) {
      const k = Math.max(0.62, Math.min(1.1, el.clientWidth / w))
      return round({ k, x: w * k <= el.clientWidth ? el.clientWidth / 2 - ((minX + maxX) / 2) * k : 12 - minX * k, y: 16 - minY * k })
    }
    const k = Math.max(MIN_K, Math.min(1.1, Math.min(room / w, el.clientHeight / h)))
    return round({ k, x: room / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k })
  }, [bounds, portrait, besidePanel])
  const fit = useCallback((animated = true) => { const to = fitTarget(); if (to) { if (animated) animateTo(to); else { stopAnim(); setT(to) } } }, [fitTarget, animateTo, stopAnim])

  // What this view is, for remembering it: the workspace, the card explored,
  // and the cards drawn. A view comes back only for the same picture.
  const where = `${view.workspaceId ?? 'all'}/${focus ?? 'root'}`
  const picture = useMemo(() => pictureKey([...drawnIds, ...markers.keys()], orientation), [drawnIds, markers, orientation])
  useEffect(() => {
    if (anim.current !== null) return
    const id = window.setTimeout(() => rememberView(store, where, picture, t), 500)
    return () => window.clearTimeout(id)
  }, [t, store, where, picture])

  // The view is settled when the learner asks for a different picture (a
  // filter, a subject, a scope, the orientation, a card explored or left) or
  // the saved layout arrives or is reset: back to the view they left there,
  // else the one they had last time for the same picture, else fitted. New
  // data for the same picture, and a card moved or folded, keep the view.
  const settle = useRef<(animated: boolean) => void>(() => {})
  settle.current = (animated: boolean) => {
    const to = level.view ?? recallView(store, where, picture) ?? fitTarget()
    if (!to) return
    if (animated) animateTo(to); else { stopAnim(); setT(to) }
  }
  const settleWhen = fitKey({ shown, subject, scope, showLinks, portrait, generation: layout.generation }) + `|${view.workspaceId ?? 'all'}|${focus ?? ''}|${stack.length}`
  const lastFocus = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const moved = lastFocus.current !== undefined && lastFocus.current !== focus
    lastFocus.current = focus
    settle.current(moved)
  }, [settleWhen, focus])

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = frame.current
    if (!el) return
    stopAnim()
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2
    setT(v => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor))
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
    })
  }, [stopAnim])

  // The wheel zooms where the pointer is. Registered by hand so it can stop
  // the page from scrolling under the map; a panel over the map scrolls itself.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-map-overlay]')) return
      e.preventDefault()
      const b = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - b.left, e.clientY - b.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const centreOn = useCallback((id: string, k?: number) => {
    const p = placed.at.get(id) ?? markers.get(id)
    const el = frame.current
    if (!p || !el) return
    const kk = k ?? tNow.current.k
    animateTo({ k: kk, x: (el.clientWidth - besidePanel(el)) / 2 - p.x * kk, y: el.clientHeight / 2 - p.y * kk }, 260)
  }, [placed, markers, animateTo, besidePanel])
  // Keeps a card reached by the keyboard on screen, moving the view only when it is not.
  const keepInView = useCallback((id: string) => {
    const p = placed.at.get(id)
    const el = frame.current
    if (!p || !el) return
    const v = tNow.current, sx = v.x + p.x * v.k, sy = v.y + p.y * v.k, m = 80
    if (sx < m || sy < m || sx > el.clientWidth - m - besidePanel(el) || sy > el.clientHeight - m) centreOn(id)
  }, [placed, centreOn, besidePanel])

  // Shows the card's details, keeping it selected.
  const select = useCallback((id: string | null, opts: { centre?: boolean; focusCard?: boolean } = {}) => {
    setSelected(id)
    lastChosen.current = id
    if (!id) return
    setDetailOpen(true)
    if (opts.centre) centreOn(id)
    if (opts.focusCard) requestAnimationFrame(() => root.current?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }))
  }, [centreOn])

  // Unfolds what a card sits inside, so it can be drawn.
  const revealCard = useCallback((id: string) => {
    const up = new Set(pathTo(tree, id).slice(0, -1))
    setCollapsed(c => ([...c].some(x => up.has(x)) ? new Set([...c].filter(x => !up.has(x))) : c))
  }, [tree])

  // ── Exploring inside a card ────────────────────────────────────────────────
  const explore = useCallback((id: string) => {
    if (!canExplore(tree, id)) { say('Nothing is inside this card to explore.'); return }
    setCollapsed(c => (c.has(id) ? new Set([...c].filter(x => x !== id)) : c))
    setStack(s => enter(s, id, tNow.current))
    setSelected(id)
    lastChosen.current = id
    setScope(null)
  }, [tree, say])
  const goBack = useCallback(() => setStack(s => back(s)), [])
  const goUp = useCallback(() => {
    if (!focus) { say('You are on the whole map.'); return }
    const from = focus
    setStack(s => up(s, tree))
    setSelected(from)
  }, [focus, tree, say])
  // A breadcrumb: back to that view when it is open, else into that card.
  const goTo = useCallback((id: string | null) => {
    if (id === null) { setStack(s => [s[0]!]); return }
    const at = stack.findIndex(l => l.focus === id)
    if (at >= 0) setStack(s => s.slice(0, at + 1)); else explore(id)
  }, [stack, explore])
  // A round marker: to the card outside, in the deepest view that holds it.
  const goOutside = useCallback((id: string) => {
    revealCard(id)
    pendingSelect.current = id
    setStack(s => reach(s, tree, id))
  }, [tree, revealCard])
  // Once the map has a card it was asked to select, select it and bring it into view.
  useEffect(() => {
    const id = pendingSelect.current
    if (!id || !drawnIds.has(id) || !placed.at.has(id)) return
    pendingSelect.current = null
    select(id, { centre: true, focusCard: true })
  }, [drawnIds, placed, select])

  // ── Moving a card ──────────────────────────────────────────────────────────
  // The pointer past the threshold, or Alt and an arrow key. The scale is read
  // when the drag starts and kept for it.
  const placedNow = useRef(placed)
  useEffect(() => { placedNow.current = placed }, [placed])
  const moveCard = layout.move

  const onCardPointerDown = useCallback((e: React.PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    stopAnim()
    const p = placedNow.current.at.get(id)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    cardDrag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false, at: null }
  }, [stopAnim])
  const onCardPointerMove = useCallback((e: React.PointerEvent<SVGGElement>) => {
    const d = cardDrag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    d.at = { x: clampCoord(d.ox + dx / tNow.current.k), y: clampCoord(d.oy + dy / tNow.current.k) }
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

  const neighbours = useMemo(() => {
    if (!picked) return []
    const out: Array<{ node: MapNode; relation: string; edge: MapEdge }> = []
    for (const e of view.edges) {
      const outgoing = e.from === picked.id, incoming = e.to === picked.id
      const node = outgoing ? byId.get(e.to) : incoming ? byId.get(e.from) : null
      if (node) out.push({ node, relation: RELATION[e.kind]![outgoing ? 0 : 1], edge: e })
    }
    return out
  }, [picked, view.edges, byId])

  // Found by its name, and by what it is filed under or comes from, anywhere
  // the filters leave (a card outside an explored one is reached by going to it).
  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const about = (n: MapNode) => [n.label, 'subjectName' in n ? n.subjectName : null, 'topicName' in n ? n.topicName : null, n.type === 'resource' ? n.domain : null]
      .filter(Boolean).join('\n').toLowerCase()
    return nodes.filter(n => about(n).includes(q)).slice(0, 8)
  }, [query, nodes])
  const [foundAt, setFoundAt] = useState(0)
  useEffect(() => setFoundAt(0), [query])
  const pick = useCallback((id: string) => {
    setQuery('')
    pendingSelect.current = null
    if (drawnIds.has(id)) select(id, { centre: true, focusCard: true })
    else goOutside(id)
  }, [drawnIds, select, goOutside])

  // ── Adding and deleting ────────────────────────────────────────────────────
  const canDelete = (n: MapNode) => n.type === 'subject' || n.type === 'topic' || n.type === 'task'
  const openAdd = useCallback((n: MapNode | null) => setPanel({ kind: 'add', node: n }), [])
  const openDelete = useCallback((n: MapNode) => setPanel({ kind: 'delete', node: n }), [])
  const closePanel = useCallback(() => setPanel(null), [])
  const afterEdit = useCallback((said: string, select: string | null) => {
    setPanel(null)
    say(said)
    if (select) { pendingSelect.current = select; revealCard(select) }
    onChanged()
  }, [say, onChanged, revealCard])
  // A dialog sits by its card, kept inside the map; on a phone, along the bottom.
  const anchor = useCallback((id: string | null): React.CSSProperties => {
    const el = frame.current
    const W = el?.clientWidth ?? 0, H = el?.clientHeight ?? 0
    if (W < 640 || !id) return W < 640 ? { left: 12, right: 12, bottom: 12, width: 'auto' } : { right: 12, top: 12 }
    const p = placed.at.get(id), n = byId.get(id)
    if (!p || !n) return { right: 12, top: 12 }
    const sx = t.x + p.x * t.k, sy = t.y + (p.y + CARD[n.type].h / 2) * t.k
    return { left: Math.max(12, Math.min(sx - 170, W - 396)), top: Math.max(12, Math.min(sy + 10, H - 380)) }
  }, [placed, byId, t])

  // ── The keyboard ───────────────────────────────────────────────────────────
  // One handler for the whole map, so a key means the same thing on a card,
  // on the canvas or with nothing focused. See map-shortcuts.ts for the rules.
  const cardOf = (el: Element | null): string | null => el?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e: KeyboardEvent) => {
    const r = root.current
    if (!r || e.defaultPrevented || isTypingTarget(e.target)) return
    // A held key repeats; Enter acts once per press.
    if (e.repeat && e.key === 'Enter') { e.preventDefault(); return }
    const active = document.activeElement
    const onCanvas = !active || active === document.body || active === frame.current
    if (!onCanvas && !r.contains(active)) return
    const k = shortcutFor(e)
    if (!k) return
    const card = cardOf(active)
    // Enter, Space, the arrows and Delete keep their own meaning on a button or link.
    const ownKeys = !onCanvas && !card && active instanceof HTMLElement && active.matches('button, a[href], select, summary, [role="button"], [role="radio"], [role="checkbox"]')
    if (ownKeys && ['open', 'explore', 'fold', 'navigate', 'pan', 'delete', 'nudge', 'escape'].includes(k.action)) return
    // The card chosen last wins over a focus that has not caught up with it.
    const target = enterTarget({ chosen: lastChosen.current, focused: card, selected, onMap: allIds })
    const node = target ? byId.get(target) ?? null : null
    const act = () => e.preventDefault()
    switch (k.action) {
      case 'search': act(); search.current?.focus(); search.current?.select(); return
      case 'help': act(); setPanel(p => (p?.kind === 'help' ? null : { kind: 'help' })); return
      case 'escape':
        if (panel) { act(); setPanel(null); return }
        if (selected) { act(); setSelected(null); lastChosen.current = null; frame.current?.focus({ preventScroll: true }) }
        return
      case 'zoom_in': act(); zoomAt(1.25); return
      case 'zoom_out': act(); zoomAt(0.8); return
      case 'fit': act(); fit(); return
      case 'actual_size': {
        act()
        if (selected && placed.at.has(selected)) centreOn(selected, 1)
        else { const el = frame.current; if (el) zoomAt(1 / tNow.current.k) }
        say('Zoom 100%.')
        return
      }
      case 'up': act(); goUp(); return
      case 'pan': {
        act()
        const step = PAN_STEP * 3
        const by = { left: [step, 0], right: [-step, 0], up: [0, step], down: [0, -step] }[k.arrow]
        stopAnim(); setT(v => ({ ...v, x: v.x + by[0]!, y: v.y + by[1]! }))
        return
      }
      case 'navigate': {
        act()
        if (!target || !drawnIds.has(target)) {
          const by = { left: [PAN_STEP, 0], right: [-PAN_STEP, 0], up: [0, PAN_STEP], down: [0, -PAN_STEP] }[k.arrow]
          stopAnim(); setT(v => ({ ...v, x: v.x + by[0]!, y: v.y + by[1]! }))
          return
        }
        const order = [...drawnIds].filter(id => placed.at.has(id)).sort((a, b) => placed.at.get(a)!.y - placed.at.get(b)!.y || placed.at.get(a)!.x - placed.at.get(b)!.x)
        const roots = order.filter(id => { const p = tree.parent.get(id); return p === undefined || !drawnIds.has(p) })
        const res = navigate(target, k.arrow, { children: tree.children, parent: tree.parent, roots }, drawnIds, { outline: portrait, rows: order, folded: collapsed.has(target) })
        if (res.to !== null) { pendingSelect.current = null; select(res.to, { focusCard: true }); keepInView(res.to) } else say(res.why)
        return
      }
      case 'nudge': {
        if (!card) return
        act()
        const p = placed.at.get(card)
        if (!p) return
        const by = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[k.arrow]
        const step = k.far ? NUDGE * 4 : NUDGE
        moveCard(card, clampCoord(p.x + by[0]! * step), clampCoord(p.y + by[1]! * step))
        say(`Moved ${byId.get(card)?.label ?? 'the card'}.`)
        return
      }
      case 'open':
        if (!target) { if (onCanvas) { act(); say('Select a card first: Tab to one, or click it.') } return }
        act(); select(target)
        return
      case 'explore':
        if (!target) { if (onCanvas) { act(); say('Select a card first: find it with / or move to it with the arrow keys.') } return }
        act()
        switch (enterAction(target, { exploring: focus, explorable: id => canExplore(tree, id) })) {
          case 'already': say(`You are exploring ${byId.get(target)?.label ?? 'this card'}. U goes up a level.`); return
          // Nothing inside: no empty map. Its details instead, and why.
          case 'details': select(target); say(`Nothing is inside ${byId.get(target)?.label ?? 'this card'} to explore; its details are open.`); return
          default: explore(target); return
        }
      case 'fold':
        if (!target) return
        act()
        if (!tree.children.get(target)?.length) { say('Nothing is inside this card to fold.'); return }
        toggleFold(target)
        say(collapsed.has(target) ? 'Showing what is inside.' : 'Folded.')
        return
      case 'add':
        act()
        if (!node) { say(view.workspaceId ? 'Select a subject, topic or task to add to.' : 'Select a subject, topic or task to add to, or use New subject.'); return }
        if (!ADDABLE.has(node.type)) { say(`A ${TYPE_LABEL[node.type].toLowerCase()} has nothing added inside it. Select a subject, topic or task.`); return }
        openAdd(node)
        return
      case 'delete':
        act()
        if (!node) { say('Select a card to delete.'); return }
        openDelete(node)
        return
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── What is drawn ──────────────────────────────────────────────────────────
  // How much a card says at this zoom: far out, only the shapes and the
  // subjects' names (drawn at a readable size); then titles; then facts.
  const detail: CardDetail = t.k >= 0.62 ? 2 : t.k >= 0.36 ? 1 : 0
  const textScale = 1 / Math.max(t.k, 0.0001)
  const focusId = hover ?? selected
  // A card outside an explored one is drawn at its marker, not where it sits on the whole map.
  const pointOf = useCallback((id: string) => markers.get(id) ?? placed.at.get(id), [placed, markers])

  // Lines between cards, and the cross-links to markers. Memoised apart from
  // the pan, which only moves the group they sit in.
  const allLines = useMemo(() => [...drawnEdges, ...cross.map(c => c.edge)], [drawnEdges, cross])
  const edgeLayer = useMemo(() => allLines.map(e => {
    const a = pointOf(e.from), b = pointOf(e.to)
    if (!a || !b) return null
    const lit = focusId !== null && (e.from === focusId || e.to === focusId)
    const dim = focusId !== null && !lit
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
    if (e.kind === 'depends_on') {
      // A wait: from the task that waits to the one it waits for, dashed in the tasks' colour.
      return (
        <path key={e.id} d={`M ${a.x} ${a.y} Q ${mx + dy * 0.22} ${my - dx * 0.22} ${b.x} ${b.y}`} fill="none" data-edge={e.kind}
          stroke={lit ? 'var(--action)' : 'var(--map-task)'} strokeWidth={lit ? 1.8 : 1.2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" opacity={dim ? 0.2 : 0.8} />
      )
    }
    if (e.kind === 'links_to') {
      // A [[link]]: a quiet curve; the ring where it arrives says what it is.
      return (
        <path key={e.id} d={`M ${a.x} ${a.y} Q ${mx - dy * 0.18} ${my + dx * 0.18} ${b.x} ${b.y}`} fill="none" data-edge={e.kind}
          stroke={lit ? 'var(--action)' : 'var(--map-line-strong)'} strokeWidth={lit ? 1.6 : 1.1} vectorEffect="non-scaling-stroke" opacity={dim ? 0.25 : 1} />
      )
    }
    // Into a wrapped column: along the gaps, never across the cards before it.
    const lane = placed.lanes?.get(e.to)
    if (lane && lane.x === b.x && lane.y === b.y && !markers.has(e.to)) {
      return (
        <path key={e.id} d={`M ${a.x} ${a.y} H ${lane.trunkX} V ${lane.laneY} H ${b.x} V ${b.y}`} fill="none" data-edge={e.kind} data-lane
          stroke={lit ? 'var(--action)' : 'var(--map-line)'} strokeWidth={lit ? 2.2 : 1.3} strokeLinejoin="round"
          vectorEffect="non-scaling-stroke" opacity={dim ? 0.25 : 1} />
      )
    }
    return (
      <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={lit ? 'var(--action)' : 'var(--map-line)'}
        strokeWidth={lit ? 2.2 : e.kind === 'contains' ? 2 : e.kind === 'has_topic' || e.kind === 'subtopic' ? 1.5 : 1.1}
        strokeDasharray={e.kind === 'filed_under' ? '5 4' : undefined}
        vectorEffect="non-scaling-stroke" data-edge={e.kind}
        opacity={dim ? 0.25 : 1} />
    )
  }), [allLines, pointOf, focusId, placed.lanes, markers])

  // The rings of [[links]], over the cards: one where each link arrives.
  const ringLayer = useMemo(() => allLines.filter(e => e.kind === 'links_to').map(e => {
    const a = pointOf(e.from), b = pointOf(e.to)
    const to = byId.get(e.to), from = byId.get(e.from)
    if (!a || !b || !to || !from) return null
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
    const ctrl = { x: mx - dy * 0.18, y: my + dx * 0.18 }
    const at = ringPoint(ctrl, b, markers.has(e.to) ? MARKER_R : CARD[to.type])
    const lit = focusId !== null && (e.from === focusId || e.to === focusId)
    return (
      <circle key={`ring-${e.id}`} cx={at.x} cy={at.y} r={4.5} fill="var(--card)" stroke={lit ? 'var(--action)' : 'var(--nova)'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" data-backlink={e.id}
        opacity={focusId !== null && !lit ? 0.35 : 1}>
        <title>{`“${from.label}” links to “${to.label}” with [[${to.label}]]`}</title>
      </circle>
    )
  }), [allLines, pointOf, byId, markers, focusId])

  const suggestionLayer = useMemo(() => suggestions.map(s => {
    const a = placed.at.get(s.from), b = placed.at.get(s.to)
    if (!a || !b) return null
    const lit = focusId !== null && (s.from === focusId || s.to === focusId)
    return (
      <line key={s.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-suggestion={s.confidence}
        stroke={lit ? 'var(--action)' : 'var(--map-line-strong)'}
        strokeWidth={1.2} strokeDasharray="1 6" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        opacity={focusId !== null && !lit ? 0.15 : 0.8} />
    )
  }), [suggestions, placed, focusId])

  // The cards. Memoised apart from the pan; the zoom only changes them when
  // it crosses into another level of detail.
  const nodeLayer = useMemo(() => drawn.map(n => {
    const p = placed.at.get(n.id)
    if (!p) return null
    const { w, h } = CARD[n.type]
    const dim = neighbourIds !== null && !neighbourIds.has(n.id)
    const on  = selected === n.id
    const dragging = dragAt?.id === n.id
    const tone = n.type === 'subject' ? n.label : n.subjectName
    const kids = tree.children.get(n.id)?.length ?? 0
    return (
      <g
        key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.38 : 1}
        role="button" tabIndex={0} aria-label={`${TYPE_LABEL[n.type]}: ${n.label}${kids ? `, ${kids} inside` : ''}`} aria-pressed={on}
        aria-keyshortcuts="Enter Shift+Enter Space N Delete Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        className={cn('subject-tone group/card outline-none [&:focus-visible_.map-focus]:opacity-100', dragging ? 'cursor-grabbing' : 'cursor-pointer')}
        style={toneStyle(tone)} data-node={n.type} data-node-id={n.id}
        onPointerDown={e => onCardPointerDown(e, n.id)} onPointerMove={onCardPointerMove}
        onPointerUp={onCardPointerUp} onPointerCancel={onCardPointerCancel}
        onClick={() => {
          if (swallowClick.current) { swallowClick.current = false; return }
          pendingSelect.current = null
          lastChosen.current = n.id
          if (on) { setDetailOpen(o => !o); return }
          select(n.id)
        }}
        onDoubleClick={() => { if (kids) explore(n.id) }}
        onFocus={() => { lastChosen.current = n.id }}
        onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
      >
        {(on || dragging) && <rect x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="color-mix(in oklch, var(--action) 9%, transparent)" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        <rect className="map-focus opacity-0" x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="none" stroke="var(--ring)" strokeWidth={2.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
        <g style={dragging ? { filter: 'drop-shadow(0 10px 18px rgb(0 0 0 / 0.25))' } : undefined}><CardFace n={n} detail={detail} /></g>
        {kids > 0 && detail >= 1 && (
          // Fold or show what hangs from it.
          <g transform={`translate(${w / 2} 0)`} role="button" tabIndex={-1} aria-label={collapsed.has(n.id) ? `Show what is inside ${n.label}` : `Fold what is inside ${n.label}`} data-fold={collapsed.has(n.id) ? 'folded' : 'open'}
            onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleFold(n.id) }} className="cursor-pointer">
            <circle r={9} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {collapsed.has(n.id)
              ? <text textAnchor="middle" y={3.5} fontSize={9.5} fontWeight={600} className="fill-foreground">{Math.min(99, insideCount(n.id))}</text>
              : <path d="M -4 0 h 8" stroke="var(--subtle)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />}
          </g>
        )}
        {ADDABLE.has(n.type) && detail >= 1 && (
          // Add a card inside or beside it. Shown on hover, focus and selection.
          <g transform={`translate(${w / 2 - 14} ${-h / 2})`} role="button" tabIndex={-1} aria-label={`Add to ${n.label}`} data-add={n.id}
            className={cn('map-add cursor-pointer transition-opacity', on ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100 group-focus-visible/card:opacity-100')}
            onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setSelected(n.id); openAdd(n) }}>
            <title>{`Add to ${n.label} (N)`}</title>
            <circle r={9} fill="var(--action)" />
            <path d="M -4 0 h 8 M 0 -4 v 8" stroke="var(--action-foreground)" strokeWidth={1.8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </g>
    )
  }), [drawn, placed, neighbourIds, selected, dragAt, detail, onCardPointerDown, onCardPointerMove, onCardPointerUp, onCardPointerCancel, tree, collapsed, insideCount, toggleFold, select, explore, openAdd])

  // Round markers for the cards outside an explored one, joined by a link.
  const markerLayer = useMemo(() => [...markers.entries()].map(([id, m]) => {
    const n = byId.get(id)
    if (!n) return null
    const lit = focusId === id
    return (
      <g key={`out-${id}`} transform={`translate(${m.x} ${m.y})`} role="button" tabIndex={0} data-outside={id} data-node-id={id}
        aria-label={`Outside this map: ${TYPE_LABEL[n.type]} ${n.label}. Go to it.`} className="group/out cursor-pointer outline-none [&:focus-visible_.map-focus]:opacity-100"
        onPointerDown={e => e.stopPropagation()} onClick={() => goOutside(id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); goOutside(id) } }}
        onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)}>
        <title>{`${n.label}: outside this map. Go to it.`}</title>
        <circle className="map-focus opacity-0" r={MARKER_R + 5} fill="none" stroke="var(--ring)" strokeWidth={2.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
        <circle r={MARKER_R} fill="var(--card)" stroke={lit ? 'var(--action)' : 'var(--map-line-strong)'} strokeWidth={1.4} strokeDasharray="3 2.5" vectorEffect="non-scaling-stroke" />
        <circle r={5} fill={FILL[n.type]} />
        {detail >= 1 && (
          <>
            <text x={MARKER_R + 9} y={detail === 2 ? -2 : 4} fontSize={12.5} fontWeight={500} className="fill-foreground">{short(n.label, 24)}</text>
            {detail === 2 && <text x={MARKER_R + 9} y={13} fontSize={10.5} className="fill-[var(--subtle)]">{TYPE_LABEL[n.type]} · outside</text>}
          </>
        )}
      </g>
    )
  }), [markers, byId, focusId, detail, goOutside])

  // Far out, the subjects' names over their cards, at a size that can be read.
  const farLabels = detail === 0 ? drawn.filter(n => n.type === 'subject').map(n => {
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

  // ── Around the canvas ──────────────────────────────────────────────────────
  const saver = layout.saver
  const hasLayout = layout.positions.size > 0 || saver.unsaved > 0
  const chip = (on: boolean) => cn(
    'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
    on ? 'border-white/16 bg-white/6 text-foreground' : 'border-white/8 text-subtle hover:text-foreground',
  )
  const tool = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs font-medium text-foreground/75 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40'
  const hidden = TYPES.filter(x => !shown[x.type]).length + (subject ? 1 : 0) + (showLinks ? 0 : 1) + (collapsed.size ? 1 : 0)

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

  // Reset: Kivo's own layout and orientation, fitted. Saved card positions
  // are removed only after the learner confirms it.
  const resetView = () => { forgetViews(store); chooseOrientation(store, null); setChosen(null); requestAnimationFrame(() => fit()) }
  const askReset = () => { if (hasLayout) setPanel({ kind: 'reset' }); else { resetView(); say('The map is in its own layout. View reset.') } }

  const trail = [{ id: null as string | null, label: view.workspaces?.find(w => w.id === view.workspaceId)?.title ?? 'Everything' },
    ...(focus ? pathTo(tree, focus).map(id => ({ id, label: byId.get(id)?.label ?? '' })) : [])]

  return (
    <div ref={root} className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-card/60" data-knowledge-map>
      {/* The toolbar: where you are, finding, and the view. Filters are folded into one menu. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-3 py-2">
        {(view.workspaces?.length ?? 0) > 0 && onWorkspace && (
          // One workspace's map at a time; everything together on request.
          <select value={view.workspaceId ?? 'all'} onChange={e => onWorkspace(e.target.value)} aria-label="Which workspace's map" data-workspace-switch
            className="h-8 max-w-[11rem] rounded-full border border-white/12 bg-background px-3 text-xs font-medium text-foreground outline-none focus-visible:border-ring sm:max-w-[14rem]">
            {view.workspaces!.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            <option value="all">Everything you have</option>
          </select>
        )}
        <Breadcrumbs trail={trail} canBack={stack.length > 1} onBack={goBack} onUp={goUp} onGo={goTo} />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 max-sm:w-full">
          <div className="relative order-last w-full sm:order-none sm:w-44 xl:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find on the map" aria-label="Find on the map"
              role="combobox" aria-expanded={found.length > 0} aria-controls="map-found" aria-activedescendant={found[foundAt] ? `map-found-${foundAt}` : undefined}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setQuery(''); frame.current?.focus({ preventScroll: true }) }
                else if (e.key === 'ArrowDown' && found.length) { e.preventDefault(); setFoundAt(i => (i + 1) % found.length) }
                else if (e.key === 'ArrowUp' && found.length) { e.preventDefault(); setFoundAt(i => (i - 1 + found.length) % found.length) }
                else if (e.key === 'Enter' && found[foundAt]) { e.preventDefault(); pick(found[foundAt]!.id) }
              }}
              className="h-8 w-full rounded-full border border-white/10 bg-background pl-8 pr-12 text-xs text-foreground outline-none placeholder:text-subtle focus-visible:border-ring" />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 px-1 font-sans text-[10px] text-subtle sm:block">{mac ? '⌘K' : '/'}</kbd>
            {query.trim() && found.length === 0 && (
              <p role="status" className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-white/10 bg-popover px-3 py-2 text-xs text-foreground/70 shadow-float">Nothing on the map matches. Hidden types and subjects are not searched.</p>
            )}
            {found.length > 0 && (
              <ul id="map-found" role="listbox" data-map-overlay className="absolute right-0 top-10 z-30 w-full min-w-64 overflow-hidden rounded-xl border border-white/10 bg-popover shadow-float">
                {found.map((n, i) => (
                  <li key={n.id} id={`map-found-${i}`} role="option" aria-selected={i === foundAt}>
                    <button type="button" tabIndex={-1} onClick={() => pick(n.id)} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/85 hover:bg-white/6', i === foundAt && 'bg-white/6')}>
                      <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[n.type] }} />
                      <span className="truncate">{n.label}</span>
                      <span className="ml-auto shrink-0 text-subtle">{inside && !drawnIds.has(n.id) ? 'Outside' : TYPE_LABEL[n.type]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <span role="status" className={cn('hidden text-xs tabular-nums xl:inline', saver.status === 'failed' ? 'text-red-400' : 'text-subtle')} data-layout-status={saver.status}>
            {layout.load === 'loading' ? 'Loading layout…' : saveText}
          </span>
          <div className="relative">
            <button type="button" onClick={() => setPanel(p => (p?.kind === 'filters' ? null : { kind: 'filters' }))} aria-expanded={panel?.kind === 'filters'} className={tool} data-filters-open>
              <SlidersHorizontal aria-hidden className="size-3.5" /> <span className="hidden sm:inline">Show</span>{hidden > 0 && <span className="rounded-full bg-action-soft px-1.5 text-[10px] tabular-nums text-foreground">{hidden}</span>}
            </button>
            {panel?.kind === 'filters' && (
              <div data-map-overlay className="absolute right-0 top-10 z-30 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-2xl border border-white/10 bg-popover p-3 shadow-float" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setPanel(null) } }}>
                <div className="flex flex-wrap gap-1.5">
                  {TYPES.map(({ type, plural: label }) => (
                    <button key={type} type="button" aria-pressed={shown[type]} onClick={() => setShown(s => ({ ...s, [type]: !s[type] }))} className={chip(shown[type])}>
                      <span className="inline-block size-2 rounded-full" style={{ background: FILL[type], opacity: shown[type] ? 1 : 0.35 }} />
                      {label} <span className="tabular-nums text-subtle">{view.counts[type]}</span>
                    </button>
                  ))}
                  {linkCount > 0 && (
                    <button type="button" aria-pressed={showLinks} onClick={() => setShowLinks(v => !v)} className={chip(showLinks)}>
                      <span aria-hidden className="inline-block size-2.5 rounded-full border-[1.5px] border-[var(--nova)]" /> Links between notes <span className="tabular-nums text-subtle">{linkCount}</span>
                    </button>
                  )}
                </div>
                {subjects.length > 1 && (
                  <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Show one subject"
                    className="h-8 w-full rounded-full border border-white/10 bg-background px-3 text-xs text-foreground outline-none focus-visible:border-ring">
                    <option value="">All subjects</option>
                    {subjects.map(s => <option key={s.id} value={s.subjectId ?? ''}>{s.label}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => setCollapsed(c => (c.size ? new Set() : new Set(view.nodes.filter(n => n.type !== 'subject' && (tree.children.get(n.id)?.length ?? 0) > 0).map(n => n.id))))} className={chip(collapsed.size > 0)} data-fold-all>
                  {collapsed.size ? <ChevronsUpDown aria-hidden className="size-3.5" /> : <ChevronsDownUp aria-hidden className="size-3.5" />} {collapsed.size ? 'Show everything inside' : 'Fold topics and tasks'}
                </button>
                <div className="flex items-center justify-between gap-2 border-t border-white/8 pt-3">
                  <span className="text-xs text-subtle">Read the map</span>
                  <div role="radiogroup" aria-label="Orientation" className="inline-flex rounded-full border border-white/10 p-0.5">
                    {(['tree', 'outline'] as const).map(o => (
                      <button key={o} type="button" role="radio" aria-checked={orientation === o} data-orientation={o}
                        onClick={() => { setChosen(o); chooseOrientation(store, o) }}
                        className={cn('rounded-full px-2.5 py-1 text-xs font-medium', orientation === o ? 'bg-white/8 text-foreground' : 'text-subtle hover:text-foreground')}>
                        {o === 'tree' ? 'Left to right' : 'Top to bottom'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          {!view.workspaceId && (
            <button type="button" onClick={() => openAdd(null)} className={tool} data-new-subject title="A subject of its own">
              <Plus aria-hidden className="size-3.5" /> <span className="hidden sm:inline">New subject</span>
            </button>
          )}
          <button type="button" onClick={askReset} className={tool} data-reset-layout title="Kivo's own layout, fitted to the screen">
            <RotateCcw aria-hidden className="size-3" /> <span className="hidden md:inline">Reset layout</span>
          </button>
          <button type="button" onClick={() => setPanel(p => (p?.kind === 'help' ? null : { kind: 'help' }))} className={cn(tool, 'px-2.5')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" data-shortcuts-open>
            <Keyboard aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {layoutNote}

      {inScope && scope && (
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3 py-2 text-xs text-foreground/70" role="status" data-map-scope>
          <span>Showing <span className="text-foreground">{byId.get(scope)?.label}</span>, what it sits inside, and what links to it.</span>
          <button type="button" onClick={() => setScope(null)} className={cn(BUTTON_QUIET, 'h-7 rounded-full')}>Show everything</button>
        </div>
      )}

      <div
        ref={frame}
        className="nova-canvas relative min-h-[20rem] flex-1 touch-none select-none overflow-hidden bg-background/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        tabIndex={0} role="group" aria-roledescription="map"
        aria-label={`Knowledge map${focus ? `, exploring ${byId.get(focus)?.label ?? ''}` : ''}. Arrow keys move the view or, with a card selected, between cards; plus and minus zoom; F fits; question mark lists every shortcut.`}
        onPointerDown={e => {
          stopAnim()
          const el = e.currentTarget as HTMLElement
          el.setPointerCapture(e.pointerId)
          pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          drag.current = pinch.current.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null
        }}
        onPointerMove={e => {
          const pts = pinch.current
          if (pts.size === 2 && pts.has(e.pointerId)) {
            // Two fingers: zoom about the point between them.
            const [a, b] = [...pts.values()]
            const before = Math.hypot(a!.x - b!.x, a!.y - b!.y)
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
            const [c, d] = [...pts.values()]
            const after = Math.hypot(c!.x - d!.x, c!.y - d!.y)
            const box2 = e.currentTarget.getBoundingClientRect()
            if (before > 0) zoomAt(after / before, (c!.x + d!.x) / 2 - box2.left, (c!.y + d!.y) / 2 - box2.top)
            return
          }
          const dd = drag.current
          if (!dd) return
          const dx = e.clientX - dd.x, dy = e.clientY - dd.y
          if (Math.abs(dx) + Math.abs(dy) > 3) dd.moved = true
          dd.x = e.clientX; dd.y = e.clientY
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
          setT(v => ({ ...v, x: v.x + dx, y: v.y + dy }))
        }}
        // A press on the background that did not pan clears the selection.
        onPointerUp={e => { pinch.current.delete(e.pointerId); const dd = drag.current; drag.current = null; if (dd && !dd.moved && pinch.current.size === 0) { setSelected(null); lastChosen.current = null; setPanel(p => (p?.kind === 'filters' || p?.kind === 'legend' ? null : p)) } }}
        onPointerCancel={e => { pinch.current.delete(e.pointerId); drag.current = null }}
      >
        {drawn.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-foreground/65">Nothing matches these filters{inScope ? ' around this item' : ''}. Turn one back on{inScope ? ', or show everything,' : ''} to see the map.</p>
        ) : (
          // A group, not an image: it holds the items a keyboard reaches.
          <svg className="absolute inset-0 size-full" role="group" aria-label={`${drawn.length} items and ${drawnEdges.length} links${markers.size ? `, ${markers.size} outside` : ''}`}>
            <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
              <g key={focus ?? 'root'} className="map-enter">
                {!inside && placed.loose && (
                  <text x={placed.loose.x - CARD.note.w / 2} y={placed.loose.y - 44} className="fill-[var(--subtle)]" fontSize={12 * Math.min(textScale, 2.5)}>Not filed under a subject</text>
                )}
                {edgeLayer}
                {suggestionLayer}
                {nodeLayer}
                {markerLayer}
                {ringLayer}
                {farLabels}
              </g>
            </g>
          </svg>
        )}

        {/* What the selected card can do, beside it. */}
        {picked && drawnIds.has(picked.id) && !dragAt && !panel && (() => {
          const p = placed.at.get(picked.id)
          const el = frame.current
          if (!p || !el) return null
          const { h } = CARD[picked.type]
          const sx = t.x + p.x * t.k, sy = t.y + (p.y - h / 2) * t.k
          if (sx < 0 || sy < 44 || sx > el.clientWidth || sy > el.clientHeight) return null
          const kids = (tree.children.get(picked.id)?.length ?? 0) > 0
          const bar = 'inline-flex size-8 items-center justify-center rounded-full text-foreground/75 transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
          return (
            <div data-map-overlay data-node-bar role="toolbar" aria-label={`Actions for ${picked.label}`} onPointerDown={e => e.stopPropagation()}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-full border border-white/10 bg-popover/95 p-0.5 shadow-soft backdrop-blur"
              style={{ left: Math.max(90, Math.min(sx, el.clientWidth - 90)), top: sy - 8 }}>
              {kids && <button type="button" onClick={() => explore(picked.id)} className={cn(bar, 'w-auto gap-1.5 px-3 text-xs font-medium')} title="Explore inside (Enter)" data-bar-explore><Layers aria-hidden className="size-3.5" /> Explore</button>}
              {ADDABLE.has(picked.type) && <button type="button" onClick={() => openAdd(picked)} className={bar} aria-label="Add" title="Add (N)"><Plus className="size-4" /></button>}
              {kids && <button type="button" onClick={() => toggleFold(picked.id)} className={bar} aria-label={collapsed.has(picked.id) ? 'Show what is inside' : 'Fold what is inside'} title="Fold (Space)">{collapsed.has(picked.id) ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />}</button>}
              {!detailOpen && <button type="button" onClick={() => setDetailOpen(true)} className={bar} aria-label="Show details" title="Details (Shift+Enter)"><PanelRightOpen className="size-4" /></button>}
              {canDelete(picked) && <button type="button" onClick={() => openDelete(picked)} className={cn(bar, 'hover:text-red-400')} aria-label="Delete" title="Delete"><Trash2 className="size-4" /></button>}
            </div>
          )
        })()}

        {panel?.kind === 'add' && <AddDialog key={`add-${panel.node?.id ?? 'subject'}`} node={panel.node} nodes={view.nodes} edges={view.edges} workspace={view.workspaceId ?? null}
          choices={panel.node ? undefined : [NEW_SUBJECT]} style={anchor(panel.node?.id ?? null)} onClose={closePanel}
          onAdded={a => { if (a.stale) { say(a.said); onChanged(); return } afterEdit(a.said, a.select) }} />}
        {panel?.kind === 'delete' && (
          <DeleteDialog key={`del-${panel.node.id}`} node={panel.node} edges={view.edges} tree={tree} style={anchor(panel.node.id)} onClose={closePanel}
            onDeleted={said => { if (selected === panel.node.id) setSelected(null); afterEdit(said, null) }} onStale={onChanged} />
        )}
        {panel?.kind === 'reset' && (
          <div role="alertdialog" aria-label="Reset layout" data-map-overlay className="absolute left-1/2 top-3 z-30 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-popover p-4 text-sm shadow-float" onPointerDown={e => e.stopPropagation()}>
            <p className="leading-relaxed text-foreground/85">Put every card back where Kivo places it, in the device&apos;s own orientation, and fit the map? Your subjects, topics, tasks, notes and links stay as they are.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={closePanel} disabled={layout.reset.busy} className={cn(BUTTON_QUIET, 'h-8')} autoFocus>Cancel</button>
              <button type="button" disabled={layout.reset.busy} data-reset-confirm
                onClick={() => void layout.resetPositions().then(ok => { if (ok) { setPanel(null); resetView(); say('Layout reset.') } })}
                className={cn(BUTTON_PRIMARY, 'h-8 px-3 text-xs')}>{layout.reset.busy ? 'Resetting…' : 'Reset layout'}</button>
            </div>
          </div>
        )}
        {panel?.kind === 'help' && <ShortcutsHelp mac={mac} onClose={closePanel} />}
        {panel?.kind === 'legend' && <Legend onClose={closePanel} suggestions={suggestions.length > 0} outside={markers.size > 0} />}

        <div className="absolute bottom-3 left-3 flex items-center gap-2" onPointerDown={e => e.stopPropagation()}>
          <button type="button" onClick={() => setPanel(p => (p?.kind === 'legend' ? null : { kind: 'legend' }))} aria-expanded={panel?.kind === 'legend'}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-card/90 px-3 text-xs font-medium text-foreground/75 shadow-soft backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" data-legend-open>
            <Info aria-hidden className="size-3.5" /> Legend
          </button>
          {(view.unconnected > 0 || view.notShown.notes > 0 || view.notShown.resources > 0) && (
            <p className="hidden rounded-lg bg-background/80 px-2.5 py-1.5 text-[11px] text-foreground/70 backdrop-blur-sm md:block">
              {view.unconnected > 0 && <>{view.unconnected} {view.unconnected === 1 ? 'item is' : 'items are'} not connected to anything.</>}
              {(view.notShown.notes > 0 || view.notShown.resources > 0) && <> Older notes and pages beyond the newest 150 of each are not drawn.</>}
            </p>
          )}
        </div>

        <div className={cn('absolute bottom-3 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-card/90 shadow-soft backdrop-blur transition-[right]', picked && detailOpen ? 'right-3 max-lg:bottom-[calc(58%+0.75rem)] lg:right-[23.5rem]' : 'right-3')} onPointerDown={e => e.stopPropagation()}>
          <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in (+)" className="p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Plus className="size-4" /></button>
          <button type="button" onClick={() => { if (selected && placed.at.has(selected)) centreOn(selected, 1); else zoomAt(1 / t.k) }} aria-label={`Zoom ${Math.round(t.k * 100)}%. Set to 100%`} title="Zoom to 100% (0)"
            className="border-t border-white/8 py-1 text-[10px] font-medium tabular-nums text-foreground/70 hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">{Math.round(t.k * 100)}%</button>
          <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out (-)" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Minus className="size-4" /></button>
          <button type="button" onClick={() => fit()} aria-label="Fit the map on screen" title="Fit (F)" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Maximize2 className="size-4" /></button>
        </div>

        {picked && detailOpen && (
          <Detail node={picked} neighbours={neighbours} onPick={id => pick(id)} onClose={() => setDetailOpen(false)}
            onScope={!canExplore(tree, picked.id) && focus === null ? () => setScope(picked.id) : null}
            scoped={scope === picked.id} view={view} onChanged={onChanged}
            inside={insideCount(picked.id)} collapsed={collapsed.has(picked.id)} onCollapse={() => toggleFold(picked.id)}
            onExplore={canExplore(tree, picked.id) && focus !== picked.id ? () => explore(picked.id) : null}
            onAdd={ADDABLE.has(picked.type) ? () => openAdd(picked) : null}
            onDelete={canDelete(picked) ? () => openDelete(picked) : null}
          // Read again either way: a stale view is refreshed, a removal shown.
          onDisconnected={said => { say(said); onChanged() }} />
        )}
        {notice && (
          <p key={notice.n} className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-full border border-white/10 bg-popover/95 px-3.5 py-1.5 text-center text-xs text-foreground/85 shadow-soft" data-map-notice>{notice.text}</p>
        )}
        <p className="sr-only" role="status" aria-live="polite">{notice?.text ?? ''}</p>
      </div>

    </div>
  )
}

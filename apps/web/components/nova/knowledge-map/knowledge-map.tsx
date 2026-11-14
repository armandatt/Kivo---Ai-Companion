'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useStartSession } from '../use-start-session'
import { ArrowUp, ArrowUpRight, ChevronsDownUp, ChevronsUpDown, Circle, CornerDownRight, FilePlus, FileText, Focus, Globe, Info, Keyboard, Layers, Lightbulb, Link2, ListChecks, Maximize2, Minus, MoreHorizontal, PanelRightOpen, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, Timer, Trash2, Unlink, Waypoints, X } from 'lucide-react'
import type { MapEdge, MapEdgeKind, MapNode, MapNodeType, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { MAP_LAYOUT_COORD_MAX } from '@repo/api/nova/product/map-layout.types'
import { treeOrder } from '@repo/api/nova/product/task-tree'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '../workspace/ui'
import { toneStyle } from '../subject-color'
import { CardFace, FILL, plural, short, type CardDetail } from './card-face'
import { CARD, TREE_EDGES, layoutMap, treeOf, withPositions, type MapLayout } from './layout'
import { useMapLayout } from './use-map-layout'
import { filingChoices, placementLabel, placementOf, planLink, samePlacement, type Placement } from './map-edit'
import { addNoteLink, fileItem, type EditOutcome } from './map-actions'
import { fitKey, focusToApply, keepValid } from './view-state'
import { START, back, canExplore, crossLinks, current, enter, insideOf, keepLevels, MARKER_R, pathTo, placeOutside, reach, up, type Level, type View } from './explore'
import { enterAction, enterTarget, isMacPlatform, isTypingTarget, navigate, nearestTo, shortcutFor, type NavBox } from './map-shortcuts'
import { OUTLINE_QUERY, browserStore, chooseOrientation, chosenOrientation, forgetViews, pictureKey, recallView, rememberView, type Orientation } from './view-memory'
import { NEW_SUBJECT } from './map-structure'
import { disconnectPlan } from './map-disconnect'
import { sendDisconnect } from './map-structure-api'
import { AddDialog, Breadcrumbs, DeleteDialog, DeleteWholeDialog, Legend, ShortcutsHelp } from './map-panels'
import { BOARD_PATH } from '@repo/api/nova/product/companion'
import { askSuggestions, nextStep, overdueIn, summaryOf, type Status } from './node-summary'
import { loadNotePreview } from './note-preview'
import { crossSubjectLinks, foldedLabel, foldedTotal, overviewDensity, rootOf, type Density } from './overview-density'
import { GAP_LABEL, LENSES, STATE_LABEL, gapRank, gapsOf, isRecent, lensTargets, nextLens, tallyOf, topicState, type Lens, type StateTally, type TopicState } from './lens'
import { detailAt, minimapFrame, viewCentredOn, viewOfBox, viewportOn, REGION_LABEL_PX } from './overview'
import { pathOf, searchMap, matchesOf } from './map-search'
import { TalkToNova } from '../talk-to-nova'
import { EDGE_MS, chooseMotion, chosenMotion, enteredBefore, entranceMode, entrancePlan, markEntered, radiusOf, regionsOf, thicknessOf, type Entrance, type EntranceMode, type Motion } from './depth'

// The browser session's store, for "this map was opened already" (depth.ts).
const sessionStore = () => { try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null } }
// How long a card created or deleted here takes to arrive or leave.
const FRESH_MS = 1300, GHOST_MS = 520

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

const day   = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Far out, the map reads as subjects (overview.ts), so it may zoom out further than a card can be read.
const MIN_K = 0.1, MAX_K = 2.5

// A session started from the map has no planned block behind it, so it is
// the length of an ordinary one.
const MAP_SESSION_MINUTES = 25

// How far one arrow key moves the map, in screen pixels.
const PAN_STEP = 60
// How far Alt and an arrow key move a card, in map units (Shift for more).
// The opening camera's glide, as long as the cards' entrance.
const CAMERA_MS = 3200
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

// Unlinking one connection from the details panel: what it means first, then
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
    if (out.ok) { onDone(out.said[0] ?? 'Unlinked. Nothing was deleted.', false); return }
    setError(out.message)
    if (out.stale) onDone(out.message, true)
  }
  return (
    <div role="group" aria-label="Unlink" className="mx-2 mb-2 rounded-xl border border-white/10 bg-white/3 p-3 text-xs leading-relaxed" data-disconnect
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onCancel() } }}>
      {plan.ok ? <>
        <p className="font-medium text-foreground">{plan.label}</p>
        <p className="mt-1 text-foreground/75">{plan.detail}</p>
      </> : <p className="text-foreground/80" data-disconnect-blocked>{plan.why}</p>}
      {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={cn(BUTTON_QUIET, 'h-7')} autoFocus={!plan.ok}>Cancel</button>
        {plan.ok && <button type="button" onClick={() => void go()} disabled={busy} className={cn(BUTTON_PRIMARY, 'h-7 px-3 text-xs')} autoFocus data-disconnect-confirm>{busy ? 'Unlinking…' : 'Unlink'}</button>}
      </div>
    </div>
  )
}

// How the "Connected to" list is grouped, from the selected card's side.
const GROUPS: Array<{ key: string; title: string; test: (kind: MapEdgeKind, outgoing: boolean) => boolean }> = [
  { key: 'above', title: 'Sits inside', test: (k, out) => !out && k !== 'links_to' && k !== 'depends_on' },
  { key: 'inside', title: 'Inside it', test: (k, out) => out && (k === 'contains' || k === 'has_topic' || k === 'subtopic' || k === 'step' || k === 'has_task') },
  { key: 'filed', title: 'Notes and saved pages', test: (k, out) => out && (k === 'about_topic' || k === 'filed_under') },
  { key: 'links', title: '[[Links]]', test: k => k === 'links_to' },
  { key: 'waits', title: 'Waits', test: k => k === 'depends_on' },
]

// The inspector beside the map: a small workspace for the card, not a record.
// What it is and where it sits; its state as a picture (a ring, dots); one
// next step from its own record; the actions Kivo has for it; what is filed
// there as tiles and what is around it as chips, each one selecting that card
// on the map. Secondary facts and every connection (with Unlink) only when
// asked for. Every control is an existing Kivo action: the ordinary session
// start, the ordinary Nova turn, the note editor, the map's own explore, add
// and delete. Each kind of card has its own (node-summary.ts).
const STATUS_TONE: Record<Status['tone'], string> = { solid: 'var(--nova)', developing: 'var(--map-resource)', weak: 'var(--map-note)', due: 'var(--map-note)', plain: 'var(--subtle)' }

// Progress as a ring: the share given, in the state's colour; no number when none is on record.
function Ring({ percent, color, size = 52, label }: { percent: number | null; color: string; size?: number; label: string }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={label} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--map-line)" strokeWidth={4} />
      {percent !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" className="map-ring-arc"
        strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} style={{ ['--ring-c' as string]: c }} />}
      <text x={size / 2} y={size / 2} transform={`rotate(90 ${size / 2} ${size / 2})`} textAnchor="middle" dominantBaseline="central" fontSize={percent === null ? 13 : 12} fontWeight={650} className="fill-foreground">{percent === null ? '–' : `${percent}%`}</text>
    </svg>
  )
}

const TILE_ICON: Partial<Record<MapNodeType, typeof FileText>> = { note: FileText, resource: Globe, task: ListChecks, topic: Circle, subject: Circle }

function Detail({ node, neighbours, onPick, onClose, onScope, scoped, view, onChanged, inside, collapsed, onCollapse, onExplore, onAdd, onDelete, onDisconnected, where = [], tally, subjectTopics = [] }: {
  node: MapNode; neighbours: Array<{ node: MapNode; relation: string; edge: MapEdge }>; onPick: (id: string) => void; onClose: () => void
  // What it sits inside, from the top (each can be selected).
  where?: Array<{ id: string; label: string }>
  // A subject's topics by state (all of them, folded or not), and the topics themselves.
  tally?: StateTally; subjectTopics?: Array<Extract<MapNode, { type: 'topic' }>>
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
  const [section, setSection] = useState<'none' | 'more' | 'ask'>('none')
  const [menu, setMenu] = useState(false)
  const summary = summaryOf(node, { tally, when: ago })
  const step = nextStep(node)
  // A note's opening words, read when the note is opened (note-preview.ts).
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setSection('none'); setMenu(false)
    if (node.type !== 'note') return
    let live = true
    setPreview(undefined)
    void loadNotePreview(rowId(node.id)).then(p => { if (live) setPreview(p) })
    return () => { live = false }
  }, [node.id, node.type])
  const open = node.type === 'note' ? 'Open note' : node.type === 'resource' ? 'Open in Saved' : node.type === 'topic' ? 'Open topic' : node.type === 'task' ? 'Open on the board' : 'Open subject'
  // A new note filed where this node is. The note editor reads both from the address.
  const noteHere = node.type === 'topic' ? `/notes/new?subjectId=${encodeURIComponent(node.subjectId ?? '')}&topic=${encodeURIComponent(node.label)}`
    : node.type === 'subject' ? `/notes/new?subjectId=${encodeURIComponent(node.subjectId ?? '')}` : null
  const tone = node.type === 'subject' ? node.label : node.subjectName ?? null
  const goals = node.type === 'topic' ? node.details?.goals ?? [] : []
  const studiable = node.type === 'topic' && node.studied !== false && node.kind !== 'milestone'
  const askable = node.type === 'subject' || node.type === 'topic'
  // What is filed here (tiles) and what is around it (chips), from the links on record.
  // Each card once, though two links may join it (a [[link]] both ways).
  const once = (rows: typeof neighbours) => rows.filter((r, i) => rows.findIndex(x => x.node.id === r.node.id) === i)
  const filed = once(neighbours.filter(({ edge }) => edge.from === node.id && (edge.kind === 'about_topic' || edge.kind === 'filed_under' || edge.kind === 'has_task')))
  const up = once(neighbours.filter(({ edge }) => edge.to === node.id && edge.kind !== 'links_to' && edge.kind !== 'depends_on'))
  const within = once(neighbours.filter(({ edge }) => edge.from === node.id && (edge.kind === 'subtopic' || edge.kind === 'contains' || edge.kind === 'step' || (node.type === 'subject' && edge.kind === 'has_topic'))))
  const linked = once(neighbours.filter(({ edge }) => edge.kind === 'links_to' || edge.kind === 'depends_on'))
  const act = 'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-[11px] whitespace-nowrap font-medium text-foreground/80 transition duration-150 active:scale-95 hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-expanded:bg-white/8 aria-expanded:text-foreground'
  const icon = 'size-[18px]'
  const chip = 'inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-white/20 hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
  const toggle = (s: typeof section) => setSection(v => (v === s ? 'none' : s))
  const startNow = () => { if (node.type === 'topic') void start({ topicName: node.label, subjectName: node.subjectName, durationMinutes: MAP_SESSION_MINUTES }, node.id) }

  const tiles = (rows: typeof filed, max = 4) => rows.length === 0 ? null : (
    <div className="grid grid-cols-2 gap-1.5" data-filed-tiles>
      {rows.slice(0, max).map(({ node: n }) => {
        const Icon = TILE_ICON[n.type] ?? FileText
        return (
          <button key={n.id} type="button" onClick={() => onPick(n.id)} title={n.label}
            className="flex min-w-0 items-start gap-2 rounded-xl border border-white/8 bg-white/[0.025] p-2 text-left transition duration-200 hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/5 hover:shadow-soft active:translate-y-0 focus-visible:outline-2 focus-visible:outline-ring">
            <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color: FILL[n.type] }} />
            <span className="min-w-0">
              <span className="line-clamp-2 text-xs font-medium leading-snug text-foreground/90">{n.label}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-subtle">{n.type === 'resource' ? n.domain : n.type === 'note' ? ago(n.updatedAt) : n.type === 'task' ? (n.status === 'done' ? 'Done' : n.status === 'in_progress' ? 'In progress' : 'To do') : TYPE_LABEL[n.type]}</span>
            </span>
          </button>
        )
      })}
      {rows.length > max && node.href && <Link href={node.href} className="col-span-2 rounded-lg py-1 text-center text-xs text-foreground/60 hover:bg-white/5 hover:text-foreground">+{rows.length - max} more</Link>}
    </div>
  )
  const chips = (title: string, Icon: typeof Circle, rows: typeof filed, key: string) => rows.length === 0 ? null : (
    <div data-around={key}>
      <p className="mb-1 flex items-center gap-1 text-[11px] text-subtle"><Icon aria-hidden className="size-3" /> {title}</p>
      <div className="flex flex-wrap gap-1">
        {rows.slice(0, 6).map(({ node: n }) => (
          <button key={n.id} type="button" onClick={() => onPick(n.id)} className={chip} title={`${TYPE_LABEL[n.type]}: ${n.label}`}>
            <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: n.type === 'topic' ? STATE_FILL[topicState(n)] : FILL[n.type] }} />
            <span className="truncate">{short(n.label, 26)}</span>
          </button>
        ))}
        {rows.length > 6 && <span className="px-1 py-1 text-xs text-subtle">+{rows.length - 6}</span>}
      </div>
    </div>
  )

  return (
    <aside aria-label={`Selected: ${TYPE_LABEL[node.type]} ${node.label}`} data-map-overlay data-detail data-detail-type={node.type}
      className={cn("subject-tone map-inspector map-inspector-in absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col gap-3.5 overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/10 bg-card/95 p-4 shadow-float backdrop-blur lg:inset-x-auto lg:bottom-auto lg:right-3 lg:top-3 lg:max-h-[calc(100%-1.5rem)] lg:rounded-2xl lg:border", section === 'ask' ? 'lg:w-[30rem]' : 'lg:w-[21rem]')}
      style={toneStyle(tone)} onPointerDown={e => e.stopPropagation()}>
      {/* What it is, where it sits, and its state at a glance. */}
      <div className="flex items-start gap-3">
        {node.type === 'topic' && summary.status && (
          <Ring percent={summary.status.percent} color={STATUS_TONE[summary.status.tone]} label={`${summary.status.label}${summary.status.percent !== null ? `, ${summary.status.percent}% (your own estimate)` : ''}`} />
        )}
        {node.type === 'subject' && summary.status && <Ring percent={summary.status.percent} color="var(--sc)" label={summary.status.label} />}
        {node.type !== 'topic' && node.type !== 'subject' && (
          <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklch, ${FILL[node.type]} 16%, transparent)` }}>
            {(() => { const Icon = TILE_ICON[node.type] ?? FileText; return <Icon aria-hidden className="size-5" style={{ color: FILL[node.type] }} /> })()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[17px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{node.label}</h2>
          {where.length > 0 && (
            <nav aria-label="Where it sits" className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-subtle" data-detail-path>
              {where.map((w, i) => (
                <span key={w.id} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>›</span>}
                  <button type="button" onClick={() => onPick(w.id)} className="rounded hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">{w.label}</button>
                </span>
              ))}
            </nav>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-detail-status>
            {summary.status && node.type !== 'subject' && <span className="font-medium" style={{ color: STATUS_TONE[summary.status.tone] === 'var(--subtle)' ? undefined : STATUS_TONE[summary.status.tone] }}>{summary.status.label}</span>}
            {node.type === 'subject' && summary.status && <span className="text-foreground/70">{summary.status.label}</span>}
            {node.type === 'topic' && node.reviewDue && <span className="rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ background: 'color-mix(in oklch, var(--map-note) 18%, transparent)', color: 'var(--map-note)' }}>Review due</span>}
            {node.type === 'topic' && node.lastStudiedAt && <span className="text-subtle">· studied {ago(node.lastStudiedAt)}</span>}
            {node.type === 'resource' && <span className="text-subtle">{node.domain}</span>}
            {node.type === 'note' && <span className="text-subtle">Edited {ago(node.updatedAt)}</span>}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Hide details (the card stays selected)" title="Hide details" className="-m-1 rounded-lg p-1 text-subtle transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>
      </div>

      {summary.description && <p className="line-clamp-3 text-[13px] leading-relaxed text-foreground/75" title={summary.description}>{summary.description}</p>}
      {node.type === 'note' && (
        <p className="line-clamp-5 rounded-xl border border-white/8 bg-white/[0.025] p-2.5 text-[13px] leading-relaxed text-foreground/75" data-note-preview>
          {preview === undefined ? <span className="text-subtle">Reading the note…</span> : preview ? preview : <span className="text-subtle">The note is empty, or couldn’t be read here.</span>}
        </p>
      )}

      {/* A subject: every topic as a dot, by state; a review due is ringed. One click opens it. */}
      {node.type === 'subject' && subjectTopics.length > 0 && (
        <div data-subject-dots>
          <div className="flex flex-wrap gap-1">
            {subjectTopics.slice(0, 60).map(t => {
              const st = topicState(t)
              return (
                <button key={t.id} type="button" onClick={() => onPick(t.id)} title={`${t.label}: ${STATE_LABEL[st]}${t.reviewDue ? ' · review due' : ''}`} aria-label={`${t.label}, ${STATE_LABEL[st]}`}
                  className="size-4 rounded-[5px] transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-ring"
                  style={{ background: st === 'unstudied' ? 'transparent' : STATE_FILL[st], border: st === 'unstudied' ? '1.5px dashed var(--map-topic)' : undefined, boxShadow: t.reviewDue ? '0 0 0 2px var(--map-note)' : undefined, opacity: st === 'organising' ? 0.45 : 1 }} />
              )
            })}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-[10.5px] text-subtle">
            <span><span className="mr-1 inline-block size-2 rounded-sm bg-[var(--nova)]" />solid</span><span><span className="mr-1 inline-block size-2 rounded-sm bg-[var(--map-resource)]" />developing</span><span><span className="mr-1 inline-block size-2 rounded-sm bg-[var(--map-note)]" />weak</span><span><span className="mr-1 inline-block size-2 rounded-sm border border-dashed border-[var(--map-topic)]" />not studied</span>
          </p>
        </div>
      )}

      {/* The actions Kivo has for it. */}
      <div className="flex gap-0.5 rounded-2xl border border-white/8 bg-white/[0.02] p-1" data-node-actions role="toolbar" aria-label="Actions">
        {node.href && <Link href={node.href} className={act} title={open}><ArrowUpRight aria-hidden className={icon} />Open</Link>}
        {askable && <button type="button" onClick={() => toggle('ask')} aria-expanded={section === 'ask'} className={act} data-ask-nova title="Ask Nova about it"><Sparkles aria-hidden className={icon} style={{ color: 'var(--nova)' }} />Ask</button>}
        {node.type === 'note' && <Link href={`/notes/${encodeURIComponent(rowId(node.id))}?tutor=summary`} className={act} data-ask-nova title="Open the note with Nova summarising it"><Sparkles aria-hidden className={icon} style={{ color: 'var(--nova)' }} />Summarise</Link>}
        {/* The ordinary start, on a topic studied on its own, under its own subject. */}
        {studiable && node.type === 'topic' && (
          <button type="button" disabled={starting !== null} data-start-topic className={act} title={`Start a ${MAP_SESSION_MINUTES}-minute session`}
            onClick={() => void start({ topicName: node.label, subjectName: node.subjectName, durationMinutes: MAP_SESSION_MINUTES }, node.id)}>
            {node.reviewDue ? <RotateCcw aria-hidden className={icon} /> : <Timer aria-hidden className={icon} />}
            {starting === node.id ? 'Starting…' : node.reviewDue ? 'Revise' : 'Focus'}
          </button>
        )}
        {onExplore && <button type="button" onClick={onExplore} className={act} data-explore title="Explore inside (Enter)"><Layers aria-hidden className={icon} />Explore</button>}
        {!onExplore && onScope && !scoped && <button type="button" onClick={onScope} className={act} data-scope-here title="Show what is around it"><Focus aria-hidden className={icon} />Around</button>}
        {noteHere && <Link href={noteHere} className={act} data-note-here title="A new note filed here"><FilePlus aria-hidden className={icon} />Note</Link>}
        {node.type === 'subject' && onAdd && <button type="button" onClick={onAdd} className={act} title="Add a topic (N)"><Plus aria-hidden className={icon} />Topic</button>}
        {node.type === 'resource' && <a href={node.url} target="_blank" rel="noopener noreferrer" className={act} title="Visit the page"><Globe aria-hidden className={icon} />Visit</a>}
        <span className="flex min-w-0 flex-1">
          <button type="button" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" className={cn(act, 'w-full')} data-more-open title="More"><MoreHorizontal aria-hidden className={icon} />More</button>
        </span>
      </div>
      {menu && (
            <span role="menu" className="-mt-2 flex flex-col rounded-xl border border-white/10 bg-popover p-1" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setMenu(false) } }}>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); toggle('more') }} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-white/6" data-details-open><Info aria-hidden className="size-3.5" /> Details and every link</button>
              {onExplore && onScope && !scoped && <button type="button" role="menuitem" onClick={() => { setMenu(false); onScope() }} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-white/6" data-scope-here><Focus aria-hidden className="size-3.5" /> Show what is around it</button>}
              {onAdd && <button type="button" role="menuitem" onClick={() => { setMenu(false); onAdd() }} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-white/6" data-add-open title="N"><Plus aria-hidden className="size-3.5" /> Add inside or beside…</button>}
              {inside > 0 && <button type="button" role="menuitem" onClick={() => { setMenu(false); onCollapse() }} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-white/6" data-collapse aria-pressed={collapsed} title="Space">{collapsed ? <ChevronsUpDown aria-hidden className="size-3.5" /> : <ChevronsDownUp aria-hidden className="size-3.5" />} {collapsed ? `Show the ${inside} inside` : `Fold the ${inside} inside`}</button>}
              {onDelete && <button type="button" role="menuitem" onClick={() => { setMenu(false); onDelete() }} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-red-400 hover:bg-red-400/10" data-delete-open title="Delete"><Trash2 aria-hidden className="size-3.5" /> Delete…</button>}
            </span>
          )}
      {startError && <p role="alert" className="-mt-2 text-sm text-red-400">{startError}</p>}
      {section === 'ask' && askable && (
        <TalkToNova roomy about={node.type === 'topic' ? `the topic “${node.label}” in ${node.subjectName}` : `the subject “${node.label}”`} aboutNode={node.id} placeholder={`Ask about ${short(node.label, 40)}…`} className="-mt-1"
          suggestions={askSuggestions(node, tally, { overdue: overdueIn(view.nodes, node) })} />
      )}

      {/* One next step, from its own record, as an action. */}
      {step && (
        <div className="flex items-center gap-2.5 rounded-xl border px-3 py-2" style={{ borderColor: 'color-mix(in oklch, var(--map-note) 35%, transparent)', background: 'color-mix(in oklch, var(--map-note) 7%, transparent)' }} data-next-step={step.kind}>
          <Lightbulb aria-hidden className="size-4 shrink-0" style={{ color: 'var(--map-note)' }} />
          <span className="min-w-0 flex-1 text-xs text-foreground/85">{step.text}</span>
          {step.kind === 'note'
            ? noteHere && <Link href={noteHere} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-foreground hover:bg-white/8">Add a note</Link>
            : studiable && <button type="button" onClick={startNow} disabled={starting !== null} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-foreground hover:bg-white/8 disabled:opacity-50">{step.kind === 'revise' ? 'Revise now' : step.kind === 'start' ? 'Start' : 'Study again'}</button>}
        </div>
      )}

      {/* What is filed here, as tiles; each one goes to its card. */}
      {filed.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center justify-between text-[11px] text-subtle"><span>Filed here</span><span className="tabular-nums">{filed.length}</span></p>
          {tiles(filed)}
        </div>
      )}

      {/* What is around it, as chips: what it sits inside, what is inside it, what links to it. */}
      {(up.length > 0 || within.length > 0 || linked.length > 0) && (
        <div className="space-y-2">
          {chips('Sits inside', ArrowUp, up, 'up')}
          {node.type !== 'subject' && chips('Inside it', CornerDownRight, within, 'inside')}
          {chips(node.type === 'task' ? 'Waits' : 'Linked', Link2, linked, 'linked')}
        </div>
      )}

      {section === 'more' && (
        <div className="space-y-3 border-t border-white/6 pt-3" data-detail-more>
          {summary.more.length > 0 && (
            <dl className="space-y-1 text-sm">
              {summary.more.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-subtle">{k}</dt><dd className="text-right tabular-nums text-foreground/85">{v}</dd></div>
              ))}
            </dl>
          )}
          {node.type === 'topic' && node.level && node.studied !== false && <p className="text-xs leading-relaxed text-subtle">The estimate comes from how you said your sessions went. It is not a test result.</p>}
          {node.type === 'topic' && gapsOf(node).length > 0 && <p className="text-xs" style={{ color: 'var(--map-note)' }} data-detail-gaps>To act on: {gapsOf(node).map(g => GAP_LABEL[g].toLowerCase()).join(', ')}</p>}
          {node.type === 'resource' && node.filedBy === 'nova' && <p className="text-xs leading-relaxed text-subtle">Nova filed it here from a name match. Keep or undo it under Saved pages.</p>}
          {goals.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground/80" data-milestone-goals>{goals.map(g => <li key={g}>{g}</li>)}</ul>}
          {(node.type === 'topic' || node.type === 'subject') && node.tasks && node.tasks.length > 0 && (
            <div data-map-tasks>
              <h3 className="flex items-center justify-between text-xs text-subtle">Tasks <span>{node.tasks.filter(t => t.status === 'done').length} of {node.tasks.length} done</span></h3>
              <ul className="mt-1 space-y-0.5">
                {treeOrder(node.tasks.map(t => ({ ...t, parent: t.parentId }))).map(({ item: t, depth }) => (
                  <li key={t.id} className="flex items-start gap-2 py-0.5 text-sm" style={{ paddingLeft: depth * 14 }} data-depth={depth}>
                    <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', t.status === 'done' ? 'bg-action' : t.status === 'in_progress' ? 'bg-amber-400' : 'bg-foreground/30')} />
                    <span className={cn('min-w-0 break-words', t.status === 'done' ? 'text-subtle line-through' : depth > 0 ? 'text-foreground/75' : 'text-foreground/90')}>{t.title}</span>
                  </li>
                ))}
              </ul>
              <Link href={BOARD_PATH} className="mt-1 inline-block text-xs font-medium text-foreground/60 underline-offset-4 hover:text-foreground hover:underline">Open on the board</Link>
            </div>
          )}
          {(node.type === 'note' || node.type === 'resource') && (
            <div className="space-y-2">
              {node.type === 'note' && <LinkEditor key={`link-${node.id}`} node={node} view={view} onChanged={onChanged} />}
              <FileEditor key={`file-${node.id}`} node={node} view={view} onChanged={onChanged} />
            </div>
          )}
          {/* Every connection, grouped, with Unlink (no card is deleted). */}
          <div>
            {neighbours.length === 0 ? (
              <p className="text-sm leading-relaxed text-foreground/65">
                Nothing linked yet. {node.type === 'note' || node.type === 'resource' ? 'File it under a subject (above) and it joins that subject.' : ''}
              </p>
            ) : GROUPS.map(g => {
              const rows = neighbours.filter(({ edge }) => g.test(edge.kind, edge.from === node.id))
              if (rows.length === 0) return null
              return (
                <section key={g.key} className="mt-2" data-connected-group={g.key}>
                  <h4 className="px-2 text-[11px] text-subtle">{g.title} <span className="tabular-nums">· {rows.length}</span></h4>
                  <ul className="mt-0.5 space-y-0.5">
                    {rows.map(({ node: n, relation, edge }) => (
                      <li key={`${n.id}:${relation}`} className="group/row">
                        <div className="flex items-center">
                          <button type="button" onClick={() => onPick(n.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                            <span className={cn('inline-block size-2 shrink-0', relation === RELATION.links_to![0] || relation === RELATION.links_to![1] ? 'rounded-full ring-1 ring-[var(--nova)]' : 'rounded-full')} style={{ background: FILL[n.type] }} />
                            <span className="min-w-0 flex-1 truncate">{n.label}</span>
                          </button>
                          <button type="button" onClick={() => setRemoving(r => (r === edge.id ? null : edge.id))} aria-expanded={removing === edge.id}
                            aria-label={`Unlink ${n.label}`} title="Unlink (no card is deleted)" data-disconnect-open={n.label}
                            className="ml-1 inline-flex shrink-0 items-center rounded-lg p-1.5 text-foreground/50 opacity-0 transition hover:bg-white/5 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/row:opacity-100 aria-expanded:opacity-100">
                            <Unlink aria-hidden className="size-3.5" />
                          </button>
                        </div>
                        {removing === edge.id && <Disconnect edge={edge} view={view} onCancel={() => setRemoving(null)} onDone={(said, stale) => { setRemoving(null); onDisconnected(said, stale) }} />}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </aside>
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
  | { kind: 'delete_map'; workspaceId: string; title: string }
  | { kind: 'help' } | { kind: 'legend' } | { kind: 'filters' } | { kind: 'reset' } | { kind: 'nova' }

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

// ── The minimap ─────────────────────────────────────────────────────────────
// The whole map, small, with where the screen is. A click or a drag moves the
// view there (overview.ts does the arithmetic). The cards are drawn once per
// map; only the viewport's outline follows the pan.
const MINI = { w: 184, h: 116 }
// The minimap takes the map's own shape, inside MINI.
const miniSize = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
  const a = Math.max(1, b.maxX - b.minX) / Math.max(1, b.maxY - b.minY)
  return a >= MINI.w / MINI.h ? { w: MINI.w, h: Math.max(48, Math.round(MINI.w / a)) } : { w: Math.max(56, Math.round(MINI.h * a)), h: MINI.h }
}
type MiniCard = { id: string; x: number; y: number; w: number; h: number; fill: string }
const MinimapBody = memo(function MinimapBody({ cards, regions, f }: { cards: MiniCard[]; regions: Array<{ id: string; x: number; y: number; w: number; h: number; tone: string | null }>; f: ReturnType<typeof minimapFrame> }) {
  return (
    <>
      {regions.map(r => (
        <rect key={r.id} className="subject-tone" style={toneStyle(r.tone)} x={r.x * f.scale + f.ox} y={r.y * f.scale + f.oy} width={r.w * f.scale} height={r.h * f.scale} rx={4} fill="var(--sc-soft)" />
      ))}
      {cards.map(c => <rect key={c.id} x={(c.x - c.w / 2) * f.scale + f.ox} y={(c.y - c.h / 2) * f.scale + f.oy} width={Math.max(1.5, c.w * f.scale)} height={Math.max(1.2, c.h * f.scale)} rx={0.8} fill={c.fill} opacity={0.85} />)}
    </>
  )
})
function Minimap({ cards, regions, box, t, cw, ch, onJump }: {
  cards: MiniCard[]; regions: Array<{ id: string; x: number; y: number; w: number; h: number; tone: string | null }>
  box: { minX: number; minY: number; maxX: number; maxY: number }; t: View; cw: number; ch: number; onJump: (v: View) => void
}) {
  const size = useMemo(() => miniSize(box), [box])
  const f = useMemo(() => minimapFrame(box, size.w, size.h), [box, size])
  const vp = viewportOn(f, t, cw, ch)
  const jump = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    onJump(viewCentredOn(f, e.clientX - b.left, e.clientY - b.top, t.k, cw, ch))
  }
  return (
    <svg width={size.w} height={size.h} role="group" aria-label="Minimap: the whole map, and where you are in it. Click to move there." data-minimap
      className="block cursor-pointer touch-none"
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); jump(e) }}
      onPointerMove={e => { if (e.buttons & 1) jump(e) }}>
      <MinimapBody cards={cards} regions={regions} f={f} />
      <rect x={vp.x} y={vp.y} width={vp.w} height={vp.h} rx={3} fill="color-mix(in oklch, var(--action) 10%, transparent)" stroke="var(--action)" strokeWidth={1.25} data-minimap-view />
    </svg>
  )
}

// What a card says when the pointer rests on it: its whole title (cards cut
// long ones short), where it sits, and its state; never an action.
function peekLines(n: MapNode, path: string[], now: Date): { title: string; where: string; facts: string[] } {
  const facts: string[] = []
  if (n.type === 'topic') {
    const st = topicState(n)
    facts.push(n.level && n.masteryPercent !== null && st !== 'organising' ? `${STATE_LABEL[st]} · ${n.masteryPercent}% (your own estimate)` : STATE_LABEL[st])
    if (n.reviewDue) facts.push('Review due')
    if (n.lastStudiedAt) facts.push(`Last studied ${ago(n.lastStudiedAt)}${isRecent(n, now) ? '' : ''}`)
    facts.push(`${plural(n.sessions, 'session')} · ${plural(n.notes, 'note')} · ${plural(n.resources, 'saved page')}`)
  } else if (n.type === 'subject') facts.push(`${plural(n.topics, 'topic')} · ${plural(n.notes, 'note')} · ${plural(n.resources, 'saved page')}`)
  else if (n.type === 'note') facts.push(`Edited ${ago(n.updatedAt)}`)
  else if (n.type === 'resource') facts.push(`${n.domain} · saved ${ago(n.savedAt)}`)
  else facts.push([n.status === 'done' ? 'Done' : n.status === 'in_progress' ? 'In progress' : 'To do', n.dueDay ? `due ${n.dueDay}` : null].filter(Boolean).join(' · '))
  return { title: n.label, where: path.join(' › '), facts }
}

// What a topic card shows about learning, over its face: all of it read from
// the record (lens.ts). Far out, the tile is tinted by its state, so the
// overview reads as what is known; near, a review due is marked whatever the
// lens, the Learning lens colours the accent and marks recent study, and the
// Gaps lens rings a gap and says why under the card.
function TopicMarks({ n, detail, lens, now }: { n: Extract<MapNode, { type: 'topic' }>; detail: CardDetail; lens: Lens; now: Date }) {
  const { w, h } = CARD.topic
  const x0 = -w / 2, y0 = -h / 2
  const state = topicState(n)
  const gaps = gapsOf(n)
  const chip = (x: number, label: string, fill: string) => (
    <g transform={`translate(${x} ${y0 - 8})`} className="pointer-events-none">
      <rect width={label.length * 5.6 + 14} height={15} rx={7.5} fill="var(--card)" stroke={fill} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect width={label.length * 5.6 + 14} height={15} rx={7.5} fill={fill} opacity={0.18} />
      <text x={7} y={10.6} fontSize={9.5} fontWeight={600} style={{ fill }}>{label}</text>
    </g>
  )
  if (detail === 0) {
    return (
      <>
        {state !== 'unstudied' && state !== 'organising' && <rect className="pointer-events-none" x={x0} y={y0} width={w} height={h} rx={14} fill={STATE_FILL[state]} opacity={state === 'milestone' ? 0.18 : 0.42} />}
        {n.reviewDue && <circle cx={-x0 - 12} cy={y0 + 12} r={9} fill="var(--map-note)" />}
        {lens === 'gaps' && gaps.length > 0 && <rect className="pointer-events-none" x={x0 - 7} y={y0 - 7} width={w + 14} height={h + 14} rx={20} fill="none" stroke="var(--map-note)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
      </>
    )
  }
  return (
    <>
      {lens === 'learning' && n.subjectName && state !== 'unstudied' && <rect className="pointer-events-none" x={x0 + 7} y={y0 + 11} width={3} height={h - 22} rx={1.5} fill={STATE_FILL[state]} />}
      {/* On the top edge, left of the card's own + button. */}
      {n.reviewDue && chip(x0 + 12, 'Review due', 'var(--map-note)')}
      {lens === 'learning' && isRecent(n, now) && chip(x0 + 12 + (n.reviewDue ? 76 : 0), 'Recent', 'var(--nova)')}
      {lens === 'gaps' && gaps.length > 0 && (
        <>
          <rect className="pointer-events-none" x={x0 - 6} y={y0 - 6} width={w + 12} height={h + 12} rx={19} fill="none" stroke="var(--map-note)" strokeWidth={1.6} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <text x={x0 + 4} y={h / 2 + 17} fontSize={10.5} fontWeight={500} className="pointer-events-none" style={{ fill: 'var(--map-note)' }}>{gaps.filter(g => g !== 'review_due').map(g => GAP_LABEL[g]).join(' · ')}</text>
        </>
      )}
    </>
  )
}

// A line along the gaps (into a wrapped column), its corners rounded so it
// bends like a fibre: out to the trunk, along the gap above the card's row,
// then down into the card. The same course as before, never across a card.
function roundedLane(a: { x: number; y: number }, lane: { trunkX: number; laneY: number }, b: { x: number; y: number }): string {
  const r = 14
  const sx1 = Math.sign(lane.trunkX - a.x) || 1, sy1 = Math.sign(lane.laneY - a.y) || 1
  const sx2 = Math.sign(b.x - lane.trunkX) || 1, sy2 = Math.sign(b.y - lane.laneY) || 1
  const r1 = Math.min(r, Math.abs(lane.trunkX - a.x) / 2, Math.abs(lane.laneY - a.y) / 2)
  const r2 = Math.min(r, Math.abs(lane.laneY - a.y) / 2, Math.abs(b.x - lane.trunkX) / 2)
  const r3 = Math.min(r, Math.abs(b.x - lane.trunkX) / 2, Math.abs(b.y - lane.laneY) / 2)
  return [
    `M ${a.x} ${a.y}`, `H ${lane.trunkX - sx1 * r1}`, `Q ${lane.trunkX} ${a.y} ${lane.trunkX} ${a.y + sy1 * r1}`,
    `V ${lane.laneY - sy1 * r2}`, `Q ${lane.trunkX} ${lane.laneY} ${lane.trunkX + sx2 * r2} ${lane.laneY}`,
    `H ${b.x - sx2 * r3}`, `Q ${b.x} ${lane.laneY} ${b.x} ${lane.laneY + sy2 * r3}`, `V ${b.y}`,
  ].join(' ')
}

// A topic's state, in a colour of the theme (the overview, the Learning lens, the legend).
export const STATE_FILL: Record<TopicState, string> = {
  solid: 'var(--nova)', developing: 'var(--map-resource)', weak: 'var(--map-note)', unrated: 'var(--map-topic)',
  unstudied: 'var(--map-topic)', organising: 'var(--map-topic)', milestone: 'var(--nova)',
}
const LENS_KEY = 'kivo-map-lens', GUIDE_KEY = 'kivo-map-guide-closed'
const readKey = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }
const writeKey = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* this visit only */ } }
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : day(iso)
}

export function KnowledgeMap({ view, onChanged, onWorkspace, pendingScope = null }: { view: NovaKnowledgeMapReady; onChanged: () => void; onWorkspace?: (id: string) => void; pendingScope?: string | null }) {
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
  // Depth and motion: the learner's choice on this device (Show menu), and
  // the entrance being played, if any (depth.ts).
  const [motion, setMotion]     = useState<Motion>(() => chosenMotion(store))
  const [entrance, setEntrance] = useState<(Entrance & { mode: Exclude<EntranceMode, 'none'>; key: string }) | null>(null)
  // Cards and lines that arrived in this visit (an add, a link), and a card
  // just deleted here, drawn leaving while the map is read again.
  const [fresh, setFresh]       = useState<{ nodes: Set<string>; edges: Set<string> } | null>(null)
  const [ghost, setGhost]       = useState<{ node: MapNode; x: number; y: number } | null>(null)
  const [removed, setRemoved]   = useState<Set<string>>(new Set())
  // A card found by search, lit for a moment where the view lands.
  const [flash, setFlash]       = useState<{ id: string; n: number } | null>(null)
  // Map 3.0: the lens (emphasis only), the card previewed under the pointer,
  // and the first-steps guide on a small map (closed for good once closed).
  const [lens, setLensState]    = useState<Lens>('structure')
  const [peek, setPeek]         = useState<string | null>(null)
  const [guideClosed, setGuideClosed] = useState(true)
  useEffect(() => {
    const l = readKey(LENS_KEY)
    if (l === 'learning' || l === 'gaps') setLensState(l)
    setGuideClosed(readKey(GUIDE_KEY) === '1')
  }, [])
  const setLens = useCallback((l: Lens) => { setLensState(l); writeKey(LENS_KEY, l) }, [])
  // Everything always opens with every item drawn (the full structure); the
  // overview (counts folded into cards, overview-density.ts) is a choice for
  // this visit only.
  const [density, setDensity] = useState<Density>('all')
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
  // Everything, not explored, not scoped: an overview (overview-density.ts).
  // A workspace's own map, and any card explored, draw every item as before.
  // The whole map: not a workspace's own, nothing explored or scoped.
  const wholeMap = !view.workspaceId && current(stack).focus === null && !inScope
  const overviewOn = wholeMap && density === 'overview'
  const dens = useMemo(() => (overviewOn ? overviewDensity(view.nodes, tree.parent) : null), [overviewOn, view.nodes, tree.parent])
  // What search reaches: everything the filters leave, folded or not.
  const searchable = useMemo(() => view.nodes.filter(n => !removed.has(n.id) && shown[n.type] && (subject === '' || n.subjectId === subject) && (!inScope || inScope.has(n.id))), [view.nodes, removed, shown, subject, inScope])
  const nodes = useMemo(() => view.nodes.filter(n => !removed.has(n.id) && !dens?.hidden.has(n.id) &&
    shown[n.type] && !folded.has(n.id) && (subject === '' || n.subjectId === subject) && (!inScope || inScope.has(n.id))), [view.nodes, shown, folded, subject, inScope, removed, dens])
  // What arrived since the map was last read (an add, a link), so it can
  // come in on its own. The first reading is the entrance's, not this.
  const known = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null)
  useEffect(() => {
    const now = { nodes: new Set(view.nodes.map(n => n.id)), edges: new Set(view.edges.map(e => e.id)) }
    const before = known.current
    known.current = now
    setRemoved(r => (r.size ? new Set() : r))
    if (!before) return
    const nodes = new Set([...now.nodes].filter(id => !before.nodes.has(id)))
    const edges = new Set([...now.edges].filter(id => !before.edges.has(id)))
    if (nodes.size || edges.size) setFresh({ nodes, edges })
  }, [view.nodes, view.edges])
  useEffect(() => {
    if (!fresh) return
    const id = window.setTimeout(() => setFresh(null), FRESH_MS)
    return () => window.clearTimeout(id)
  }, [fresh])
  useEffect(() => {
    if (!ghost) return
    const id = window.setTimeout(() => setGhost(null), GHOST_MS)
    return () => window.clearTimeout(id)
  }, [ghost])
  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(() => setFlash(null), 1600)
    return () => window.clearTimeout(id)
  }, [flash])
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
  // The address says which card is explored, so a reload opens there again,
  // and each card gone into is a step in the browser's history: its Back and
  // Forward (and a mouse's or trackpad's) move between the levels as the
  // map's own Back does. A step the browser made is not written again.
  // Going into a card adds a step (kivoPrev: the level it came from); going
  // out (Back, Up, a breadcrumb) goes back through that step when it is the
  // one before, else replaces this step, so browser Back never lands inside
  // a card the learner just left.
  const fromHistory = useRef<string | null | undefined>(undefined)
  const replaceNext = useRef(false)
  const prevFocus = useRef<string | null>(null)
  useEffect(() => {
    const was = prevFocus.current
    prevFocus.current = focus
    if (!focusApplied.current) return
    const url = new URL(window.location.href)
    if (focus) url.searchParams.set('explore', focus); else url.searchParams.delete('explore')
    if (fromHistory.current !== undefined) { const popped = fromHistory.current; fromHistory.current = undefined; if (popped === focus) return }
    if (url.toString() === window.location.href) { replaceNext.current = false; return }
    const state = window.history.state ?? {}
    if (replaceNext.current) { replaceNext.current = false; window.history.replaceState({ ...state, kivoMap: focus ?? null }, '', url.toString()); return }
    window.history.pushState({ ...state, kivoMap: focus ?? null, kivoPrev: was }, '', url.toString())
  }, [focus])
  // Out to the level `target` (null: the whole map): through the browser's
  // own Back when its step before is exactly that level, else in place.
  const leaveTo = useCallback((target: string | null, apply: () => void) => {
    const st = window.history.state
    if (st && 'kivoMap' in st && 'kivoPrev' in st && st.kivoPrev === target) { window.history.back(); return }
    replaceNext.current = true
    apply()
  }, [])
  const treeNow = useRef(tree)
  treeNow.current = tree
  useEffect(() => {
    const onPop = () => {
      const ex = new URLSearchParams(window.location.search).get('explore')
      fromHistory.current = ex
      setStack(s => {
        if (!ex) return [s[0]!]
        const at = s.findIndex(l => l.focus === ex)
        if (at >= 0) return s.slice(0, at + 1)
        return canExplore(treeNow.current, ex) ? enter(s, ex, null) : s
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
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

  // The selected card and what it is joined to (the depth effects use this, not hover).
  const chosenAround = useMemo(() => {
    if (!selected) return null
    const set = new Set<string>([selected])
    for (const e of view.edges) { if (e.from === selected) set.add(e.to); if (e.to === selected) set.add(e.from) }
    return set
  }, [selected, view.edges])

  // ── The view: pan and zoom ─────────────────────────────────────────────────
  const tNow = useRef(t)
  useEffect(() => { tNow.current = t }, [t])
  const anim = useRef<number | null>(null)
  const stopAnim = useCallback(() => { if (anim.current !== null) cancelAnimationFrame(anim.current); anim.current = null }, [])
  // While the view moves (a drag, the wheel, a glide), the cards' lift
  // transitions are off: kept on, every card's is checked on every frame,
  // and a large map pans at half speed. Set on the element, not in state,
  // so moving renders nothing extra.
  const moving = useRef<number | null>(null)
  const startMoving = useCallback((ms?: number) => {
    root.current?.classList.add('map-moving')
    if (moving.current !== null) window.clearTimeout(moving.current)
    moving.current = ms === undefined ? null : window.setTimeout(() => { root.current?.classList.remove('map-moving'); moving.current = null }, ms)
  }, [])
  const stopMoving = useCallback(() => startMoving(120), [startMoving])
  // Eased: the point at the centre of the screen glides, and the zoom changes
  // by the same proportion each frame, so going in reads as a zoom into it.
  // Like a camera: a short move is quick, a long one or a big change of zoom
  // takes longer (never over 0.7 s), easing in and out. Calm: at once.
  const animateTo = useCallback((to: View, minMs?: number) => {
    stopAnim()
    const el = frame.current
    if (!el || reducedMotion() || motion === 'reduced') { setT(to); return }
    const from = tNow.current, cw = el.clientWidth / 2, ch = el.clientHeight / 2
    const a = { x: (cw - from.x) / from.k, y: (ch - from.y) / from.k }, b = { x: (cw - to.x) / to.k, y: (ch - to.y) / to.k }
    const travel = Math.hypot((b.x - a.x) * to.k, (b.y - a.y) * to.k), zoom = Math.abs(Math.log(to.k / from.k))
    const ms = Math.max(minMs ?? 0, Math.min(700, 240 + travel * 0.3 + zoom * 260))
    const start = performance.now()
    startMoving(ms + 120)
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms), e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
      const k = from.k * (to.k / from.k) ** e
      const cx = a.x + (b.x - a.x) * e, cy = a.y + (b.y - a.y) * e
      setT(p === 1 ? to : { k, x: cw - cx * k, y: ch - cy * k })
      anim.current = p < 1 ? requestAnimationFrame(step) : null
    }
    anim.current = requestAnimationFrame(step)
  }, [stopAnim, startMoving, motion])

  // The details panel covers the right of a wide canvas: fit beside it.
  const besidePanel = useCallback((el: HTMLElement) => (selected && detailOpen && el.clientWidth >= 1024 ? 372 : 0), [selected, detailOpen])
  // The Gaps list covers the left of the canvas (from 640px): a card is centred in the room beside it.
  const besideLeft = useCallback((el: HTMLElement) => (lens === 'gaps' && el.clientWidth >= 640 ? 300 : 0), [lens])
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
    // The subjects' regions reach past their cards, and far out each carries
    // a label above it: both are kept on screen (before, a far-out fit cut
    // the subjects' names off at the edge).
    const pad = 44, H = el.clientHeight
    const bw = w + pad * 2, bh = h + pad * 2
    let top = 0
    let k = Math.max(MIN_K, Math.min(1.1, Math.min(room / bw, H / bh)))
    if (detailAt(k) === 0) { top = 44; k = Math.max(MIN_K, Math.min(1.1, Math.min(room / bw, (H - top) / bh))) }
    return round({ k, x: room / 2 - ((minX + maxX) / 2) * k, y: top + (H - top) / 2 - ((minY + maxY) / 2) * k })
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
  // While the opening camera glides out (below), nothing settles the view under it.
  const cameraEntrance = useRef(false)
  settle.current = (animated: boolean) => {
    if (cameraEntrance.current) return
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

  // ── The entrance ───────────────────────────────────────────────────────────
  // Played once the saved layout is in (or after a short wait for it), so no
  // card arrives and then jumps: subjects, then what hangs from them, then
  // the lines. Full whenever the map is opened (Everything or a workspace),
  // brief going into a card, none in Calm or under reduced motion.
  // Nothing waits on it: every card can be clicked from the first frame.
  const [layoutWait, setLayoutWait] = useState(true)
  useEffect(() => {
    if (layout.load !== 'loading') { setLayoutWait(false); return }
    const id = window.setTimeout(() => setLayoutWait(false), 700)
    return () => window.clearTimeout(id)
  }, [layout.load])
  const entered = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (layoutWait || entered.current === where) return
    const first = entered.current === null
    entered.current = where
    const session = sessionStore()
    const calm = reducedMotion() || motion === 'reduced'
    // Opening the map (Everything or a workspace) always plays the full
    // entrance; going into a card, the brief one. Calm and reduced motion: none.
    const top = focus === null
    const mode = calm ? 'none' : top ? entranceMode({ seen: false, reduced: calm, motion, count: Math.min(drawn.length, 400) }) : first ? entranceMode({ seen: enteredBefore(session, where), reduced: calm, motion, count: drawn.length }) : 'brief'
    markEntered(session, where)
    if (mode === 'none') { setEntrance(null); return }
    const plan = entrancePlan(drawn.map(n => n.id), tree.parent, placed.at, [...drawnEdges, ...cross.map(c => c.edge)], mode)
    setEntrance({ ...plan, mode, key: where })
    // Opening the map: the camera starts close on its middle and glides out to
    // the whole of it while the cards arrive, ending on the fitted view.
    const to = mode === 'full' && top ? fitTarget() : null
    const el = frame.current
    if (to && el) {
      const cw = (el.clientWidth - besidePanel(el)) / 2, ch = el.clientHeight / 2
      const mid = { x: (cw - to.x) / to.k, y: (ch - to.y) / to.k }
      const k0 = Math.min(1.1, to.k * 2.1)
      cameraEntrance.current = true
      stopAnim()
      setT({ k: k0, x: cw - mid.x * k0, y: ch - mid.y * k0 })
      requestAnimationFrame(() => animateTo(to, CAMERA_MS))
      window.setTimeout(() => { cameraEntrance.current = false }, CAMERA_MS + 200)
    }
  // Only a new place starts an entrance; what it draws is read as it stands then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, layoutWait])
  useEffect(() => {
    if (!entrance) return
    const id = window.setTimeout(() => setEntrance(null), entrance.total + 80)
    return () => window.clearTimeout(id)
  }, [entrance])
  const changeMotion = (m: Motion) => { setMotion(m); chooseMotion(store, m); if (m === 'reduced') setEntrance(null) }

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
      startMoving(160)
      const b = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - b.left, e.clientY - b.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, startMoving])

  const centreOn = useCallback((id: string, k?: number) => {
    const p = placed.at.get(id) ?? markers.get(id)
    const el = frame.current
    if (!p || !el) return
    const kk = k ?? tNow.current.k
    const left = besideLeft(el)
    animateTo({ k: kk, x: left + (el.clientWidth - besidePanel(el) - left) / 2 - p.x * kk, y: el.clientHeight / 2 - p.y * kk }, 260)
  }, [placed, markers, animateTo, besidePanel, besideLeft])
  // Keeps a card reached by the keyboard on screen, moving the view only when it is not.
  const keepInView = useCallback((id: string) => {
    const p = placed.at.get(id)
    const el = frame.current
    if (!p || !el) return
    const v = tNow.current, sx = v.x + p.x * v.k, sy = v.y + p.y * v.k, m = 80
    if (sx < m + besideLeft(el) || sy < m || sx > el.clientWidth - m - besidePanel(el) || sy > el.clientHeight - m) centreOn(id)
  }, [placed, centreOn, besidePanel, besideLeft])

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
  // Back: to the view before on the map's own levels (out, never back into a
  // card just left), kept in step with the browser's history.
  const goBack = useCallback(() => {
    if (stack.length <= 1) return
    leaveTo(stack[stack.length - 2]!.focus, () => setStack(s => back(s)))
  }, [stack, leaveTo])
  const goUp = useCallback(() => {
    if (!focus) { say('You are on the whole map.'); return }
    const from = focus
    setSelected(from)
    leaveTo(current(up(stack, tree)).focus, () => setStack(s => up(s, tree)))
  }, [focus, tree, say, stack, leaveTo])
  // A breadcrumb: back to that view when it is open, else into that card.
  const goTo = useCallback((id: string | null) => {
    if (id === null) { leaveTo(null, () => setStack(s => [s[0]!])); return }
    const at = stack.findIndex(l => l.focus === id)
    if (at >= 0) leaveTo(id, () => setStack(s => s.slice(0, at + 1))); else explore(id)
  }, [stack, explore, leaveTo])
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
  // Ranked (map-search.ts): the name first, then a word in it, then what it is filed under.
  const found = useMemo(() => searchMap(searchable, query, 10), [query, searchable])
  // Every card the query matches is lit on the map while the learner types.
  const matchIds = useMemo(() => (query.trim() ? matchesOf(nodes, query) : null), [query, nodes])
  const labelOf = useCallback((id: string) => byId.get(id)?.label, [byId])
  // Each top-level subject's topics by state, all of them (folded or not).
  const subjectTallies = useMemo(() => {
    const groups = new Map<string, MapNode[]>()
    for (const n of view.nodes) { const r = rootOf(n.id, tree.parent); const l = groups.get(r); if (l) l.push(n); else groups.set(r, [n]) }
    return new Map([...groups].map(([r, list]) => [r, tallyOf(list)]))
  }, [view.nodes, tree.parent])
  // What a card sits inside, from the top, each one selectable.
  const ancestorsOf = useCallback((id: string) => {
    const out: Array<{ id: string; label: string }> = []
    for (let p = tree.parent.get(id), hops = 0; p && hops < 12; p = tree.parent.get(p), hops++) out.unshift({ id: p, label: byId.get(p)?.label ?? '' })
    return out
  }, [tree.parent, byId])
  // What the lens points at, among the cards drawn; the search wins while typing.
  const lensIds = useMemo(() => lensTargets(lens, drawn), [lens, drawn])
  const emphasis = matchIds ?? lensIds
  // The gaps on this map, the ones to act on first at the top.
  const gapList = useMemo(() => (lens !== 'gaps' ? [] : drawn.filter((n): n is Extract<MapNode, { type: 'topic' }> => n.type === 'topic' && gapsOf(n).length > 0)
    .sort((a, b) => gapRank(a) - gapRank(b) || (placed.at.get(a.id)?.y ?? 0) - (placed.at.get(b.id)?.y ?? 0))), [lens, drawn, placed])
  const gapCount = useMemo(() => drawn.reduce((c, n) => c + (n.type === 'topic' && gapsOf(n).length > 0 ? 1 : 0), 0), [drawn])
  // A preview of the card under the pointer, after a short rest on it.
  useEffect(() => {
    if (!hover || dragAt) { setPeek(null); return }
    const id = window.setTimeout(() => setPeek(hover), 380)
    return () => window.clearTimeout(id)
  }, [hover, dragAt])
  const [foundAt, setFoundAt] = useState(0)
  useEffect(() => setFoundAt(0), [query])
  const pick = useCallback((id: string) => {
    setQuery('')
    pendingSelect.current = null
    setFlash(f => ({ id, n: (f?.n ?? 0) + 1 }))
    if (drawnIds.has(id)) { select(id, { centre: true, focusCard: true }); return }
    // Folded into the overview: go into its subject, where every item is drawn, and select it there.
    if (dens?.hidden.has(id)) {
      const root = rootOf(id, tree.parent)
      if (root !== id && canExplore(tree, root)) { revealCard(id); explore(root); pendingSelect.current = id; return }
    }
    goOutside(id)
  }, [drawnIds, select, goOutside, dens, tree, revealCard, explore])

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
  // A card just deleted leaves where it stood, and is not drawn while the map is read again.
  const leave = useCallback((n: MapNode) => {
    const p = placed.at.get(n.id)
    if (p && !reducedMotion() && motion === 'full') setGhost({ node: n, x: p.x, y: p.y })
    setRemoved(r => new Set(r).add(n.id))
  }, [placed, motion])
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
        if (selected) { act(); setSelected(null); lastChosen.current = null; frame.current?.focus({ preventScroll: true }); return }
        // Nothing open or selected: out of the explored card, one level.
        if (focus && stack.length > 1) { act(); goBack(); return }
        return
      case 'lens': {
        act()
        const l = nextLens(lens)
        setLens(l)
        const hint = LENSES.find(x => x.id === l)!.hint
        say(`${LENSES.find(x => x.id === l)!.label} lens: ${hint[0]!.toLowerCase()}${hint.slice(1)}.`)
        return
      }
      case 'next': {
        act()
        // The next match while searching, else the next gap (Gaps) or studied topic (Learning).
        const reading = (a: string, b: string) => (placed.at.get(a)?.y ?? 0) - (placed.at.get(b)?.y ?? 0) || (placed.at.get(a)?.x ?? 0) - (placed.at.get(b)?.x ?? 0)
        const order = matchIds ? found.map(n => n.id).filter(id => drawnIds.has(id))
          : lens === 'gaps' ? gapList.map(n => n.id)
          : lensIds ? [...lensIds].sort(reading) : []
        if (!order.length) { say(matchIds ? 'Nothing found here.' : lens === 'gaps' ? 'No gaps on this map.' : 'G goes to the next gap or match: press L for the Gaps lens, or / to search.'); return }
        const to = order[(order.indexOf(selected ?? '') + 1) % order.length]!
        setFlash(f => ({ id: to, n: (f?.n ?? 0) + 1 }))
        select(to, { centre: true, focusCard: true })
        return
      }
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
        // Every card drawn, where it is: the arrows go by position on screen.
        const boxes = new Map<string, NavBox>()
        for (const n of drawn) { const p = placed.at.get(n.id); if (p) boxes.set(n.id, { x: p.x, y: p.y, ...CARD[n.type] }) }
        if (!target || !drawnIds.has(target)) {
          // Nothing selected: start from the card in the middle of the view.
          const el = frame.current
          const mid = el ? { x: (el.clientWidth / 2 - t.x) / t.k, y: (el.clientHeight / 2 - t.y) / t.k } : { x: 0, y: 0 }
          const start = nearestTo(mid, boxes)
          if (start) { pendingSelect.current = null; select(start, { focusCard: true }); keepInView(start) }
          return
        }
        const res = navigate(target, k.arrow, boxes)
        if (res.to !== null) { pendingSelect.current = null; lastChosen.current = res.to; select(res.to, { focusCard: true }); keepInView(res.to) } else say(res.why)
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
        if (dens && (tree.children.get(target) ?? []).every(c => dens.hidden.has(c))) { say('What is inside is folded into the overview. Enter opens it.'); return }
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
  const detail: CardDetail = detailAt(t.k)
  const textScale = 1 / Math.max(t.k, 0.0001)
  // "Recent" is judged against when the map was read.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read again with each new reading of the map
  const now = useMemo(() => new Date(), [view])
  const focusId = hover ?? selected
  // A card outside an explored one is drawn at its marker, not where it sits on the whole map.
  const pointOf = useCallback((id: string) => markers.get(id) ?? placed.at.get(id), [placed, markers])

  // Lines between cards, and the cross-links to markers. Memoised apart from
  // the pan, which only moves the group they sit in.
  const allLines = useMemo(() => [...drawnEdges, ...cross.map(c => c.edge)], [drawnEdges, cross])
  // How deep a card sits in the tree drawn: lines further from a subject are
  // drawn lighter, so the eye reads the levels as layers.
  const depthOf = useCallback((id: string) => {
    let d = 0
    for (let p = tree.parent.get(id); p && drawnIds.has(p) && d < 12; p = tree.parent.get(p)) d++
    return d
  }, [tree, drawnIds])
  // The selected card's way back to its subject lights with it: what it sits
  // in, and what that sits in, as one path.
  const litPath = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (let p = tree.parent.get(focusId), hops = 0; p && hops < 24; p = tree.parent.get(p), hops++) set.add(p)
    return set
  }, [focusId, tree.parent])
  const edgeLayer = useMemo(() => allLines.map(e => {
    const a = pointOf(e.from), b = pointOf(e.to)
    if (!a || !b) return null
    const lit = focusId !== null && (e.from === focusId || e.to === focusId || (litPath !== null && litPath.has(e.from) && litPath.has(e.to)))
    // Every [[link]] and wait is drawn, at every zoom, with every item. Only
    // the overview the learner chooses (compact: counts folded into cards)
    // leaves them to the card in focus, with subjects' links between them.
    if (!lit && (e.kind === 'links_to' || e.kind === 'depends_on') && overviewOn) return null
    const dim = (focusId !== null && !lit) || (focusId === null && emphasis !== null && !emphasis.has(e.from) && !emphasis.has(e.to))
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
    // Arriving: drawn along its length once both its cards are there (a
    // dashed line, whose dashes would be lost, fades in instead).
    const delay = entrance?.edge.get(e.id) ?? (fresh?.edges.has(e.id) ? 160 : undefined)
    const dashed = e.kind === 'depends_on' || e.kind === 'filed_under'
    const arrive = delay === undefined ? undefined : dashed ? 'map-edge-fade' : 'map-edge-draw'
    const anim = delay === undefined ? undefined : { animationDelay: `${delay}ms`, animationDuration: `${entrance?.mode === 'brief' ? EDGE_MS.brief : EDGE_MS.full}ms` }
    const drawProps = arrive === 'map-edge-draw' ? { pathLength: 1 } : {}
    let d: string, stroke: string, width: number, dash: string | undefined, rest = 1
    if (e.kind === 'depends_on') {
      // A wait: from the task that waits to the one it waits for, dashed in the tasks' colour.
      d = `M ${a.x} ${a.y} Q ${mx + dy * 0.22} ${my - dx * 0.22} ${b.x} ${b.y}`
      stroke = lit ? 'var(--action)' : 'var(--map-task)'; width = lit ? 1.8 : 1.2; dash = '6 4'; rest = 0.8
    } else if (e.kind === 'links_to') {
      // A [[link]]: a quiet curve; the ring where it arrives says what it is.
      d = `M ${a.x} ${a.y} Q ${mx - dy * 0.18} ${my + dx * 0.18} ${b.x} ${b.y}`
      stroke = lit ? 'var(--action)' : 'var(--map-line-strong)'; width = lit ? 1.6 : 1.1
    } else {
      // Into a wrapped column: along the gaps, never across the cards before it.
      const lane = placed.lanes?.get(e.to)
      const laned = lane && lane.x === b.x && lane.y === b.y && !markers.has(e.to)
      // A branch flows out of its card and into the next, level at both ends;
      // in the outline (one card under another) it is the plain line.
      const flow = Math.abs(b.x - a.x) > 60
      d = laned ? roundedLane(a, lane, b)
        : flow ? `M ${a.x} ${a.y} C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
      // In its subject's colour, so each subject's branches read as its own.
      stroke = lit ? 'var(--action)' : 'color-mix(in oklch, var(--sc) 62%, var(--map-line-strong))'
      width = lit ? 2.2 : laned ? 1.3 : e.kind === 'contains' ? 2.2 : e.kind === 'has_topic' ? 1.8 : e.kind === 'subtopic' ? 1.5 : 1.1
      dash = e.kind === 'filed_under' ? '5 4' : undefined
      // Deeper in the tree, lighter: never under 55%.
      rest = Math.max(0.45, 0.85 - Math.max(0, depthOf(e.to) - 1) * 0.14)
    }
    // Far out the tree's lines are thin and plain: dashes at that size read as noise.
    if (detail === 0 && !lit) { dash = undefined; width = Math.min(width, 1); rest = Math.min(rest, 0.55) }
    const toNode = byId.get(e.to)
    // The neuron touch on the tree's own lines: a faint fibre of the subject's
    // colour under the line, a synapse where it meets its card, and on a
    // subject's own branches a slow signal travelling out (motion only).
    const tree_ = TREE_EDGES.has(e.kind) && !d.includes(' H ')
    const dir = Math.sign(b.x - a.x) || 1
    const port = tree_ && toNode && !markers.has(e.to) ? { x: b.x - dir * (CARD[toNode.type].w / 2 + 2), y: b.y } : null
    const signal = tree_ && !dim && (e.kind === 'has_topic' || e.kind === 'contains')
    return (
      <g key={e.id} className={cn('subject-tone', arrive)} style={{ ...toneStyle(toNode?.type === 'subject' ? toNode.label : toNode?.subjectName ?? null), ...anim }}>
        {tree_ && !lit && <path d={d} fill="none" stroke="var(--sc)" strokeWidth={6} strokeLinecap="round" opacity={dim ? 0.02 : 0.085} vectorEffect="non-scaling-stroke" className="pointer-events-none" />}
        {signal && !lit && <path d={d} fill="none" className="map-signal pointer-events-none" stroke="var(--sc)" strokeWidth={2} strokeDasharray="2 34" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.7} style={{ animationDelay: `${(e.id.length * 137) % 2400}ms` }} />}
        {port && (
          <g className="pointer-events-none" opacity={dim ? 0.25 : 1}>
            <circle cx={port.x} cy={port.y} r={6} fill={lit ? 'var(--action)' : 'var(--sc)'} opacity={0.18} />
            <circle cx={port.x} cy={port.y} r={2.6} fill={lit ? 'var(--action)' : 'var(--sc)'} />
          </g>
        )}
        {/* A lit line glows, so what the selected card joins reads at a glance. */}
        {lit && <path d={d} fill="none" stroke="var(--action)" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={0.16} vectorEffect="non-scaling-stroke" {...drawProps} />}
        <path d={d} fill="none" data-edge={e.kind} data-lane={d.includes(' H ') && e.kind !== 'links_to' && e.kind !== 'depends_on' ? '' : undefined}
          stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          opacity={dim ? (e.kind === 'depends_on' ? 0.2 : 0.25) : rest} {...drawProps} />
        {/* What the selection joins: a quiet pulse travelling along the line. */}
        {lit && !arrive && <path d={d} fill="none" className="map-edge-flow" stroke="var(--action)" strokeWidth={2.4} strokeDasharray="1.5 11" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.95} />}
      </g>
    )
  }), [allLines, pointOf, focusId, placed.lanes, markers, entrance, fresh, depthOf, detail, emphasis, overviewOn, litPath, byId])

  // The rings of [[links]], over the cards: one where each link arrives.
  const ringLayer = useMemo(() => allLines.filter(e => e.kind === 'links_to' && (!overviewOn || (focusId !== null && (e.from === focusId || e.to === focusId)))).map(e => {
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
  }), [allLines, pointOf, byId, markers, focusId, overviewOn])

  const suggestionLayer = useMemo(() => (overviewOn ? [] : suggestions).map(s => {
    const a = placed.at.get(s.from), b = placed.at.get(s.to)
    if (!a || !b) return null
    const lit = focusId !== null && (s.from === focusId || s.to === focusId)
    return (
      <line key={s.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-suggestion={s.confidence}
        stroke={lit ? 'var(--action)' : 'var(--map-line-strong)'}
        strokeWidth={1.2} strokeDasharray="1 6" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        opacity={focusId !== null && !lit ? 0.15 : 0.8} />
    )
  }), [suggestions, placed, focusId, overviewOn])

  // The cards. Memoised apart from the pan; the zoom only changes them when
  // it crosses into another level of detail.
  // Which way a card's tree grows: on the left of its subject, leftward.
  const outer = useCallback((id: string) => (placed.left?.has(id) ? -1 : 1), [placed.left])
  const nodeLayer = useMemo(() => drawn.map(n => {
    const p = placed.at.get(n.id)
    if (!p) return null
    const { w, h } = CARD[n.type]
    const dim = neighbourIds !== null && !neighbourIds.has(n.id)
    // A lens or a search sets the rest back (never hides it).
    const faded = !dim && emphasis !== null && !emphasis.has(n.id) && selected !== n.id
    const on  = selected === n.id
    const dragging = dragAt?.id === n.id
    const tone = n.type === 'subject' ? n.label : n.subjectName
    const kids = tree.children.get(n.id)?.length ?? 0
    // Depth (depth.ts): the card's slab, its shadow on the ground, and where
    // it is in the entrance or arriving after an add.
    const th = thicknessOf(n), r = radiusOf(n)
    // Raised and receded by the selection only: a hover lifts just its own
    // card (CSS), so sweeping the pointer over the map starts no transitions.
    const near = chosenAround !== null && chosenAround.has(n.id)
    const recede = chosenAround !== null && !chosenAround.has(n.id)
    const delay = entrance?.node.get(n.id)
    const arriving = delay !== undefined ? (entrance!.mode === 'full' ? 'map-card-in' : 'map-card-in-brief') : fresh?.nodes.has(n.id) ? 'map-card-new' : undefined
    return (
      <g
        key={n.id} transform={`translate(${p.x} ${p.y})`} style={{ ...toneStyle(tone), opacity: dim ? 0.38 : faded ? 0.3 : 1 }} data-emphasis={emphasis?.has(n.id) ? '' : undefined}
        role="button" tabIndex={0} aria-label={`${TYPE_LABEL[n.type]}: ${n.label}${kids ? `, ${kids} inside` : ''}`} aria-pressed={on}
        aria-keyshortcuts="Enter Shift+Enter Space N Delete Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        className={cn('map-card subject-tone group/card outline-none [&:focus-visible_.map-focus]:opacity-100', dragging ? 'cursor-grabbing' : 'cursor-pointer')}
        data-node={n.type} data-node-id={n.id} data-depth-thickness={th}
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
        <g className={arriving} style={arriving ? { animationDelay: `${delay ?? 0}ms` } : undefined}>
          {/* The shadow it casts, softer the higher it stands; then its edge (the slab). */}
          {/* Far out it can't be seen: not drawn, so zooming stays light on a large map. */}
          {/* A subject anchor glows softly in its colour, so the eye finds the anchors first. */}
          {n.type === 'subject' && (
            <g className="map-anchor-glow pointer-events-none">
              <rect x={-w / 2 - 18} y={-h / 2 - 16} width={w + 36} height={h + 32} rx={32} fill="var(--sc)" opacity={0.03} />
              <rect x={-w / 2 - 9} y={-h / 2 - 8} width={w + 18} height={h + 16} rx={24} fill="var(--sc)" opacity={0.05} />
            </g>
          )}
          {detail > 0 && <rect className="map-shadow" x={-w / 2 + 3} y={-h / 2 + th + 4} width={w - 6} height={h} rx={r + 2} opacity={0.13 + th * 0.018} />}
          {th > 0 && <rect className="map-slab" x={-w / 2} y={-h / 2 + th} width={w} height={h} rx={r} />}
          <g className={cn('map-lift', on || near || dragging ? 'map-raise' : recede ? 'map-recede' : undefined)}>
            {(on || dragging) && <rect x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="color-mix(in oklch, var(--action) 9%, transparent)" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {/* Selected: one soft pulse outward, then still. */}
            {on && !dragging && <rect className="map-select-pulse pointer-events-none" x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="none" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            <rect className="map-focus opacity-0" x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="none" stroke="var(--ring)" strokeWidth={2.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
            <g style={dragging ? { filter: 'drop-shadow(0 10px 18px rgb(0 0 0 / 0.25))' } : undefined}><CardFace n={n} detail={detail} folded={overviewOn ? (dens && foldedTotal(dens.folded.get(n.id)) > 0 ? foldedLabel(dens.folded.get(n.id)!) : '') : undefined} /></g>
            {n.type === 'topic' && <TopicMarks n={n} detail={detail} lens={lens} now={now} />}
            {/* Light on its surface, from above. */}
            {detail > 0 && <rect className="pointer-events-none" x={-w / 2} y={-h / 2} width={w} height={h} rx={r} fill="url(#map-sheen)" />}
            {detail > 0 && <rect className="pointer-events-none" x={-w / 2} y={-h / 2} width={w} height={h} rx={r} fill="url(#map-shade)" />}
            {flash?.id === n.id && <rect key={flash.n} className="map-found pointer-events-none" x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} rx={r + 6} fill="none" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        </g>
        {/* Everything's overview: how many items are folded inside, on its outer
            edge (where a fold button sits); it opens by going in. What they are
            is said on the card's face. */}
        {dens && detail >= 1 && foldedTotal(dens.folded.get(n.id)) > 0 && (() => {
          const c = dens.folded.get(n.id)!, total = foldedTotal(c)
          const label = total > 99 ? '99+' : `+${total}`
          const r = label.length > 2 ? 12 : 10
          const at = n.type === 'subject' ? { x: 0, y: h / 2 + th } : { x: (outer(n.id)) * (w / 2), y: 0 }
          return (
            <g transform={`translate(${at.x} ${at.y})`} role="button" tabIndex={-1} aria-label={`${foldedLabel(c)} inside ${n.label}. Open it to see them.`} data-folded={n.id}
              className="map-chip cursor-pointer" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (canExplore(tree, n.id)) explore(n.id) }}>
              <title>{`${foldedLabel(c)}: open ${n.label} to see them`}</title>
              <rect x={-r - 2} y={-10} width={2 * r + 4} height={20} rx={10} fill="var(--map-card)" stroke="var(--map-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text textAnchor="middle" y={3.6} fontSize={10} fontWeight={650} className="fill-[var(--subtle)]">{label}</text>
            </g>
          )
        })()}
        {/* A subject's progress at a glance, along its card's foot: its topics by state, all of them. */}
        {overviewOn && n.type === 'subject' && detail >= 1 && (() => {
          const tl = subjectTallies.get(n.id)
          if (!tl || tl.topics === 0) return null
          const bw = w - 68, x0 = -w / 2 + 34, y0 = h / 2 - 12
          const segs: Array<[number, string]> = [[tl.solid, 'var(--nova)'], [tl.developing, 'var(--map-resource)'], [tl.weak, 'var(--map-note)'], [tl.studied - tl.solid - tl.developing - tl.weak, 'var(--map-topic)']]
          let at = x0
          return (
            <g className="pointer-events-none" data-subject-progress={n.id}>
              <rect x={x0} y={y0} width={bw} height={3} rx={1.5} fill="var(--map-line)" />
              {segs.map(([count, fill], i) => { if (count <= 0) return null; const sw = (bw * count) / tl.topics; const r = <rect key={i} x={at} y={y0} width={sw} height={3} rx={1.5} fill={fill} />; at += sw; return r })}
            </g>
          )
        })()}
        {kids > 0 && detail >= 1 && !(dens && (tree.children.get(n.id) ?? []).every(c => dens.hidden.has(c))) && (
          // Fold or show what hangs from it.
          <g transform={`translate(${outer(n.id) * (w / 2)} 0)`} role="button" tabIndex={-1} aria-label={collapsed.has(n.id) ? `Show what is inside ${n.label}` : `Fold what is inside ${n.label}`} data-fold={collapsed.has(n.id) ? 'folded' : 'open'}
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
  }), [drawn, placed, neighbourIds, selected, dragAt, detail, onCardPointerDown, onCardPointerMove, onCardPointerUp, onCardPointerCancel, tree, collapsed, insideCount, toggleFold, select, explore, openAdd, entrance, fresh, flash, chosenAround, emphasis, lens, now, dens, overviewOn, subjectTallies, outer])

  // The ground each subject's tree stands on, lit softly in its colour, and
  // what each holds (for the overview's labels).
  const regions = useMemo(() => {
    const list = regionsOf(drawn, tree.parent, placed.at)
    const rootOf = (id: string) => { let r = id; for (let p = tree.parent.get(r), hops = 0; p && drawnIds.has(p) && hops < 64; p = tree.parent.get(p), hops++) r = p; return r }
    const members = new Map<string, MapNode[]>()
    for (const n of drawn) { const r = rootOf(n.id); const l = members.get(r); if (l) l.push(n); else members.set(r, [n]) }
    return list.map(r => ({ ...r, tally: tallyOf(members.get(r.id) ?? []) }))
  }, [drawn, tree.parent, placed.at, drawnIds])
  // Zoom to a subject: its whole region on screen (a click on it far out).
  const zoomToRegion = useCallback((r: { x: number; y: number; w: number; h: number }) => {
    const el = frame.current
    if (!el) return
    animateTo(viewOfBox({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }, el.clientWidth - besidePanel(el), el.clientHeight, { maxK: 0.9, minK: MIN_K, pad: 24 }), 420)
  }, [animateTo, besidePanel])
  const regionLayer = useMemo(() => regions.map((r, i) => {
    const s = byId.get(r.id)
    const far = detail === 0
    return (
      <g key={`region-${r.id}`} className="subject-tone" style={toneStyle(s?.type === 'subject' ? s.label : null)} data-region={r.id}>
        <defs>
          <radialGradient id={`map-region-${i}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: 'var(--sc)', stopOpacity: far ? 0.09 : 0.07 }} />
            <stop offset="55%" style={{ stopColor: 'var(--sc)', stopOpacity: far ? 0.035 : 0.025 }} />
            <stop offset="100%" style={{ stopColor: 'var(--sc)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        {/* No walls between subjects, at any zoom: a soft light of its colour
            where its branches spread, fading out with no edge, so the map
            reads as one architecture. */}
        <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w * 0.62} ry={r.h * 0.62} fill={`url(#map-region-${i})`} />
      </g>
    )
  }), [regions, byId, detail, overviewOn])
  // Far out, each subject's plate, over its cards (drawn after them).
  const regionLabelLayer = useMemo(() => (detail !== 0 ? null : regions.map(r => {
    const s = byId.get(r.id)
    const far = true
    const ks = 1 / Math.max(t.k, 0.0001)
    const facts = [plural(r.tally.topics, 'topic'), r.tally.topics ? (r.tally.studied ? `${r.tally.studied} studied` : 'none studied yet') : null, r.tally.reviewDue ? `${r.tally.reviewDue} review${r.tally.reviewDue === 1 ? '' : 's'} due` : null, r.tally.notes ? plural(r.tally.notes, 'note') : null].filter(Boolean).join(' · ')
    return (
      <g key={`plate-${r.id}`} className="subject-tone" style={toneStyle(s?.type === 'subject' ? s.label : null)}>
        {far && s && (() => {
          // Far out, the subject's name and what it holds, on a plate inside
          // its own region (above it, stacked subjects' labels ran into each
          // other), cut to the region's width; a click goes to it.
          const wPx = r.w * t.k - 20, hPx = r.h * t.k
          if (wPx < 70 || hPx < 34) return null
          const title = short(s.label, Math.max(6, Math.floor((wPx - 30) / 8.8)))
          const line = hPx >= 76 ? short(facts, Math.max(8, Math.floor((wPx - 20) / 6.4))) : null
          const plateW = Math.min(wPx, Math.max(title.length * 8.8 + 34, (line?.length ?? 0) * 6.4 + 22))
          const plateH = line ? 48 : 30
          return (
            <g transform={`translate(${r.x + 10 * ks} ${r.y + 10 * ks}) scale(${ks})`} role="button" tabIndex={-1} aria-label={`${s.label}: ${facts}. Zoom to it.`} data-region-label={r.id}
              className="cursor-pointer" onPointerDown={e => e.stopPropagation()} onClick={() => zoomToRegion(r)} onDoubleClick={() => { if (canExplore(tree, r.id)) explore(r.id) }}>
              {/* No box: the name over a dark halo, so far out adds no coloured shapes. */}
              <rect width={plateW} height={plateH} fill="transparent" />
              <circle cx={14} cy={15} r={4.5} fill="var(--sc)" />
              <text x={25} y={20} fontSize={REGION_LABEL_PX.title} fontWeight={650} className="fill-foreground" style={{ fontFamily: 'var(--font-display)', paintOrder: 'stroke', stroke: 'var(--map-space-b)', strokeWidth: 5, strokeLinejoin: 'round' }}>{title}</text>
              {line && <text x={11} y={39} fontSize={REGION_LABEL_PX.line} className="fill-[var(--subtle)]" style={{ paintOrder: 'stroke', stroke: 'var(--map-space-b)', strokeWidth: 4, strokeLinejoin: 'round' }}>{line}</text>}
            </g>
          )
        })()}
      </g>
    )
  })), [regions, byId, detail, t.k, zoomToRegion, tree, explore, overviewOn])

  // Between subjects, in the overview: the [[links]] written from one subject's
  // items to another's, one line per pair with how many. Only links on record.
  const subjectLinkLayer = useMemo(() => {
    if (!overviewOn) return null
    // The strongest few, quietly; all of a subject's when it is in focus.
    const all = crossSubjectLinks(usable, tree.parent, id => byId.get(id)?.type === 'subject')
    const focusRoot = focusId ? rootOf(focusId, tree.parent) : null
    return all.filter((l, i) => i < 5 || l.a === focusRoot || l.b === focusRoot).map(l => {
      const a = placed.at.get(l.a), b = placed.at.get(l.b)
      if (!a || !b) return null
      const lit = focusRoot !== null && (focusRoot === l.a || focusRoot === l.b)
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
      const cx = mx - dy * 0.15, cy = my + dx * 0.15
      return (
        <g key={`xs-${l.a}-${l.b}`} data-subject-link={`${l.a}|${l.b}`} opacity={focusId !== null && !lit ? 0.2 : 1}>
          <path d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`} fill="none" stroke={lit ? 'var(--action)' : 'var(--nova)'} strokeWidth={lit ? 1.8 : 1} strokeDasharray="2 6" strokeLinecap="round" opacity={lit ? 0.85 : 0.35} vectorEffect="non-scaling-stroke">
            <title>{`${l.count} [[link${l.count === 1 ? '' : 's'}]] between ${byId.get(l.a)?.label} and ${byId.get(l.b)?.label}`}</title>
          </path>
          {lit && <g transform={`translate(${(mx + cx) / 2} ${(my + cy) / 2}) scale(${1 / Math.max(t.k, 0.3)})`}>
            <title>{`${l.count} [[link${l.count === 1 ? '' : 's'}]] between ${byId.get(l.a)?.label} and ${byId.get(l.b)?.label}`}</title>
            <circle r={10} fill="var(--card)" stroke="var(--nova)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text textAnchor="middle" y={3.8} fontSize={10.5} fontWeight={600} style={{ fill: 'var(--nova)' }}>{l.count}</text>
          </g>}
        </g>
      )
    })
  }, [overviewOn, usable, tree.parent, byId, placed.at, focusId, t.k])

  // The minimap's picture: every card drawn and each subject's ground, once per map.
  const miniCards = useMemo<MiniCard[]>(() => drawn.flatMap(n => {
    const p = placed.at.get(n.id)
    if (!p) return []
    const st = n.type === 'topic' ? topicState(n) : null
    return [{ id: n.id, x: p.x, y: p.y, ...CARD[n.type], fill: st && st !== 'unstudied' && st !== 'organising' ? STATE_FILL[st] : n.type === 'topic' ? 'var(--map-line-strong)' : FILL[n.type] }]
  }), [drawn, placed])
  const miniRegions = useMemo(() => regions.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, tone: byId.get(r.id)?.label ?? null })), [regions, byId])
  const miniBox = useMemo(() => {
    // What is drawn here: inside an explored card, its own box (with markers), not the whole map's.
    let { minX, minY, maxX, maxY } = bounds
    for (const r of regions) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h) }
    return { minX, minY, maxX, maxY }
  }, [bounds, regions])

  // A card deleted here, leaving where it stood while the map is read again.
  const ghostLayer = ghost ? (() => {
    const { w, h } = CARD[ghost.node.type]
    return (
      <g transform={`translate(${ghost.x} ${ghost.y})`} className="subject-tone pointer-events-none" aria-hidden style={toneStyle(ghost.node.type === 'subject' ? ghost.node.label : ghost.node.subjectName)}>
        <g className="map-card-out"><rect className="map-shadow" x={-w / 2 + 2} y={-h / 2 + 4} width={w - 4} height={h} rx={radiusOf(ghost.node)} opacity={0.2} /><CardFace n={ghost.node} detail={detail} /></g>
      </g>
    )
  })() : null

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
  const regionRoots = new Set(regions.map(r => r.id))
  const farLabels = detail === 0 ? drawn.filter(n => n.type === 'subject' && !regionRoots.has(n.id)).map(n => {
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
    <div ref={root} className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-card/60', motion === 'reduced' && 'map-still')} data-knowledge-map data-motion={motion}>
      {/* The toolbar: where you are, finding, and the view. Filters are folded into one menu. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-3 py-2">
        {(view.workspaces?.length ?? 0) > 0 && onWorkspace && (
          // One workspace's map at a time; everything together on request.
          // One workspace's map at a time; everything together on request. While
          // the next one loads, the choice shows what was asked for.
          <select value={pendingScope ?? view.workspaceId ?? 'all'} onChange={e => onWorkspace(e.target.value)} aria-label="Which map" data-workspace-switch aria-busy={pendingScope !== null}
            className={cn('h-8 max-w-[11rem] rounded-full border border-white/12 bg-background px-3 text-xs font-medium text-foreground outline-none focus-visible:border-ring sm:max-w-[14rem]', pendingScope !== null && 'animate-pulse')}>
            {view.workspaces!.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            <option value="all">Everything</option>
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
              <ul id="map-found" role="listbox" data-map-overlay className="absolute right-0 top-10 z-30 w-full min-w-80 overflow-hidden rounded-xl border border-white/10 bg-popover shadow-float">
                {found.map((n, i) => (
                  <li key={n.id} id={`map-found-${i}`} role="option" aria-selected={i === foundAt}>
                    <button type="button" tabIndex={-1} onClick={() => pick(n.id)} className={cn('flex w-full items-start gap-2.5 px-3 py-2 text-left text-xs text-foreground/85 hover:bg-white/6', i === foundAt && 'bg-white/6')}>
                      <span className="mt-1 inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[n.type] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{n.label}</span>
                        {/* Where it sits, so the jump is not a surprise. */}
                        <span className="block truncate text-[11px] text-subtle">{pathOf(n.id, tree.parent, labelOf).join(' › ') || (n.type === 'subject' ? 'A subject' : 'Not filed under anything')}</span>
                      </span>
                      <span className="mt-0.5 shrink-0 text-[11px] text-subtle">{inside && !drawnIds.has(n.id) ? 'Outside' : TYPE_LABEL[n.type]}</span>
                    </button>
                  </li>
                ))}
                <li className="border-t border-white/8 px-3 py-1.5 text-[11px] text-subtle" aria-hidden>{matchIds?.size ?? 0} on the map, lit · ↑↓ choose · Enter goes · G next</li>
              </ul>
            )}
          </div>

          <span role="status" className={cn('hidden text-xs tabular-nums xl:inline', saver.status === 'failed' ? 'text-red-400' : 'text-subtle')} data-layout-status={saver.status}>
            {layout.load === 'loading' ? 'Loading layout…' : saveText}
          </span>
          <div className="relative">
            <button type="button" onClick={() => setPanel(p => (p?.kind === 'filters' ? null : { kind: 'filters' }))} aria-expanded={panel?.kind === 'filters'} className={tool} data-filters-open>
              <SlidersHorizontal aria-hidden className="size-3.5" /> <span className="hidden sm:inline">View</span>{hidden > 0 && <span className="rounded-full bg-action-soft px-1.5 text-[10px] tabular-nums text-foreground">{hidden}</span>}
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
                {!view.workspaceId && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-subtle">Everything shows</span>
                    <div role="radiogroup" aria-label="What Everything shows" className="inline-flex rounded-full border border-white/10 p-0.5">
                      {(['overview', 'all'] as const).map(d => (
                        <button key={d} type="button" role="radio" aria-checked={density === d} data-density-choice={d} onClick={() => setDensity(d)}
                          className={cn('rounded-full px-2.5 py-1 text-xs font-medium', density === d ? 'bg-white/8 text-foreground' : 'text-subtle hover:text-foreground')}>
                          {d === 'overview' ? 'Overview' : 'Every item'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-subtle">Motion</span>
                  <div role="radiogroup" aria-label="Motion" className="inline-flex rounded-full border border-white/10 p-0.5">
                    {(['full', 'reduced'] as const).map(m => (
                      <button key={m} type="button" role="radio" aria-checked={motion === m} data-motion-choice={m}
                        onClick={() => changeMotion(m)} title={m === 'full' ? 'Cards arrive, lift and glide' : 'No entrance or movement; depth stays'}
                        className={cn('rounded-full px-2.5 py-1 text-xs font-medium', motion === m ? 'bg-white/8 text-foreground' : 'text-subtle hover:text-foreground')}>
                        {m === 'full' ? 'Full' : 'Calm'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-white/8 pt-3">
                  <button type="button" onClick={() => { setPanel(null); askReset() }} className={chip(false)} data-reset-layout title="Kivo's own layout, fitted to the screen">
                    <RotateCcw aria-hidden className="size-3" /> Reset layout
                  </button>
                  {view.workspaceId && (
                    // Out of the way, in a menu: one step deletes a whole map (it goes to Recently deleted).
                    <button type="button" onClick={() => setPanel({ kind: 'delete_map', workspaceId: view.workspaceId!, title: view.workspaces?.find(w => w.id === view.workspaceId)?.title ?? 'this map' })}
                      className={cn(chip(false), 'hover:border-red-400/50 hover:text-red-400')} title="Delete this whole map in one step" data-delete-map>
                      <Trash2 aria-hidden className="size-3.5" /> Delete this map…
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          {!view.workspaceId && (
            <button type="button" onClick={() => openAdd(null)} className={tool} data-new-subject title="A subject of its own">
              <Plus aria-hidden className="size-3.5" /> <span className="hidden sm:inline">New subject</span>
            </button>
          )}
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
        className="relative min-h-[20rem] flex-1 touch-none select-none overflow-hidden bg-background focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        tabIndex={0} role="group" aria-roledescription="map"
        aria-label={`Knowledge map${focus ? `, exploring ${byId.get(focus)?.label ?? ''}` : ''}. Arrow keys move the view or, with a card selected, between cards; plus and minus zoom; F fits; question mark lists every shortcut.`}
        onPointerDown={e => {
          stopAnim()
          startMoving()
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
        onPointerUp={e => { stopMoving(); pinch.current.delete(e.pointerId); const dd = drag.current; drag.current = null; if (dd && !dd.moved && pinch.current.size === 0) { setSelected(null); lastChosen.current = null; setPanel(p => (p?.kind === 'filters' || p?.kind === 'legend' ? null : p)) } }}
        onPointerCancel={e => { stopMoving(); pinch.current.delete(e.pointerId); drag.current = null }}
      >
        {/* The space the map stands in: a far plane of dots that moves slower
            than the cards (so the cards read as nearer), ambient light, and
            a vignette. Decoration only: nothing here can be pointed at. */}
        <div aria-hidden className="map-space pointer-events-none absolute inset-0" />
        {/* Ambient light, nearer than the dots and farther than the cards: it drifts a little with a pan (a transform, so nothing repaints). */}
        <div aria-hidden className="map-ambient pointer-events-none absolute -inset-[12%]"
          style={{ transform: `translate3d(${Math.max(-90, Math.min(90, t.x * 0.05))}px, ${Math.max(-70, Math.min(70, t.y * 0.05))}px, 0)` }} />
        {(() => {
          // Moved by a transform within one dot's spacing, so a pan repaints nothing.
          const S = Math.round(30 * (0.55 + 0.45 * Math.min(t.k, 1.6)))
          const off = (v: number) => (((v * 0.35) % S) + S) % S
          return (
            <div aria-hidden className="map-far-mask pointer-events-none absolute inset-0 overflow-hidden">
              <div className="map-far absolute" style={{ left: -S, top: -S, right: -S, bottom: -S, backgroundSize: `${S}px ${S}px`, transform: `translate3d(${off(t.x)}px, ${off(t.y)}px, 0)` }} />
            </div>
          )
        })()}
        {drawn.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-foreground/65">Nothing matches these filters{inScope ? ' around this item' : ''}. Turn one back on{inScope ? ', or show everything,' : ''} to see the map.</p>
        ) : (
          // The camera: on the first visit the map tilts up into place as it settles.
          <div className={cn('absolute inset-0', layoutWait && !entrance ? 'opacity-0' : entrance ? (entrance.mode === 'full' && entrance.key.endsWith('/root') ? 'map-cam-in' : 'map-cam-brief') : undefined)}>
          {/* A group, not an image: it holds the items a keyboard reaches. */}
          <svg className="absolute inset-0 size-full" role="group" aria-label={`${drawn.length} items and ${drawnEdges.length} links${markers.size ? `, ${markers.size} outside` : ''}`}>
            <defs>
              <linearGradient id="map-sheen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity={0.07} />
                <stop offset="45%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              {/* Toward a card's foot, a little shade: with the light from above, a surface with volume. */}
              <linearGradient id="map-shade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="55%" stopColor="#000" stopOpacity={0} />
                <stop offset="100%" stopColor="#000" stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
              <g key={focus ?? 'root'} className={entrance ? undefined : 'map-enter'}>
                <g className={entrance ? 'map-glow-in' : undefined}>{regionLayer}</g>
                {!inside && placed.loose && (
                  <text x={placed.loose.x - CARD.note.w / 2} y={placed.loose.y - 44} className="fill-[var(--subtle)]" fontSize={12 * Math.min(textScale, 2.5)}>Not filed under a subject</text>
                )}
                {subjectLinkLayer}
                {edgeLayer}
                {suggestionLayer}
                {nodeLayer}
                {ghostLayer}
                {regionLabelLayer}
                {markerLayer}
                {ringLayer}
                {farLabels}
              </g>
            </g>
          </svg>
          </div>
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
        {panel?.kind === 'delete' && (panel.node.type === 'subject'
          // A subject goes with everything inside it, in one step: no clearing it card by card first.
          ? <DeleteWholeDialog key={`del-${panel.node.id}`} target={{ subjectId: panel.node.subjectId ?? panel.node.id.slice('subject:'.length) }} title={panel.node.label} style={anchor(panel.node.id)} onClose={closePanel}
              onDeleted={said => { leave(panel.node); setSelected(null); goTo(null); afterEdit(said, null) }} />
          : <DeleteDialog key={`del-${panel.node.id}`} node={panel.node} edges={view.edges} tree={tree} style={anchor(panel.node.id)} onClose={closePanel}
              onDeleted={said => { leave(panel.node); if (selected === panel.node.id) setSelected(null); afterEdit(said, null) }} onStale={onChanged} />
        )}
        {panel?.kind === 'delete_map' && (
          <DeleteWholeDialog target={{ workspaceId: panel.workspaceId }} title={panel.title} style={{ left: '50%', top: 12, transform: 'translateX(-50%)' }} onClose={closePanel}
            onDeleted={said => { setSelected(null); goTo(null); setPanel(null); say(said); if (onWorkspace) onWorkspace('all'); else onChanged() }} />
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
        {/* Nova on the map: about what is on screen (Everything, a workspace, or the card
            explored). A card's own questions are asked from its panel (Ask). */}
        {panel?.kind === 'nova' && (() => {
          const explored = focus ? byId.get(focus) : null
          const scopeId = explored ? explored.id : view.workspaceId ? `map:${view.workspaceId}` : 'map'
          const scopeLabel = explored ? explored.label : view.workspaceId ? (view.workspaces?.find(w => w.id === view.workspaceId)?.title ?? 'this workspace') : 'Everything'
          return (
            <section aria-label="Nova on your map" data-map-overlay data-map-nova onPointerDown={e => e.stopPropagation()}
              className="map-inspector-in absolute bottom-14 left-3 z-20 flex max-h-[min(44rem,calc(100%-5rem))] w-[min(34rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-popover/95 shadow-float backdrop-blur">
              <header className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
                <Sparkles aria-hidden className="size-4 text-keppel-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Nova</p>
                  <p className="truncate text-xs text-subtle">Knows {explored ? `“${short(scopeLabel, 34)}” and what is inside it` : scopeLabel === 'Everything' ? 'your whole map' : `the map of ${short(scopeLabel, 30)}`}</p>
                </div>
                <button type="button" onClick={closePanel} aria-label="Close Nova" className="rounded-full p-1.5 text-subtle hover:bg-white/6 hover:text-foreground"><X className="size-4" /></button>
              </header>
              <div className="min-h-0 overflow-y-auto p-4">
                <TalkToNova roomy key={scopeId} aboutNode={scopeId}
                  about={explored ? `“${explored.label}” on my Knowledge Map` : 'my Knowledge Map'}
                  placeholder={explored ? `Ask about ${short(scopeLabel, 28)}…` : 'Ask about your map…'}
                  suggestions={askSuggestions(explored ?? null, explored ? (explored.type === 'subject' ? subjectTallies.get(explored.id) : undefined) : tallyOf(view.nodes), { overdue: overdueIn(view.nodes, explored ?? null) })} />
              </div>
            </section>
          )
        })()}

        <div className="absolute bottom-3 left-3 flex items-center gap-2" onPointerDown={e => e.stopPropagation()}>
          <button type="button" onClick={() => setPanel(p => (p?.kind === 'nova' ? null : { kind: 'nova' }))} aria-expanded={panel?.kind === 'nova'}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-keppel-400/30 bg-card/90 px-3 text-xs font-medium text-foreground/85 shadow-soft backdrop-blur hover:border-keppel-400/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" data-map-nova-open>
            <Sparkles aria-hidden className="size-3.5 text-keppel-400" /> Ask Nova
          </button>
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

        {/* The card under the pointer: its whole title, where it sits, its state. */}
        {peek && peek !== selected && drawnIds.has(peek) && !panel && !dragAt && (() => {
          const n = byId.get(peek), p = placed.at.get(peek), el = frame.current
          if (!n || !p || !el) return null
          const { h } = CARD[n.type]
          const sx = t.x + p.x * t.k, top = t.y + (p.y - h / 2) * t.k, bottom = t.y + (p.y + h / 2) * t.k
          const below = top < 150
          const lines = peekLines(n, pathOf(n.id, tree.parent, labelOf), now)
          return (
            <div role="tooltip" data-map-peek className="pointer-events-none absolute z-20 w-72 -translate-x-1/2 rounded-xl border border-white/10 bg-popover/95 px-3.5 py-2.5 shadow-float backdrop-blur"
              style={{ left: Math.max(150, Math.min(sx, el.clientWidth - 150)), ...(below ? { top: bottom + 10 } : { top: top - 10, transform: 'translate(-50%, -100%)' }) }}>
              <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle">
                <span className="inline-block size-1.5 rounded-full" style={{ background: FILL[n.type] }} />{TYPE_LABEL[n.type]}
                {lines.where && <span className="truncate normal-case tracking-normal">· {lines.where}</span>}
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug text-foreground">{lines.title}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-foreground/70">{lines.facts.map(f => <li key={f}>{f}</li>)}</ul>
              {n.type === 'topic' && gapsOf(n).length > 0 && <p className="mt-1.5 text-xs" style={{ color: 'var(--map-note)' }}>{gapsOf(n).map(g => GAP_LABEL[g]).join(' · ')}</p>}
              <p className="mt-1.5 text-[10.5px] text-subtle">Click for details{canExplore(tree, n.id) ? ' · Enter or double-click to explore inside' : ''}</p>
            </div>
          )
        })()}

        {/* The lens, on the canvas it changes. */}
        <div className="absolute left-3 top-3 z-10" onPointerDown={e => e.stopPropagation()}>
        {/* The lens: what stands out. Emphasis only: nothing is hidden or moved. */}
        <div role="radiogroup" aria-label="Lens (L)" className="inline-flex h-8 items-center rounded-full border border-white/10 bg-popover/90 p-0.5 shadow-soft backdrop-blur" data-lens={lens}>
          {LENSES.map(l => (
            <button key={l.id} type="button" role="radio" aria-checked={lens === l.id} onClick={() => setLens(l.id)} title={`${l.hint} (L)`} data-lens-choice={l.id}
              className={cn('inline-flex h-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors', lens === l.id ? 'bg-white/10 text-foreground' : 'text-subtle hover:text-foreground')}>
              {l.label}
              {l.id === 'gaps' && gapCount > 0 && <span className="rounded-full bg-[color-mix(in_oklch,var(--map-note)_22%,transparent)] px-1.5 text-[10px] tabular-nums text-foreground">{gapCount}</span>}
            </button>
          ))}
        </div>
        </div>

        {/* Gaps: the topics to act on, first things first, each one click from its card. */}
        {lens === 'gaps' && !inScope && (
          <section aria-label="Gaps on this map" data-map-overlay data-gaps-panel onPointerDown={e => e.stopPropagation()}
            className="absolute left-3 top-14 z-10 hidden max-h-[calc(100%-8rem)] w-72 flex-col overflow-hidden rounded-2xl border border-white/10 bg-popover/95 shadow-float backdrop-blur sm:flex">
            <header className="flex items-start justify-between gap-2 border-b border-white/8 px-3.5 py-2.5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Gaps <span className="tabular-nums text-subtle">· {gapList.length}</span></h2>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">From your record: reviews due, topics not studied, weak, or with nothing written. G goes to the next.</p>
              </div>
              <button type="button" onClick={() => setLens('structure')} aria-label="Close the Gaps lens" className="rounded-lg p-1 text-subtle hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
            </header>
            {gapList.length === 0 ? <p className="px-3.5 py-3 text-xs text-foreground/70">No gaps on this map. Every topic has a session and something written, and no review is due.</p> : (
              <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {gapList.slice(0, 60).map(g => (
                  <li key={g.id}>
                    <button type="button" onClick={() => { setFlash(f => ({ id: g.id, n: (f?.n ?? 0) + 1 })); select(g.id, { centre: true, focusCard: true }) }} aria-current={selected === g.id || undefined}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/5 aria-[current]:bg-white/8" data-gap={g.id}>
                      <span className="block truncate text-[13px] font-medium text-foreground/90">{g.label}</span>
                      <span className="block truncate text-[11px]" style={{ color: 'var(--map-note)' }}>{gapsOf(g).map(r => GAP_LABEL[r]).join(' · ')}</span>
                      <span className="block truncate text-[11px] text-subtle">{pathOf(g.id, tree.parent, labelOf).join(' › ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Everything: what this level shows, and the way to every item. */}
        {!view.workspaceId && !focus && !inScope && !panel && (overviewOn ? (dens?.hidden.size ?? 0) > 0 : density === 'all') && (
          <div data-map-overlay data-overview-hint={density} onPointerDown={e => e.stopPropagation()}
            className="absolute bottom-3 left-1/2 z-10 hidden max-w-[min(40rem,calc(100%-24rem))] -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-popover/90 py-1 pl-3.5 pr-1 text-xs text-foreground/70 shadow-soft backdrop-blur md:flex">
            <span className="truncate">{overviewOn
              ? `Overview · ${dens!.hidden.size} notes, pages, tasks and subtopics folded into their cards`
              : 'Every item is drawn.'}</span>
            <button type="button" onClick={() => setDensity(overviewOn ? 'all' : 'overview')} className="shrink-0 rounded-full px-2.5 py-1 font-medium text-foreground/85 hover:bg-white/8" data-density-toggle>
              {overviewOn ? 'Show every item' : 'Back to overview'}
            </button>
          </div>
        )}

        {/* A small map: how it grows, once, until closed. */}
        {!guideClosed && !inside && view.nodes.length <= 8 && !panel && (
          <section aria-label="How your map grows" data-map-overlay data-map-guide onPointerDown={e => e.stopPropagation()}
            className="absolute bottom-16 left-1/2 z-10 w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-popover/95 p-4 shadow-float backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Your map grows as you learn</h2>
              <button type="button" onClick={() => { setGuideClosed(true); writeKey(GUIDE_KEY, '1') }} aria-label="Close" className="rounded-lg p-1 text-subtle hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
            </div>
            <ol className="mt-2 grid gap-2 text-xs leading-relaxed text-foreground/75 sm:grid-cols-3">
              <li><span className="font-medium text-foreground">1. Subjects and topics.</span> Each is a card; a topic rises as your sessions build your own estimate.</li>
              <li><span className="font-medium text-foreground">2. Notes and pages.</span> File one under a topic and it joins that card; a [[link]] in a note joins two cards.</li>
              <li><span className="font-medium text-foreground">3. Find your gaps.</span> Press L for the Gaps lens: what is due, not studied, or has nothing written.</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              {!view.workspaceId && <button type="button" onClick={() => openAdd(null)} className={cn(BUTTON_QUIET, 'h-8')}><Plus aria-hidden className="size-3.5" /> New subject</button>}
              <Link href="/notes/new" className={cn(BUTTON_QUIET, 'h-8')}>Write a note</Link>
              <Link href="/saved" className={cn(BUTTON_QUIET, 'h-8')}>Save pages from your browser</Link>
            </div>
          </section>
        )}

        <div className={cn('absolute bottom-3 flex flex-col items-end gap-2 transition-[right]', picked && detailOpen ? 'right-3 max-lg:bottom-[calc(58%+0.75rem)] lg:right-[23.5rem]' : 'right-3')} onPointerDown={e => e.stopPropagation()}>
        {/* The minimap, when the map is bigger than the screen. */}
        {!portrait && miniCards.length > 0 && frame.current && (() => {
          const cw = frame.current.clientWidth, ch = frame.current.clientHeight
          const ms = miniSize(miniBox), mf = minimapFrame(miniBox, ms.w, ms.h), vp = viewportOn(mf, t, cw, ch)
          // Shown only when part of the map is off screen.
          const whole = vp.whole || vp.w * vp.h >= 0.8 * ms.w * ms.h
          return whole ? null : (
            <div className="hidden overflow-hidden rounded-xl border border-white/10 bg-card/90 p-1 shadow-soft backdrop-blur lg:block">
              <Minimap cards={miniCards} regions={miniRegions} box={miniBox} t={t} cw={cw} ch={ch} onJump={v => { stopAnim(); setT(v) }} />
            </div>
          )
        })()}
        <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-card/90 shadow-soft backdrop-blur">
          <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in (+)" className="p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Plus className="size-4" /></button>
          <button type="button" onClick={() => { if (selected && placed.at.has(selected)) centreOn(selected, 1); else zoomAt(1 / t.k) }} aria-label={`Zoom ${Math.round(t.k * 100)}%. Set to 100%`} title="Zoom to 100% (0)"
            className="border-t border-white/8 py-1 text-[10px] font-medium tabular-nums text-foreground/70 hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">{Math.round(t.k * 100)}%</button>
          <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out (-)" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Minus className="size-4" /></button>
          <button type="button" onClick={() => fit()} aria-label="Fit the map on screen" title="Fit (F)" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><Maximize2 className="size-4" /></button>
        </div>
        </div>

        {picked && detailOpen && (
          <Detail key={picked.id} node={picked} neighbours={neighbours} onPick={id => pick(id)} onClose={() => setDetailOpen(false)} where={ancestorsOf(picked.id)} tally={picked.type === 'subject' ? subjectTallies.get(picked.id) : undefined} subjectTopics={picked.type === 'subject' ? view.nodes.filter((n): n is Extract<MapNode, { type: 'topic' }> => n.type === 'topic' && rootOf(n.id, tree.parent) === picked.id) : undefined}
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

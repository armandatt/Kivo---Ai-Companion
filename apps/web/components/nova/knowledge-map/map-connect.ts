// Connecting a card that already exists to the selected one. Pure: which
// cards can be connected, how (each relationship the data model really
// stores), what each would change, and the one request that makes it.
//
// Two kinds of relationship exist, and they are never mixed up:
//   - where a card sits (hierarchy): a subject inside a subject, a topic
//     inside a topic or at the top of a subject, a task as a step of a task,
//     a task, note or saved page filed under a subject or topic. Connecting
//     this way MOVES the card (one parent each); the dialog says from where.
//   - a link beside the hierarchy (cross-link): a note's [[link]] to a note
//     or topic, and a task waiting for another. Nothing moves.
// There is no link between two topics or two subjects beside the hierarchy:
// the data model has none, so none is offered. Nothing is ever copied: the
// card connected is the same row, with its content, history and children.

import type { MapEdge, MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'
import type { StudyEdit } from '@repo/api/nova/product/setup-edit.types'
import type { TaskInput } from '@repo/api/nova/product/tasks.types'
import { planLink, type LinkPlan, type Placement } from './map-edit'
import { rowId } from './map-structure'

type Tree = { children: ReadonlyMap<string, readonly string[]>; parent: ReadonlyMap<string, string> }

export type ConnectRequest =
  | { route: 'study'; edits: StudyEdit[] }
  | { route: 'task'; taskId: string; patch: TaskInput }
  | { route: 'file'; kind: 'note' | 'resource'; id: string; to: Placement; version: string | null }
  | { route: 'link'; noteId: string; plan: Extract<LinkPlan, { ok: true }> }

export interface ConnectOption {
  key:      string
  relation: 'hierarchy' | 'link'
  label:    string
  // What the connection is, in words.
  detail:   string
  // What it changes in where the card sits, when it does (said before saving).
  moves:    string | null
  // Set when this connection can't be made, and why.
  blocked?: string
  request?: ConnectRequest
}

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39).trimEnd()}…` : s}”`

// Which kinds of card can be connected to which.
const CONNECTS: Record<MapNodeType, ReadonlySet<MapNodeType>> = {
  subject:  new Set(['subject', 'topic', 'task', 'note', 'resource']),
  topic:    new Set(['topic', 'task', 'note', 'resource']),
  task:     new Set(['task']),
  note:     new Set(),
  resource: new Set(),
}
export const canConnectFrom = (n: MapNode) => CONNECTS[n.type].size > 0

const ancestors = (tree: Tree, id: string): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (let at = tree.parent.get(id); at !== undefined && !seen.has(at); at = tree.parent.get(at)) { seen.add(at); out.push(at) }
  return out
}

// Where a card sits now, in words: "Design and Analysis › Unit 1".
export function contextOf(tree: Tree, byId: ReadonlyMap<string, MapNode>, id: string): string {
  const path = ancestors(tree, id).reverse().map(a => byId.get(a)?.label).filter(Boolean)
  return path.length ? path.join(' › ') : 'On its own'
}

// The cards that can be connected to `source`, found by name and where they
// sit, best first. The source itself is never among them.
export function connectCandidates(source: MapNode, nodes: readonly MapNode[], tree: Tree, query: string, limit = 30): Array<{ node: MapNode; context: string }> {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const q = query.trim().toLowerCase()
  const kinds = CONNECTS[source.type]
  const out: Array<{ node: MapNode; context: string; rank: number }> = []
  for (const n of nodes) {
    if (n.id === source.id || !kinds.has(n.type)) continue
    const context = contextOf(tree, byId, n.id)
    const name = n.label.toLowerCase()
    const rank = !q ? 2 : name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : `${context} ${n.type === 'resource' ? n.domain : ''}`.toLowerCase().includes(q) ? 3 : -1
    if (rank >= 0) out.push({ node: n, context, rank })
  }
  out.sort((a, b) => a.rank - b.rank || a.node.label.localeCompare(b.node.label, 'en', { sensitivity: 'base' }) || a.context.localeCompare(b.context))
  return out.slice(0, limit).map(({ node, context }) => ({ node, context }))
}

export function connectOptions(source: MapNode, target: MapNode, ctx: { nodes: readonly MapNode[]; edges: readonly MapEdge[]; tree: Tree }): ConnectOption[] {
  const { tree, nodes, edges } = ctx
  const byId = new Map(nodes.map(n => [n.id, n]))
  const parentNow = tree.parent.get(target.id)
  const from = parentNow ? byId.get(parentNow) : undefined
  const movesFrom = (what: string) => (from ? `${quote(target.label)} moves out of ${quote(from.label)}${what}.` : `${quote(target.label)} moves here${what}.`)
  const self = target.id === source.id ? 'A card can’t be connected to itself.' : undefined
  const cycle = ancestors(tree, source.id).includes(target.id) ? `${quote(source.label)} is inside ${quote(target.label)}, so ${quote(target.label)} can’t go inside it.` : undefined
  const already = parentNow === source.id ? `${quote(target.label)} is already inside ${quote(source.label)}.` : undefined
  const withHistory = target.type === 'topic' ? ', with the topics inside it and its notes, tasks, saved pages and history' : ''
  const out: ConnectOption[] = []
  const hierarchy = (o: Omit<ConnectOption, 'relation' | 'blocked'> & { blocked?: string }) => out.push({ relation: 'hierarchy', ...o, blocked: self ?? o.blocked ?? cycle ?? already })

  if (source.type === 'subject') {
    const sid = source.subjectId!
    if (target.type === 'subject') {
      hierarchy({ key: 'inside', label: `Put it inside ${quote(source.label)}`, detail: `${quote(target.label)} becomes a subject inside ${quote(source.label)}, with everything in it.`,
        moves: movesFrom(''), request: { route: 'study', edits: [{ op: 'move_subject', subjectId: target.subjectId!, parentId: sid }] } })
    } else if (target.type === 'topic') {
      const same = target.subjectId === sid
      hierarchy({ key: 'inside', label: `Move it to ${quote(source.label)}`, detail: `${quote(target.label)} goes to the top of ${quote(source.label)}${withHistory}.`,
        moves: movesFrom(same ? '' : ` and out of ${quote(target.subjectName)}`),
        request: { route: 'study', edits: [same ? { op: 'move_topic', topicId: rowId(target.id), parentId: null } : { op: 'move_topic', topicId: rowId(target.id), toSubjectId: sid }] } })
    } else if (target.type === 'task') {
      const filedHere = !target.parentId && target.subjectId === sid && !target.topicName
      hierarchy({ key: 'inside', label: `File it under ${quote(source.label)}`, detail: `${quote(target.label)} is filed under ${quote(source.label)}${target.parentId ? ' as a task of its own' : ''}; its steps go with it.`,
        moves: target.parentId ? `It stops being a step of ${quote(from?.label ?? 'its task')}.` : movesFrom(''),
        blocked: filedHere ? `${quote(target.label)} is already filed under ${quote(source.label)}.` : undefined,
        request: { route: 'task', taskId: rowId(target.id), patch: { parentId: null, subjectId: sid, topicName: null } } })
    } else if (target.type === 'note' || target.type === 'resource') {
      const filedHere = target.subjectId === sid && !target.topicLinked
      hierarchy({ key: 'file', label: `File it under ${quote(source.label)}`, detail: `The ${target.type === 'note' ? 'note' : 'saved page'} is filed under ${quote(source.label)}. Nothing in it changes.`,
        moves: movesFrom(''), blocked: filedHere ? `It is already filed under ${quote(source.label)}.` : undefined,
        request: { route: 'file', kind: target.type, id: rowId(target.id), to: { subjectId: sid, topicName: null }, version: target.type === 'note' ? target.updatedAt : null } })
    }
    return out
  }

  if (source.type === 'topic') {
    const sid = source.subjectId!
    if (target.type === 'topic') {
      const same = target.subjectId === sid
      const edits: StudyEdit[] = same
        ? [{ op: 'move_topic', topicId: rowId(target.id), parentId: rowId(source.id) }]
        : [{ op: 'move_topic', topicId: rowId(target.id), toSubjectId: sid }, { op: 'move_topic', topicId: rowId(target.id), parentId: rowId(source.id) }]
      hierarchy({ key: 'inside', label: `Put it inside ${quote(source.label)}`, detail: `${quote(target.label)} becomes a topic inside ${quote(source.label)}${withHistory}.`,
        moves: movesFrom(same ? '' : ` and out of ${quote(target.subjectName)}`), request: { route: 'study', edits } })
    } else if (target.type === 'task') {
      const filedHere = !target.parentId && target.subjectId === sid && target.topicName?.toLowerCase() === source.label.toLowerCase()
      hierarchy({ key: 'inside', label: `File it under ${quote(source.label)}`, detail: `${quote(target.label)} is filed under ${quote(source.label)}${target.parentId ? ' as a task of its own' : ''}; its steps go with it.`,
        moves: target.parentId ? `It stops being a step of ${quote(from?.label ?? 'its task')}.` : movesFrom(''),
        blocked: filedHere ? `${quote(target.label)} is already filed under ${quote(source.label)}.` : undefined,
        request: { route: 'task', taskId: rowId(target.id), patch: { parentId: null, subjectId: sid, topicName: source.label } } })
    } else if (target.type === 'note' || target.type === 'resource') {
      const filedHere = target.subjectId === sid && target.topicLinked && target.topicName?.toLowerCase() === source.label.toLowerCase()
      hierarchy({ key: 'file', label: `File it under ${quote(source.label)}`, detail: `The ${target.type === 'note' ? 'note' : 'saved page'} is filed under ${quote(source.label)}. Nothing in it changes.`,
        moves: movesFrom(''), blocked: filedHere ? `It is already filed under ${quote(source.label)}.` : undefined,
        request: { route: 'file', kind: target.type, id: rowId(target.id), to: { subjectId: sid, topicName: source.label }, version: target.type === 'note' ? target.updatedAt : null } })
      if (target.type === 'note') {
        // A link beside the hierarchy: the note keeps where it is filed.
        const plan = planLink(target, source, [...nodes], [...edges])
        out.push({ key: 'link', relation: 'link', label: `Link the note to ${quote(source.label)}`, detail: `Adds [[${source.label}]] on a new line at the end of the note. It stays filed where it is.`,
          moves: null, ...(plan.ok ? { request: { route: 'link', noteId: rowId(target.id), plan } } : { blocked: plan.reason }) })
      }
    }
    return out
  }

  if (source.type === 'task' && target.type === 'task') {
    hierarchy({ key: 'step', label: `Make it a step of ${quote(source.label)}`, detail: `${quote(target.label)} becomes a step of ${quote(source.label)}, with its own steps under it.`,
      moves: target.parentId ? `It stops being a step of ${quote(from?.label ?? 'its task')}.` : `It stops being a task of its own${target.topicName ? ` under ${quote(target.topicName)}` : ''}.`,
      request: { route: 'task', taskId: rowId(target.id), patch: { parentId: rowId(source.id) } } })
    // Waits, either way: links beside the hierarchy. A circle is refused.
    const waits = edges.filter(e => e.kind === 'depends_on')
    const reaches = (a: string, b: string) => { const seen = new Set<string>(); const go = (x: string): boolean => x === b || (!seen.has(x) && (seen.add(x), waits.some(w => w.from === x && go(w.to)))); return go(a) }
    for (const [waiter, on, key] of [[source, target, 'waits_for'], [target, source, 'waited_on']] as const) {
      const exists = waits.some(w => w.from === waiter.id && w.to === on.id)
      out.push({ key, relation: 'link', label: `${quote(waiter.label)} waits for ${quote(on.label)}`, detail: `${quote(waiter.label)} can’t start until ${quote(on.label)} is done. Neither moves.`, moves: null,
        blocked: self ?? (exists ? 'That wait is already there.' : reaches(on.id, waiter.id) ? `${quote(on.label)} already waits, through others, for ${quote(waiter.label)}: that would be a circle.` : undefined),
        request: { route: 'task', taskId: rowId(waiter.id), patch: { waitFor: rowId(on.id) } } })
    }
  }
  return out
}

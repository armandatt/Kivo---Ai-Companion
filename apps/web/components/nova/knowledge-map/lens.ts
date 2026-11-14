// ─── What a topic's record says about learning, and the map's lenses ─────────
// Knowledge Map 3.0. Everything here is read from what the map reports for a
// card (knowledge-map.types.ts) and nothing is guessed: a level only with a
// session behind it, "review due" only from the schedule (the server applies
// retention-engine.ts), "recent" only from the last session's date. Pure.

import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'

export type TopicState = 'unstudied' | 'weak' | 'developing' | 'solid' | 'unrated' | 'organising' | 'milestone'

export const STATE_LABEL: Record<TopicState, string> = {
  unstudied: 'Not studied yet',
  weak: 'Weak',
  developing: 'Developing',
  solid: 'Solid',
  unrated: 'Studied, no estimate yet',
  organising: 'Studied through the topics inside it',
  milestone: 'Milestone',
}

// How far a session counts as "recent".
export const RECENT_DAYS = 7
const DAY_MS = 86_400_000

type Topic = Extract<MapNode, { type: 'topic' }>

export function topicState(t: Topic): TopicState {
  if (t.kind === 'milestone') return 'milestone'
  if (t.studied === false) return 'organising'
  if (t.sessions === 0) return 'unstudied'
  return t.level ?? 'unrated'
}

export const isRecent = (t: Topic, now: Date) =>
  !!t.lastStudiedAt && now.getTime() - new Date(t.lastStudiedAt).getTime() <= RECENT_DAYS * DAY_MS

// Why a topic is a gap: things the learner can act on, each from the record.
export type GapReason = 'unstudied' | 'review_due' | 'weak' | 'nothing_written'
export const GAP_LABEL: Record<GapReason, string> = {
  review_due: 'Review due',
  unstudied: 'Not studied yet',
  weak: 'Your estimate is weak',
  nothing_written: 'No note or saved page',
}

// A topic studied on its own (not a milestone, not one that organises others).
const studiable = (t: Topic) => t.kind !== 'milestone' && t.studied !== false

export function gapsOf(t: Topic): GapReason[] {
  if (!studiable(t)) return []
  const out: GapReason[] = []
  if (t.reviewDue) out.push('review_due')
  if (t.sessions === 0) out.push('unstudied')
  else if (t.level === 'weak') out.push('weak')
  if (t.notes === 0 && t.resources === 0) out.push('nothing_written')
  return out
}

// ── Lenses ──────────────────────────────────────────────────────────────────
// A lens changes emphasis only: which cards stand out, and why. It never
// hides, moves or changes a card.
export type Lens = 'structure' | 'learning' | 'gaps'
export const LENSES: Array<{ id: Lens; label: string; hint: string }> = [
  { id: 'structure', label: 'Structure', hint: 'Everything, as it is filed and linked' },
  { id: 'learning', label: 'Learning', hint: 'Topics by how far you have come; reviews due and recent study marked' },
  { id: 'gaps', label: 'Gaps', hint: 'Topics to act on: reviews due, not studied, weak, or nothing written' },
]
export const nextLens = (l: Lens): Lens => LENSES[(LENSES.findIndex(x => x.id === l) + 1) % LENSES.length]!.id

// The cards a lens points at (in reading order, for G), or null when it points at none in particular.
export function lensTargets(lens: Lens, nodes: readonly MapNode[]): Set<string> | null {
  if (lens === 'structure') return null
  const out = new Set<string>()
  for (const n of nodes) {
    if (n.type !== 'topic') continue
    if (lens === 'gaps' ? gapsOf(n).length > 0 : topicState(n) !== 'organising' && topicState(n) !== 'milestone') out.add(n.id)
  }
  return out
}

// Gaps worth acting on first: a review due, then weak, then not studied, then nothing written.
const GAP_ORDER: GapReason[] = ['review_due', 'weak', 'unstudied', 'nothing_written']
export function gapRank(t: Topic): number {
  const g = gapsOf(t)
  return g.length ? Math.min(...g.map(r => GAP_ORDER.indexOf(r))) : GAP_ORDER.length
}

// A whole subject at a glance, for the overview: topics by state, and what is due.
export interface StateTally { topics: number; studied: number; solid: number; developing: number; weak: number; unstudied: number; reviewDue: number; notes: number; resources: number; tasks: number }
export function tallyOf(nodes: Iterable<MapNode>): StateTally {
  const t: StateTally = { topics: 0, studied: 0, solid: 0, developing: 0, weak: 0, unstudied: 0, reviewDue: 0, notes: 0, resources: 0, tasks: 0 }
  for (const n of nodes) {
    if (n.type === 'note') t.notes++
    else if (n.type === 'resource') t.resources++
    else if (n.type === 'task') t.tasks++
    else if (n.type === 'topic') {
      const s = topicState(n)
      if (s === 'organising' || s === 'milestone') continue
      t.topics++
      if (s === 'unstudied') t.unstudied++
      else { t.studied++; if (s === 'solid' || s === 'developing' || s === 'weak') t[s]++ }
      if (n.reviewDue) t.reviewDue++
    }
  }
  return t
}

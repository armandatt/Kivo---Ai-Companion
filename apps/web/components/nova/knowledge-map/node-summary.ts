// ─── What a card's inspector says first ─────────────────────────────────────
// Opening a card shows what helps decide what to do next: its name and place,
// a description when one is stored, its learning status when the record has
// one, and what is filed there. Everything else (sessions, dates, the review
// schedule, how the estimate is made) is under "More". Each kind of card has
// its own summary. Nothing is said that the record does not hold. Pure.

import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { STATE_LABEL, topicState, type StateTally } from './lens'

export interface Status { label: string; tone: 'solid' | 'developing' | 'weak' | 'plain' | 'due'; percent: number | null }
export interface Summary {
  description: string | null
  status: Status | null
  // What is filed there, in one line ("2 notes · 1 saved page"), or null.
  counts: string | null
  // Facts kept for "More".
  more: Array<[string, string]>
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const countsLine = (notes: number, resources: number) => {
  const parts = [notes ? plural(notes, 'note') : null, resources ? plural(resources, 'saved page') : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function summaryOf(n: MapNode, o: { tally?: StateTally; when: (iso: string) => string }): Summary {
  if (n.type === 'topic') {
    const st = topicState(n)
    const status: Status | null =
      st === 'milestone' ? { label: 'Milestone', tone: 'plain', percent: null }
      : st === 'organising' ? { label: 'Studied through its topics', tone: 'plain', percent: null }
      : st === 'unstudied' ? { label: 'Not studied yet', tone: 'plain', percent: null }
      : { label: STATE_LABEL[st], tone: st === 'unrated' ? 'plain' : st, percent: n.masteryPercent }
    const more: Array<[string, string]> = []
    if (st !== 'milestone' && st !== 'organising') more.push(['Sessions', n.sessions ? String(n.sessions) : 'None yet'])
    if (n.lastStudiedAt) more.push(['Last studied', o.when(n.lastStudiedAt)])
    if (n.reviewDue !== undefined && n.sessions > 0) more.push(['Review', n.reviewDue ? 'Due now' : 'Not due yet'])
    const d = n.details
    if (d?.weeks || d?.hoursPerWeek) more.push(['Effort (an estimate)', [d.weeks ? plural(d.weeks, 'week') : null, d.hoursPerWeek ? `${d.hoursPerWeek} h a week` : null].filter(Boolean).join(', ')])
    if (d?.completion) more.push(['Done when', d.completion])
    return { description: d?.explanation?.trim() || null, status, counts: countsLine(n.notes, n.resources), more }
  }
  if (n.type === 'subject') {
    const t = o.tally
    const status: Status | null = t && t.topics ? { label: `${t.studied} of ${plural(t.topics, 'topic')} studied`, tone: 'plain', percent: Math.round((t.studied / t.topics) * 100) } : null
    const more: Array<[string, string]> = []
    if (t?.reviewDue) more.push(['Reviews due', String(t.reviewDue)])
    if (t && t.studied) more.push(['Solid · developing · weak', `${t.solid} · ${t.developing} · ${t.weak}`])
    return { description: null, status, counts: countsLine(n.notes, n.resources), more }
  }
  if (n.type === 'note') return { description: null, status: null, counts: null, more: [['Edited', o.when(n.updatedAt)]] }
  if (n.type === 'resource') return { description: null, status: null, counts: null, more: [[n.kind === 'study_requested' ? 'Asked to study' : 'Saved', o.when(n.savedAt)]] }
  const status: Status = { label: n.status === 'done' ? 'Done' : n.status === 'in_progress' ? 'In progress' : 'To do', tone: 'plain', percent: null }
  const more: Array<[string, string]> = []
  if (n.dueDay) more.push(['Due', n.dueDay])
  if (n.estimatedMinutes) more.push(['Estimate', `about ${n.estimatedMinutes} min`])
  if (n.priority) more.push(['Priority', n.priority[0]!.toUpperCase() + n.priority.slice(1)])
  if (n.waitsOn) more.push(['Waits for', plural(n.waitsOn, 'task')])
  return { description: null, status, counts: null, more }
}

// ── One next step, from the record ──────────────────────────────────────────
// What a topic's inspector suggests first, and the action it is: from its own
// gaps (lens.ts), never from a guess. null: nothing to suggest.
export type NextStep = { kind: 'revise' | 'start' | 'note' | 'again'; text: string } | null
export function nextStep(n: MapNode): NextStep {
  if (n.type !== 'topic' || n.kind === 'milestone' || n.studied === false) return null
  if (n.reviewDue && n.sessions > 0) return { kind: 'revise', text: 'Its review is due' }
  if (n.sessions === 0) return { kind: 'start', text: 'Not studied yet' }
  if (n.level === 'weak') return { kind: 'again', text: 'Your estimate is weak' }
  if (n.notes === 0 && n.resources === 0) return { kind: 'note', text: 'Nothing written here yet' }
  return null
}

// ── What to ask Nova first, from the record ─────────────────────────────────
// The starting questions on a card's Ask, and on Nova for the whole map: from
// what that card (or the map) actually holds, so they are about it, never
// generic. At most three; a question is offered only when the record has
// something for it (a review due, a weak or untouched topic, overdue work).
export function askSuggestions(n: MapNode | null, tally?: StateTally, extra: { overdue?: number } = {}): string[] {
  const out: string[] = []
  const name = n ? (n.label.length > 32 ? `${n.label.slice(0, 31).trimEnd()}…` : n.label) : null
  if (n?.type === 'topic') {
    const st = topicState(n)
    if (n.reviewDue && n.sessions > 0) out.push(`Help me revise ${name}`)
    if (st === 'unstudied') out.push(`Where do I start with ${name}?`)
    if (st === 'weak') out.push(`Why is ${name} weak, and how do I fix it?`)
    if (st === 'organising') out.push(`Which topic in ${name} should I study first?`)
    out.push(`Explain ${name} simply`, `What is inside ${name}?`)
    return out.slice(0, 3)
  }
  if (n && n.type !== 'subject') return [`What is ${name} about on my map?`, `How does ${name} connect to the rest?`]
  const t = tally
  if (t?.reviewDue) out.push(n ? `What's due for review in ${name}?` : 'What is due for review?')
  if (extra.overdue) out.push(n ? `What's overdue in ${name}?` : 'What is overdue, and what first?')
  if (t?.weak) out.push(n ? `Where am I weakest in ${name}?` : 'Where am I weakest?')
  if (t && t.unstudied > 0) out.push(n ? `What should I study first in ${name}?` : 'What should I study next?')
  out.push(n ? `What is inside ${name}?` : 'Give me an overview of my map', n ? `How does ${name} connect to my other subjects?` : 'How do my subjects connect?')
  return [...new Set(out)].slice(0, 3)
}

// Open tasks past their due day (the device's own day), within a card: filed
// under that subject or topic by name; the whole map when there is no card.
export function overdueIn(nodes: readonly MapNode[], scope: MapNode | null, today = new Date().toLocaleDateString('en-CA')): number {
  return nodes.filter(n => n.type === 'task' && n.status !== 'done' && !!n.dueDay && n.dueDay < today &&
    (!scope || (scope.type === 'subject' ? n.subjectName === scope.label : scope.type === 'topic' ? n.topicName === scope.label : false))).length
}

// Removing one connection, and nothing else. Pure: what taking one line off
// the map means for the records behind it, and the one request that does it.
// No card is deleted: a card that was inside another stands on its own (or at
// the top of its subject), a task, note or saved page that was filed somewhere
// is filed one level up or under nothing, a [[link]] becomes plain words, and
// a wait is dropped. A topic always belongs to a subject, so that line can't
// simply be removed; the dialog says so and what to do instead.

import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { StudyEdit } from '@repo/api/nova/product/setup-edit.types'
import type { TaskInput } from '@repo/api/nova/product/tasks.types'
import { rowId } from './map-structure'

export type DisconnectRequest =
  | { route: 'study'; edits: StudyEdit[] }
  | { route: 'task'; taskId: string; patch: TaskInput }
  // A note or saved page refiled under its subject only.
  | { route: 'file'; kind: 'note' | 'resource'; id: string; subjectId: string; version: string | null }
  // A note or saved page filed under nothing.
  | { route: 'unfile'; kind: 'note' | 'resource'; id: string; version: string | null }
  // The [[link]] taken out of the note's text.
  | { route: 'unlink'; noteId: string; title: string }

export type DisconnectPlan =
  | { ok: true; label: string; detail: string; request: DisconnectRequest }
  | { ok: false; why: string }

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39).trimEnd()}…` : s}”`

export function disconnectPlan(edge: MapEdge, byId: ReadonlyMap<string, MapNode>, opts: { workspace: boolean }): DisconnectPlan {
  const from = byId.get(edge.from), to = byId.get(edge.to)
  if (!from || !to) return { ok: false, why: 'This connection has changed since the map loaded. The map has been reloaded.' }
  const offMap = opts.workspace ? ' It may then not show on this workspace’s map, which draws what is filed under its subjects.' : ''
  const kept = 'Nothing is deleted.'
  switch (edge.kind) {
    case 'contains':
      return { ok: true, label: `Take ${quote(to.label)} out of ${quote(from.label)}`, detail: `${quote(to.label)} becomes a subject of its own, with everything in it. ${kept}`,
        request: { route: 'study', edits: [{ op: 'move_subject', subjectId: to.subjectId!, parentId: null }] } }
    case 'subtopic':
      return { ok: true, label: `Take ${quote(to.label)} out of ${quote(from.label)}`, detail: `${quote(to.label)} moves to the top of ${quote(to.type === 'topic' ? to.subjectName : '')}, with the topics inside it and its history. ${kept}`,
        request: { route: 'study', edits: [{ op: 'move_topic', topicId: rowId(to.id), parentId: null }] } }
    case 'has_topic':
      return { ok: false, why: `A topic always belongs to a subject, so ${quote(to.label)} can’t be taken out of ${quote(from.label)} on its own. To move it, use Add › Connect existing on the subject or topic it should go to; to remove it, delete it.` }
    case 'step':
      return { ok: true, label: `Make ${quote(to.label)} a task of its own`, detail: `It stops being a step of ${quote(from.label)}; its own steps stay under it. ${kept}`,
        request: { route: 'task', taskId: rowId(to.id), patch: { parentId: null } } }
    case 'has_task':
      return from.type === 'topic'
        ? { ok: true, label: `Unfile ${quote(to.label)} from ${quote(from.label)}`, detail: `The task stays filed under ${quote(from.subjectName)} only; its steps go with it. ${kept}`,
            request: { route: 'task', taskId: rowId(to.id), patch: { topicName: null } } }
        : { ok: true, label: `Unfile ${quote(to.label)} from ${quote(from.label)}`, detail: `The task is filed under nothing; its steps go with it. ${kept}${offMap}`,
            request: { route: 'task', taskId: rowId(to.id), patch: { subjectId: null, topicName: null } } }
    case 'about_topic': {
      if (to.type !== 'note' && to.type !== 'resource') break
      return { ok: true, label: `Unfile it from ${quote(from.label)}`, detail: `The ${to.type === 'note' ? 'note' : 'saved page'} stays filed under ${quote(to.subjectName ?? 'its subject')} only. Nothing in it changes.`,
        request: { route: 'file', kind: to.type, id: rowId(to.id), subjectId: to.subjectId!, version: to.type === 'note' ? to.updatedAt : null } }
    }
    case 'filed_under': {
      if (to.type !== 'note' && to.type !== 'resource') break
      return { ok: true, label: `Unfile it from ${quote(from.label)}`, detail: `The ${to.type === 'note' ? 'note' : 'saved page'} is filed under nothing. Nothing in it changes.${offMap}`,
        request: { route: 'unfile', kind: to.type, id: rowId(to.id), version: to.type === 'note' ? to.updatedAt : null } }
    }
    case 'links_to':
      return { ok: true, label: `Remove the [[link]] to ${quote(to.label)}`, detail: `Takes [[${to.label}]] out of ${quote(from.label)}; the words it showed stay as plain text. ${kept}`,
        request: { route: 'unlink', noteId: rowId(from.id), title: to.label } }
    case 'depends_on':
      return { ok: true, label: `${quote(from.label)} no longer waits for ${quote(to.label)}`, detail: `Only the wait goes; both tasks stay where they are. ${kept}`,
        request: { route: 'task', taskId: rowId(from.id), patch: { stopWaitingFor: rowId(to.id) } } }
  }
  return { ok: false, why: 'This connection can’t be removed from the map.' }
}

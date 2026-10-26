// The Notes workspace's keys (notes-shortcuts.ts) and where a note can be
// filed (note-destinations.ts). Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { isMacPlatform, isTypingTarget, notesShortcut, shortcutList } from './notes-shortcuts'
import { NO_SUBJECT, destinationFor, destinationLabel, destinationsOf, searchDestinations } from './note-destinations'

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; repeat: boolean; composing: boolean }> = {}) =>
  ({ key: k, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, repeat: !!mods.repeat, isComposing: !!mods.composing })

test('import is ⌘P on a Mac and Ctrl+P elsewhere; the other modifier is left to the system', () => {
  assert.equal(notesShortcut(key('p', { meta: true }), true, false), 'import')
  assert.equal(notesShortcut(key('p', { ctrl: true }), false, false), 'import')
  // Ctrl+P on a Mac moves up a line in a text field; ⌘P on Windows is not Print.
  assert.equal(notesShortcut(key('p', { ctrl: true }), true, true), null)
  assert.equal(notesShortcut(key('p', { meta: true }), false, false), null)
  // Shift or Alt with it is another command (a private window in Firefox).
  assert.equal(notesShortcut(key('P', { ctrl: true, shift: true }), false, false), null)
  assert.equal(notesShortcut(key('p', { meta: true, alt: true }), true, false), null)
})

test('the palette is ⌘K / Ctrl+K, even while typing; ? only when not typing; held keys and composition do nothing', () => {
  assert.equal(notesShortcut(key('k', { meta: true }), true, true), 'palette')
  assert.equal(notesShortcut(key('k', { ctrl: true }), true, true), null)
  assert.equal(notesShortcut(key('?', { shift: true }), false, false), 'help')
  assert.equal(notesShortcut(key('?', { shift: true }), false, true), null)
  assert.equal(notesShortcut(key('p', { meta: true, repeat: true }), true, false), null)
  assert.equal(notesShortcut(key('p', { meta: true, composing: true }), true, false), null)
})

test('typing targets, platforms, and a help list that labels the modifier for the platform', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isMacPlatform('MacIntel'), true)
  assert.equal(isMacPlatform('Win32'), false)
  assert.equal(shortcutList(true)[0]!.keys, '⌘P')
  assert.equal(shortcutList(false)[0]!.keys, 'Ctrl+P')
  const keys = shortcutList(false).map(s => s.keys)
  assert.equal(new Set(keys).size, keys.length)
})

const SUBJECTS: NoteSubjectOption[] = [
  { id: 'sem', name: 'Semester Five', topics: [], parentId: null },
  { id: 'os', name: 'Operating Systems', topics: ['Concurrency', 'Deadlocks', 'Paging'], parentId: 'sem', topicParents: { Deadlocks: 'Concurrency', Concurrency: null, Paging: null } },
  { id: 'ai', name: 'AI Engineering', topics: ['Agents'], topicParents: { Agents: null } },
]

test('every subject and topic with its whole path, no subject first', () => {
  const all = destinationsOf(SUBJECTS)
  assert.deepEqual(all[0], NO_SUBJECT)
  const labels = all.map(destinationLabel)
  assert.ok(labels.includes('Semester Five › Operating Systems › Concurrency › Deadlocks'))
  assert.ok(labels.includes('AI Engineering › Agents'))
  const deadlocks = all.find(d => d.topicName === 'Deadlocks')!
  assert.deepEqual([deadlocks.subjectId, deadlocks.kind], ['os', 'topic'])
})

test('searching any part of the path, the name itself first; finding the destination a note already has', () => {
  const all = destinationsOf(SUBJECTS)
  assert.deepEqual(searchDestinations(all, 'semester dead').map(destinationLabel), ['Semester Five › Operating Systems › Concurrency › Deadlocks'])
  assert.equal(destinationLabel(searchDestinations(all, 'agents')[0]!), 'AI Engineering › Agents')
  assert.equal(destinationFor(all, 'os', 'deadlocks').topicName, 'Deadlocks')
  assert.equal(destinationFor(all, 'os', null).kind, 'subject')
  assert.equal(destinationFor(all, 'gone', null), NO_SUBJECT)
})

test('a loop in the stored parents never hangs the picker', () => {
  const looped: NoteSubjectOption[] = [{ id: 'a', name: 'A', topics: ['x', 'y'], parentId: 'b', topicParents: { x: 'y', y: 'x' } }, { id: 'b', name: 'B', topics: [], parentId: 'a' }]
  assert.ok(destinationsOf(looped).length === 5)
})

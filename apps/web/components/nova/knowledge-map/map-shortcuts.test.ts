// The map's keyboard shortcuts. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHORTCUTS, enterAction, enterTarget, isMacPlatform, isTypingTarget, keyLabel, navigate, nearestTo, shortcutFor, type NavBox } from './map-shortcuts'

test('each listed key does what the help panel says', () => {
  const cases: Array<[Parameters<typeof shortcutFor>[0], string]> = [
    [{ key: '/' }, 'search'], [{ key: 'k', metaKey: true }, 'search'], [{ key: 'K', ctrlKey: true }, 'search'],
    [{ key: 'Enter' }, 'explore'], [{ key: 'Enter', shiftKey: true }, 'open'], [{ key: ' ' }, 'fold'],
    [{ key: 'Escape' }, 'escape'], [{ key: '+' }, 'zoom_in'], [{ key: '=' }, 'zoom_in'], [{ key: '-' }, 'zoom_out'],
    [{ key: '0' }, 'actual_size'], [{ key: 'f' }, 'fit'], [{ key: 'F', shiftKey: true }, 'fit'], [{ key: 'n' }, 'add'],
    [{ key: 'u' }, 'up'], [{ key: 'Delete' }, 'delete'], [{ key: 'Backspace' }, 'delete'], [{ key: '?', shiftKey: true }, 'help'],
  ]
  for (const [e, action] of cases) assert.equal(shortcutFor(e)?.action, action, JSON.stringify(e))
  assert.deepEqual(shortcutFor({ key: 'ArrowRight' }), { action: 'navigate', arrow: 'right' })
  assert.deepEqual(shortcutFor({ key: 'ArrowUp', shiftKey: true }), { action: 'pan', arrow: 'up' })
  assert.deepEqual(shortcutFor({ key: 'ArrowLeft', altKey: true, shiftKey: true }), { action: 'nudge', arrow: 'left', far: true })
  const listed = new Set(SHORTCUTS.map(s => s.action))
  for (const [e] of cases) assert.ok(listed.has(shortcutFor(e)!.action as never), 'every key has a line in the help panel')
})

test('browser and system shortcuts are left alone', () => {
  for (const e of [
    { key: 'f', ctrlKey: true }, { key: 'f', metaKey: true }, { key: '0', metaKey: true }, { key: '+', ctrlKey: true }, { key: '-', metaKey: true },
    { key: 'r', metaKey: true }, { key: 'l', ctrlKey: true }, { key: 'k', metaKey: true, shiftKey: true }, { key: 'ArrowLeft', metaKey: true },
    { key: 'Tab' }, { key: 'a' }, { key: 'f', altKey: true }, { key: 'k', altKey: true, metaKey: true },
  ]) assert.equal(shortcutFor(e), null, JSON.stringify(e))
})

test('nothing is taken while the learner types', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra })
  assert.equal(isTypingTarget(el('INPUT')), true)
  assert.equal(isTypingTarget(el('input', { type: 'search' })), true)
  assert.equal(isTypingTarget(el('TEXTAREA')), true)
  assert.equal(isTypingTarget(el('SELECT')), true)
  assert.equal(isTypingTarget(el('DIV', { isContentEditable: true })), true)
  assert.equal(isTypingTarget(el('SPAN', { closest: (s: string) => (s.includes('contenteditable') ? {} : null) })), true, 'inside an editor')
  assert.equal(isTypingTarget(el('INPUT', { type: 'checkbox' })), false)
  assert.equal(isTypingTarget(el('BUTTON')), false)
  assert.equal(isTypingTarget(el('g', { closest: () => null })), false)
  assert.equal(isTypingTarget(null), false)
})

test('modifier keys are shown for the learner’s own keyboard', () => {
  assert.equal(isMacPlatform('MacIntel'), true)
  assert.equal(isMacPlatform('macOS'), true)
  assert.equal(isMacPlatform('Win32'), false)
  assert.equal(isMacPlatform('Linux x86_64'), false)
  assert.equal(keyLabel('Mod+K', true), '⌘K')
  assert.equal(keyLabel('Mod+K', false), 'Ctrl+K')
  assert.equal(keyLabel('Shift+Enter', true), '⇧Enter')
})

// Cards where the map draws them (centre, width, height): a subject S with
// topics A, B to its right and C to its left; another subject T further right
// with topic D; a note N under A, and a card Z above T, far to the side of S.
const card = (x: number, y: number, w = 180, h = 58): NavBox => ({ x, y, w, h })
const boxes = new Map<string, NavBox>([
  ['S', card(0, 0, 208, 66)], ['A', card(300, -40)], ['B', card(300, 40)], ['C', card(-300, 0)],
  ['N', card(300, 120, 164, 48)],
  ['T', card(900, 0, 208, 66)], ['D', card(1200, 0)],
  ['Z', card(900, -300)],
])

test('the arrow keys go by where cards are on screen, across the whole map', () => {
  const to = (from: string, arrow: 'left' | 'right' | 'up' | 'down') => navigate(from, arrow, boxes).to
  assert.equal(to('S', 'left'), 'C', 'left of a subject: the card on its left, whatever it is filed under')
  assert.equal(to('C', 'right'), 'S')
  assert.equal(to('A', 'down'), 'B', 'straight below first')
  assert.equal(to('B', 'down'), 'N')
  assert.equal(to('B', 'up'), 'A')
  assert.equal(to('A', 'right'), 'T', 'across into the next subject: not limited to parent and child')
  assert.equal(to('T', 'left'), 'A', 'the nearest in line, back the other way')
  assert.equal(to('T', 'right'), 'D')
})

test('each step starts from the card reached: left, up, right, down and round again', () => {
  let at = 'B'
  const path: string[] = []
  for (const arrow of ['left', 'up', 'right', 'down', 'left', 'up', 'right', 'down'] as const) {
    const r = navigate(at, arrow, boxes)
    if (r.to) at = r.to
    path.push(at)
  }
  assert.deepEqual(path, ['S', 'S', 'A', 'B', 'S', 'S', 'A', 'B'], 'up from S: nothing above it (Z is mostly off to the side), so it stays')
})

test('nothing in that direction: the selection stays, and says so; a card mostly beside is not ahead', () => {
  const r = navigate('D', 'right', boxes)
  assert.equal(r.to, null)
  assert.match((r as { why: string }).why, /No card to the right/)
  assert.equal(navigate('C', 'left', boxes).to, null)
  assert.notEqual(navigate('T', 'up', boxes).to, null, 'a card well above and only a little aside still counts')
  assert.equal(navigate('S', 'up', boxes).to, null, 'Z is far more aside than above S: not "up"')
  assert.equal(nearestTo({ x: 280, y: 0 }, boxes), 'A', 'with nothing selected, the card nearest the middle of the view starts')
})

test('Enter acts on the card chosen last, never a stale one', () => {
  const onMap = new Set(['a', 'b', 'c', 'd'])
  // Search picked b; then arrows to c, then d; focus is still catching up on c.
  assert.equal(enterTarget({ chosen: 'd', focused: 'c', selected: 'd', onMap }), 'd')
  // Tab reached c without selecting it: c is chosen.
  assert.equal(enterTarget({ chosen: 'c', focused: 'c', selected: 'a', onMap }), 'c')
  // Nothing chosen this visit: the focused card, then the selection.
  assert.equal(enterTarget({ chosen: null, focused: 'b', selected: 'a', onMap }), 'b')
  assert.equal(enterTarget({ chosen: null, focused: null, selected: 'a', onMap }), 'a')
  // A card deleted since is never acted on.
  assert.equal(enterTarget({ chosen: 'gone', focused: null, selected: 'gone', onMap }), null)
})

test('Enter explores; a card with nothing inside opens details; the explored card does nothing twice', () => {
  const explorable = (id: string) => id === 'unit'
  assert.equal(enterAction('unit', { exploring: null, explorable }), 'explore')
  assert.equal(enterAction('leaf', { exploring: null, explorable }), 'details')
  assert.equal(enterAction('unit', { exploring: 'unit', explorable }), 'already')
  assert.equal(enterAction(null, { exploring: null, explorable }), 'none')
})

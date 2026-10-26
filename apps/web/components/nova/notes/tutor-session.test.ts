// The tutor conversation the page keeps, and what goes into a note from it.
// Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TutorReply } from '@repo/api/nova/product/note-tutor.types'
import { NOTE_BODY_MAX } from '@repo/api/nova/product/notes.types'
import {
  citationsAsLinks, historyOf, insertFor, loadConversation, nextActions, openExercise, placeInto, resultsOf, saveConversation,
  type TutorEntry,
} from './tutor-session'
import { hasParkedNoteCapture, parkNoteCapture, takeNoteCapture } from './pending-note-capture'

const sources: TutorReply['sources'] = [
  { id: 'S1', kind: 'note', recordId: 'n1', title: 'Deadlocks', domain: null, url: null },
  { id: 'S2', kind: 'note', recordId: 'n2', title: "Banker's algorithm", domain: null, url: null },
  { id: 'S3', kind: 'resource', recordId: 'r1', title: 'OS book ch. 7', domain: 'example.edu', url: 'https://example.edu/ch7' },
]
const reply = (over: Partial<TutorReply> = {}): TutorReply => ({
  ok: true, mode: 'explain', sources, noteVersion: 'v1', versionDiffers: false, passage: null, partial: false,
  sections: [], steps: [], exercise: null, quiz: [], ideas: [], cards: [], verdict: null, organize: null, related: [], followUps: [], notInSources: false,
  ...over,
})
const nova = (id: string, r: TutorReply, work = {}): TutorEntry => ({ id, role: 'nova', reply: r, work, at: 0 })

function memoryStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

test('the request carries the last turns, oldest first, bounded; and how the last answers went', () => {
  const entries: TutorEntry[] = []
  for (let i = 0; i < 6; i++) {
    entries.push({ id: `l${i}`, role: 'learner', ask: { mode: 'explain', message: `question ${i}`, passage: i === 5 ? 'hold and wait' : undefined }, at: 0 })
    entries.push(nova(`n${i}`, reply({ sections: [{ basis: 'notes', heading: null, text: `answer ${i} [S1]` }], verdict: i === 4 ? { result: 'incorrect', feedback: 'no', next: '' } : null })))
  }
  entries.push({ id: 'e', role: 'error', message: 'down', ask: { mode: 'quiz' }, at: 0 })
  const h = historyOf(entries)
  assert.equal(h.length, 8)
  assert.equal(h.at(-1)!.role, 'nova')
  assert.ok(h.at(-2)!.text.includes('about: "hold and wait"'), 'the passage travels with the question')
  assert.ok(!h.some(t => t.text.includes('down')), 'an error is not part of the conversation')
  assert.deepEqual(resultsOf(entries), ['incorrect'])
})

test('an exercise is open until its answer has been checked, and only the newest reply counts', () => {
  const ex = { question: 'Name them', kind: 'open' as const, choices: [], answer: 'four', hint: null, basis: 'notes' as const }
  assert.equal(openExercise([nova('a', reply({ mode: 'practice', exercise: ex }))])?.entry.id, 'a')
  assert.equal(openExercise([nova('a', reply({ mode: 'practice', exercise: ex }), { checked: true })]), null)
  assert.equal(openExercise([nova('a', reply({ mode: 'practice', exercise: ex })), nova('b', reply())]), null)
})

test('what is offered next follows from where the learner is, and is never a wall', () => {
  assert.deepEqual(nextActions({ passage: true, last: null, empty: false }), ['explain', 'example', 'steps', 'check'])
  assert.deepEqual(nextActions({ passage: false, last: null, empty: true }), ['organize', 'brainstorm'])
  assert.deepEqual(nextActions({ passage: false, last: reply({ mode: 'evaluate', verdict: { result: 'incorrect', feedback: '', next: '' } }), empty: false }), ['simpler', 'steps', 'practice'])
  for (const mode of ['explain', 'quiz', 'organize', 'connect'] as const) assert.ok(nextActions({ passage: false, last: reply({ mode }), empty: false }).length <= 4)
})

test('citations become links to the notes they name; the note itself is dropped', () => {
  assert.equal(citationsAsLinks('Four conditions [S1]. Avoided by checking [S2]. See [S3]. Not [S9].', sources),
    "Four conditions. Avoided by checking [[Banker's algorithm]]. See (OS book ch. 7). Not [S9].")
})

test('what goes into a note is labelled as Nova\'s, with Nova\'s own additions marked apart', () => {
  const md = insertFor(reply({ passage: { text: 'x', heading: 'Avoidance', found: true }, sections: [
    { basis: 'notes', heading: 'The idea', text: 'Four conditions [S1].' },
    { basis: 'nova', heading: null, text: 'Think of two forks.' },
  ] }), {})!
  assert.ok(md.startsWith('> [!note] Nova: explain this (Avoidance)'))
  assert.ok(md.includes('> **The idea**\n> Four conditions.'))
  assert.ok(md.includes("> *Nova's own explanation, beyond your notes:* Think of two forks."))
  for (const line of md.split('\n')) assert.ok(line.startsWith('>'), 'all inside the callout')
})

test('a quiz goes in folded, with the right answers marked; brainstorm keeps only the ideas ticked', () => {
  const q = insertFor(reply({ mode: 'quiz', quiz: [{ question: 'Which?', choices: ['a', 'b'], answer: 1, why: 'Because [S2].', basis: 'notes' }] }), {})!
  assert.ok(q.startsWith('> [!question]- Practice questions (Nova)'))
  assert.ok(q.includes('>    - b ✓'))
  assert.ok(q.includes("[[Banker's algorithm]]"))
  const ideas = reply({ mode: 'brainstorm', ideas: [{ title: 'One', text: '', basis: 'nova' }, { title: 'Two', text: 'from notes [S1]', basis: 'notes' }] })
  const kept = insertFor(ideas, { chosen: { 1: true } }, 'ideas')!
  assert.ok(kept.includes('**Two**') && !kept.includes('**One**'))
  assert.equal(insertFor(reply(), {}), null, 'nothing to add is nothing')
})

test('an addition goes on lines of its own, at the end or at the cursor\'s line, and changes nothing else', () => {
  const body = 'First line\nSecond line\n\nThird'
  assert.equal(placeInto(body, 'ADDED', null), 'First line\nSecond line\n\nThird\n\nADDED\n')
  assert.equal(placeInto(body, 'ADDED', 3), 'First line\n\nADDED\n\nSecond line\n\nThird')
  assert.equal(placeInto('', 'ADDED', null), 'ADDED\n')
  for (const at of [null, 0, 5, 12, 999]) {
    const out = placeInto(body, 'ADDED', at)
    assert.equal(out.split('ADDED').join('').split('\n').filter(Boolean).join('|'), 'First line|Second line|Third', `nothing lost at ${at}`)
  }
  assert.ok(NOTE_BODY_MAX > 0)
})

test('the conversation is kept per note in this tab, bounded, and a damaged store is ignored', () => {
  const s = memoryStore()
  const entries: TutorEntry[] = Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, role: 'learner' as const, ask: { mode: 'explain' as const }, at: i }))
  saveConversation(s, 'n1', entries)
  assert.equal(loadConversation(s, 'n1').length, 40)
  assert.deepEqual(loadConversation(s, 'n2'), [])
  s.m.set('kivo-tutor:n3', '{bad json')
  assert.deepEqual(loadConversation(s, 'n3'), [])
  s.m.set('kivo-tutor:n4', JSON.stringify([{ id: 'x', role: 'system' }, { id: 'y', role: 'learner', ask: { mode: 'explain' }, at: 0 }]))
  assert.equal(loadConversation(s, 'n4').length, 1)
  saveConversation(s, 'n1', [])
  assert.equal(s.m.has('kivo-tutor:n1'), false)
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }
  assert.deepEqual(loadConversation(broken, 'n1'), [])
  assert.doesNotThrow(() => saveConversation(broken, 'n1', entries))
})

test('a capture survives sign-in for ten minutes, once; a Saved capture is left to Saved', () => {
  const s = memoryStore()
  parkNoteCapture('#url=https%3A%2F%2Fexample.edu%2Fch7&text=A%20passage&via=bookmarklet', s, 1000)
  assert.equal(hasParkedNoteCapture(s, 2000), true)
  assert.deepEqual(takeNoteCapture('', s, 2000), { url: 'https://example.edu/ch7', title: '', text: 'A passage', via: 'bookmarklet' })
  assert.equal(takeNoteCapture('', s, 3000), null, 'taken once')
  parkNoteCapture('#url=https%3A%2F%2Fexample.edu&text=x', s, 0)
  assert.equal(hasParkedNoteCapture(s, 11 * 60_000), false, 'stale after ten minutes')
  parkNoteCapture('#save=https%3A%2F%2Fexample.edu&title=x', s, 0)
  assert.equal(hasParkedNoteCapture(s, 1), false)
  assert.deepEqual(takeNoteCapture('#text=from%20the%20address', s, 0)?.text, 'from the address')
})

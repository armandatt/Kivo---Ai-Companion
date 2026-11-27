// Bug batch 28 Nov, item 12: the plan Nova prepared is a suggestion until taken. Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const card = readFileSync(new URL('./prepared-plan.tsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../nova-home.tsx', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./playground.tsx', import.meta.url), 'utf8')

test('REGRESSION item 12: the prepared plan is taken only by the learner, item by item, through the ordinary approve', () => {
  assert.match(card, /data-prepared-take/)
  assert.match(card, /aria-pressed=\{!off\}/, 'each item can be kept or skipped')
  assert.match(card, /data-prepared-tweak/)
  assert.match(card, /data-prepared-dismiss/)
  assert.match(home, /const r = await day\.approve\(p, keep\); if \(r\.ok\) void prepared\.close\('taken'\)/)
  assert.doesNotMatch(card, /useEffect\([^)]*approve/, 'never applied on load')
})

test('REGRESSION item 12: both ways in on the empty studio, Plan with Nova and Propose a plan', () => {
  assert.match(studio, /data-plan-with-nova/)
  assert.match(studio, /data-propose-plan/)
})

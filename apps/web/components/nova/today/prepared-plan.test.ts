// Bug batch 28 Nov, item 12: the plan Nova prepared is a suggestion until taken, and opens at once. Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../nova-home.tsx', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./playground.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8')

test('REGRESSION item 12: Propose a plan opens the prepared plan at once as the studio proposal, composing only when none is ready', () => {
  assert.match(home, /if \(prepared\.plan\) \{ offer\(prepared\.plan\); return \}/)
  assert.match(home, /setComposing\(true\)/)
  assert.match(studio, /<Composing \/>/)
  assert.match(studio, /data-plan-ready/)
})

test('REGRESSION item 12: taken only through the ordinary approve, then closed for the day', () => {
  assert.match(home, /if \(r\.ok && prepared\.plan && p\.id === prepared\.plan\.pending\.id\) void prepared\.close\('taken'\)/)
})

test('REGRESSION item 12: the plan deals in, sweeps and fills; and none of it moves with reduced motion', () => {
  for (const k of ['plan-deal', 'plan-sweep', 'plan-fill', 'plan-compose']) assert.match(css, new RegExp(`@keyframes ${k}`))
  assert.match(css, /\.kivo-app \.plan-deal, \.kivo-app \.plan-fill \{ animation: none !important; \}/)
  assert.match(studio, /dealt \? 'plan-deal' : 'nova-reveal'/)
})

test('both ways in on the empty studio, Plan with Nova and Propose a plan', () => {
  assert.match(studio, /data-plan-with-nova/)
  assert.match(studio, /data-propose-plan/)
})

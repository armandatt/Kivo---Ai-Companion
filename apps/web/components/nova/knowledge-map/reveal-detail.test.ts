// Bringing the details into view on a narrow screen only. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PANEL_BESIDE_QUERY, revealDetail } from './reveal-detail'

function setup({ wide, still = false }: { wide: boolean; still?: boolean }) {
  const calls: ScrollIntoViewOptions[] = []
  const panel = { scrollIntoView: (o?: boolean | ScrollIntoViewOptions) => { calls.push(o as ScrollIntoViewOptions) } }
  const win = { matchMedia: (q: string) => ({ matches: q === PANEL_BESIDE_QUERY ? wide : q.includes('reduced-motion') ? still : false }) }
  return { panel, win, calls }
}

test('on a phone the details are scrolled into view, with the least movement', () => {
  const { panel, win, calls } = setup({ wide: false })
  assert.equal(revealDetail(panel, win), true)
  assert.deepEqual(calls, [{ block: 'nearest', behavior: 'smooth' }])
})

test('with reduced motion the scroll is instant', () => {
  const { panel, win, calls } = setup({ wide: false, still: true })
  revealDetail(panel, win)
  assert.deepEqual(calls, [{ block: 'nearest', behavior: 'auto' }])
})

test('on a wide screen the panel is beside the canvas and the page does not move', () => {
  const { panel, win, calls } = setup({ wide: true })
  assert.equal(revealDetail(panel, win), false)
  assert.deepEqual(calls, [])
})

test('with no panel drawn nothing happens', () => {
  const { win } = setup({ wide: false })
  assert.equal(revealDetail(null, win), false)
})

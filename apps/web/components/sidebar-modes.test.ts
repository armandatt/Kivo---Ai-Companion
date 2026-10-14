// What the sidebar does in each mode. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sidebarModes } from './sidebar-modes'

test('on Creature the shell draws the only menu button, at every state', () => {
  for (const open of [true, false]) {
    for (const isMobileOpen of [true, false]) {
      assert.equal(sidebarModes({ overlay: true, open, isMobileOpen, docked: false }).ownToggle, false)
    }
  }
  assert.equal(sidebarModes({ overlay: false, open: true, isMobileOpen: false, docked: false }).ownToggle, true)
})

test('the open Creature overlay covers the world at every width, and nothing is locked', () => {
  const m = sidebarModes({ overlay: true, open: true, isMobileOpen: false, docked: false })
  assert.equal(m.covering, true)
  assert.equal(m.backdrop, 'every_width')
  assert.equal(m.lockScroll, false)
  assert.equal(m.closeButton, true)
  assert.equal(m.collapsible, false)
})

test('the sidebar\'s own drawer state means nothing on Creature', () => {
  const m = sidebarModes({ overlay: true, open: false, isMobileOpen: true, docked: false })
  assert.equal(m.covering, false)
  assert.equal(m.backdrop, 'none')
  assert.equal(m.lockScroll, false)
})

test('a docked sidebar covers the page only while its small-screen drawer is open', () => {
  const closed = sidebarModes({ overlay: false, open: true, isMobileOpen: false, docked: false })
  assert.equal(closed.covering, false)
  assert.equal(closed.backdrop, 'none')
  assert.equal(closed.lockScroll, false)

  const drawer = sidebarModes({ overlay: false, open: true, isMobileOpen: true, docked: false })
  assert.equal(drawer.covering, true)
  assert.equal(drawer.backdrop, 'small_screens')
  assert.equal(drawer.lockScroll, true)
  assert.equal(drawer.closeButton, false)
  assert.equal(drawer.collapsible, true)
})

test('a docked sidebar the shell has hidden covers nothing', () => {
  const m = sidebarModes({ overlay: false, open: false, isMobileOpen: true, docked: false })
  assert.equal(m.covering, false)
  assert.equal(m.lockScroll, false)
})

test('a closed drawer is inert at once, whatever its slide is still doing', () => {
  assert.equal(sidebarModes({ overlay: false, open: true, isMobileOpen: false, docked: false }).inert, true)
  assert.equal(sidebarModes({ overlay: false, open: true, isMobileOpen: true,  docked: false }).inert, false)
  assert.equal(sidebarModes({ overlay: true,  open: false, isMobileOpen: false, docked: true }).inert, true)
  assert.equal(sidebarModes({ overlay: true,  open: true,  isMobileOpen: false, docked: false }).inert, false)
})

test('the sidebar beside the page on a wide window is never inert', () => {
  assert.equal(sidebarModes({ overlay: false, open: true, isMobileOpen: false, docked: true }).inert, false)
  assert.equal(sidebarModes({ overlay: false, open: true, isMobileOpen: false, docked: true }).covering, false)
})

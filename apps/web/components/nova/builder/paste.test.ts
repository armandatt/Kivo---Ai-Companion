// Screenshots pasted into the message box. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imagesOnClipboard, pastedName, shrunkSize } from './paste'

const file = (name: string, type: string) => ({ name, type, size: 10 }) as unknown as File
const item = (kind: string, type: string, f: File | null) => ({ kind, type, getAsFile: () => f })

test('only images on the clipboard become attachments; pasted text stays text', () => {
  const png = file('image.png', 'image/png')
  assert.deepEqual(imagesOnClipboard([item('string', 'text/plain', null), item('file', 'image/png', png), item('file', 'application/pdf', file('a.pdf', 'application/pdf'))]), [png])
  assert.deepEqual(imagesOnClipboard([item('string', 'text/html', null)]), [])
})

test('a pasted image gets a name of its own', () => {
  assert.equal(pastedName([], 'image/png'), 'Screenshot 1.png')
  assert.equal(pastedName(['Screenshot 1.png', 'Screenshot 2.png'], 'image/png'), 'Screenshot 3.png')
  assert.equal(pastedName(['Screenshot 1.png'], 'image/jpeg'), 'Screenshot 1.jpg')
})

test('a big screenshot is scaled to fit, keeping its shape; a small one is left as it is', () => {
  assert.deepEqual(shrunkSize(4000, 2000), { width: 2000, height: 1000 })
  assert.deepEqual(shrunkSize(1200, 800), { width: 1200, height: 800 })
})

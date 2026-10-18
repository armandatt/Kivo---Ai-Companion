// The legal pages and their footer links. Run with `npm test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { TO_CONFIRM } from './to-confirm'

const web = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const pages = { privacy: web('app/(legal)/privacy/page.tsx'), terms: web('app/(legal)/terms/page.tsx') }
const frame = web('components/legal/legal-page.tsx')
const used = (src: string) => [...src.matchAll(/<Confirm id="(\w+)"/g)].map(m => m[1]!)

test('every placeholder on the pages is a listed fact, and every listed fact is shown somewhere', () => {
  const all = new Set([...used(pages.privacy), ...used(pages.terms), ...used(frame)])
  for (const id of all) assert.ok(id in TO_CONFIRM, `unlisted placeholder ${id}`)
  for (const id of Object.keys(TO_CONFIRM)) assert.ok(all.has(id), `listed but never shown: ${id}`)
})

test('a page with facts still to confirm is marked as a draft and kept out of search results', () => {
  assert.match(frame, /Draft\./)
  assert.match(frame, /not legal advice/)
  for (const [name, src] of Object.entries(pages)) {
    if (used(src).length > 0) assert.match(src, /robots: \{ index: false/, name)
  }
})

test('the footer links to the real pages and has no Security link', () => {
  const footer = web('components/footer.tsx')
  assert.match(footer, /label: "Privacy", href: "\/privacy"/)
  assert.match(footer, /label: "Terms", href: "\/terms"/)
  assert.doesNotMatch(footer, /Security/)
})

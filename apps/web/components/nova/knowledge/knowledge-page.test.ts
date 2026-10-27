// What the Knowledge page may do. Run with `npm test`.
//
// Knowledge reads; the learning structure is changed in Build with Nova. The
// page's files are read as text, so a structure-editing call or an "edit with
// Nova" control added back here fails this.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const dir = new URL('./', import.meta.url)
const page = readFileSync(new URL('../../../app/(dashboard)/knowledge/page.tsx', import.meta.url), 'utf8')
const files = readdirSync(dir).filter(f => f.endsWith('.tsx'))
const sources = Object.fromEntries(files.map(f => [f, readFileSync(new URL(f, dir), 'utf8')]))
const all = [page, ...Object.values(sources)].join('\n')

test('nothing on the page changes the learning structure', () => {
  for (const route of ['/api/nova/subjects', '/api/nova/subjects/propose', '/api/nova/builder', '/api/nova/workspaces/propose']) {
    assert.ok(!all.includes(`'${route}'`) && !all.includes(`"${route}"`) && !all.includes(`\`${route}`), `calls ${route}`)
  }
  assert.doesNotMatch(all, /Edit subjects? with Nova|Ask Nova to update|Edit subjects/)
  assert.ok(!files.includes('subject-studio.tsx'), 'Subject Studio is not part of Knowledge')
})

test('"Edit learning structure" opens Build with Nova, on the workspace when there is one', () => {
  const main = sources['nova-knowledge.tsx']
  assert.match(main, /Edit learning structure/)
  assert.match(main, /`\/build\?improve=\$\{encodeURIComponent\(workspace\)\}`/)
  assert.match(main, /: '\/build'/)
})

test('the explorer is a tree to assistive technology, and the address names what is shown', () => {
  const explorer = sources['knowledge-explorer.tsx']
  for (const attr of ['role="tree"', 'role="treeitem"', 'aria-level=', 'aria-expanded=', 'aria-selected=']) assert.ok(explorer.includes(attr), attr)
  const main = sources['nova-knowledge.tsx']
  assert.match(main, /history\.pushState/)
  assert.match(main, /addEventListener\('popstate'/)
  assert.match(main, /aria-current="page"/)
})

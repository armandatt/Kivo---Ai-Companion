// The landing page's previews and links. Run with `npm test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { identifyPaper } from '@repo/api/nova/product/paper-source'
import { layoutMap, treeOf, TREE_EDGES } from '../nova/knowledge-map/layout'
import { insideOf } from '../nova/knowledge-map/explore'
import { DEMO_EDGES, DEMO_NODES } from './demo-map-data'

const web = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const DEMOS = ['hero', 'map-demo', 'build-demo', 'notes-demo', 'today-demo', 'frame', 'demos'].map(f => [f, web(`components/landing/${f}.tsx`)] as const)

test('the sample map is laid out by the real map engine: every card placed, a tree under each subject', () => {
  const layout = layoutMap(DEMO_NODES, DEMO_EDGES.filter(e => TREE_EDGES.has(e.kind)))
  for (const n of DEMO_NODES) assert.ok(layout.at.has(n.id), `not placed: ${n.id}`)
  const tree = treeOf(DEMO_NODES, DEMO_EDGES)
  assert.deepEqual(tree.roots.sort(), ['subject:fin', 'subject:ml', 'subject:os'])
  // A subject inside a subject, and topics inside topics: something to explore.
  assert.ok(insideOf(tree, 'subject:ml').has('topic:backprop'))
  assert.equal(tree.parent.get('topic:sched'), 'topic:proc')
})

test('the previews use the map’s own cards and explore rules, not a copy', () => {
  const map = web('components/landing/map-demo.tsx')
  assert.match(map, /from '@\/components\/nova\/knowledge-map\/card-face'/)
  assert.match(map, /from '@\/components\/nova\/knowledge-map\/explore'/)
  assert.match(web('components/nova/knowledge-map/knowledge-map.tsx'), /from '\.\/card-face'/)
})

test('no preview sends a request or stores anything: they are local samples', () => {
  for (const [name, src] of DEMOS) {
    for (const word of ['fetch(', 'localStorage', 'sessionStorage', 'XMLHttpRequest', "'/api/", '"/api/', '`/api/']) assert.equal(src.includes(word), false, `${name} uses ${word}`)
  }
})

test('every in-page link has a section to land on, and the header and footer only link to real places', () => {
  const page = [web('components/landing/sections.tsx'), web('components/landing/hero.tsx'), web('components/faq.tsx'), web('components/pricing.tsx'), web('components/header.tsx'), web('components/footer.tsx')].join('\n')
  const ids = new Set([...page.matchAll(/id="([a-z-]+)"/g)].map(m => m[1]))
  for (const [, anchor] of page.matchAll(/["'](?:\/)?#([a-z-]+)["']/g)) assert.ok(ids.has(anchor), `nothing has id="${anchor}"`)
  assert.doesNotMatch(web('components/footer.tsx'), /href="#"/)
})

test('the paper sources the page names are the ones the importer recognises', () => {
  const samples: Record<string, string> = {
    arXiv: 'https://arxiv.org/abs/1706.03762', DOI: 'https://doi.org/10.1038/nature14539', 'Semantic Scholar': 'https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776',
    OpenReview: 'https://openreview.net/forum?id=rJ4km2R5t7', PubMed: 'https://pubmed.ncbi.nlm.nih.gov/32269191/', 'PubMed Central': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7096724/',
  }
  const sections = web('components/landing/sections.tsx')
  for (const [name, url] of Object.entries(samples)) {
    assert.ok(sections.includes(`'${name}'`), `the page doesn't name ${name}`)
    assert.equal(identifyPaper(url).ok, true, `${name} isn't recognised`)
  }
})

test('the hero says what Kivo is and keeps the robot, and nothing promises a store listing that does not exist', () => {
  const hero = web('components/landing/hero.tsx')
  assert.match(hero, /Turn what you learn into/)
  assert.match(hero, /<SplineBot/)
  assert.match(web('components/landing/sections.tsx'), /not yet in the Chrome Web Store/)
})

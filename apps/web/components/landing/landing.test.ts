// The landing page's previews and links. Run with `npm test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { identifyPaper } from '@repo/api/nova/product/paper-source'
import { layoutMap, treeOf, TREE_EDGES } from '../nova/knowledge-map/layout'
import { insideOf } from '../nova/knowledge-map/explore'
import { DEMO_EDGES, DEMO_NODES } from './demo-map-data'

const web = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const DEMOS = ['hero', 'hero-sparkles', 'map-demo', 'build-demo', 'notes-demo', 'workspace-demo', 'telegram-demo', 'focus-demo', 'creature-demo', 'extension-demo', 'frame', 'demos'].map(f => [f, web(`components/landing/${f}.tsx`)] as const)

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

test('the hero says Kivo is a learning OS with a second brain, and the extension is no longer called unlisted', () => {
  const hero = web('components/landing/hero.tsx')
  assert.match(hero, /AI-powered second brain/)
  assert.match(hero, /Your learning OS, <\/span><span[^>]*>with a second brain\./)
  assert.match(hero, /href="#build"/)
  assert.doesNotMatch(web('components/landing/sections.tsx'), /not yet in the Chrome Web Store/)
})

test('the robot stands where the original hero had it: its own column, a 520px stage, floating on botFloat', () => {
  const hero = web('components/landing/hero.tsx')
  assert.match(hero, /grid items-center gap-12 md:grid-cols-2 lg:gap-16/)
  assert.match(hero, /style=\{\{ minHeight: '520px' \}\}/)
  assert.match(hero, /hero-robot relative h-\[520px\] w-full">\s*<SplineBot className="h-full w-full" \/>/)
  assert.match(web('app/globals.css'), /\.hero-robot \{[^}]*botFloat 7s ease-in-out/)
  assert.match(web('app/globals.css'), /@keyframes botFloat \{ 0%, 100% \{ transform: translateY\(0px\); \} 50% \{ transform: translateY\(-10px\); \} \}/)
  // Nova's walkthrough is its own section below, not a window in the hero.
  assert.doesNotMatch(hero, /AppWindow/)
  const page = web('app/page.tsx')
  const at = (s: string) => page.indexOf(s)
  const order = ['<LandingHero />', '<BuildSection />', '<MapSection />', '<WorkspaceSection />', '<NotesSection />', '<ExtensionSection />', '<MentorSection />', '<FocusSection />', '<CreatureSection />', '<Capabilities />']
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]!) >= 0 && at(order[i - 1]!) < at(order[i]!), `${order[i - 1]} before ${order[i]}`)
})

test('the Knowledge Map is marketed as the AI-powered Second Brain, without renaming the app', () => {
  assert.match(web('components/landing/sections.tsx'), /eyebrow="AI-powered Second Brain"/)
})

test('pricing, FAQ and the last call to action are readable without JavaScript: no hidden first state', () => {
  for (const f of ['components/pricing.tsx', 'components/faq.tsx', 'components/final-cta.tsx']) {
    const src = web(f)
    assert.doesNotMatch(src, /isVisible/, f)
    assert.doesNotMatch(src, /"opacity-0/, f)
  }
})

test('section words are drawn in place and only hidden after the page starts, so they read without JavaScript', () => {
  const frame = web('components/landing/frame.tsx')
  const reveal = frame.slice(frame.indexOf('export function Reveal'))
  assert.match(reveal, /useState<'still' \| 'waiting' \| 'shown'>\('still'\)/)
  assert.doesNotMatch(reveal, /initial=\{\{ opacity: 0/)
})

test('motion is quick: the hero settles in well under half a second, reveals in 300 ms, demos step every three seconds or less', () => {
  const css = web('app/globals.css')
  assert.match(css, /\.hero-in \{ animation: hero-in 0\.32s/)
  assert.match(css, /\.hero-robot \{ animation: hero-robot-in 0\.45s ease-out both, botFloat 7s ease-in-out 0\.45s infinite; \}/)
  const delays = [...web('components/landing/hero.tsx').matchAll(/animationDelay: '(\d+)ms'/g)].map(m => Number(m[1]))
  assert.ok(Math.max(...delays) <= 200, `hero delays ${delays}`)
  assert.match(web('components/landing/frame.tsx'), /duration-300 ease/)
  for (const f of ['build-demo', 'notes-demo', 'map-demo', 'workspace-demo', 'telegram-demo', 'focus-demo', 'creature-demo', 'extension-demo']) {
    const src = web(`components/landing/${f}.tsx`)
    for (const m of src.matchAll(/useStory\([^,]+, (\d+)\)/g)) assert.ok(Number(m[1]) <= 3000, `${f} steps every ${m[1]} ms`)
    for (const m of src.matchAll(/duration: (?:reduced \? 0 : )?(\d*\.?\d+)/g)) assert.ok(Number(m[1]) <= 0.35, `${f} has a ${m[1]} s transition`)
  }
})

test('the workspace preview is one sample subject in three views, said to be a preview, with nothing live', () => {
  const demo = web('components/landing/workspace-demo.tsx')
  for (const tab of ['Second Brain', 'Notes & Tutor', 'Today’s Learning']) assert.ok(demo.includes(`'${tab}'`), tab)
  assert.match(demo, /no AI is running/)
  assert.match(demo, /From your note/)
  assert.match(demo, /Nothing changes until you apply it/)
  // It plays itself, and the visitor's click takes it over.
  assert.match(demo, /useStory\(TOUR\.length, STEP_MS\)/)
  assert.match(demo, /const STEP_MS = (\d+)/)
  assert.ok(Number(/const STEP_MS = (\d+)/.exec(demo)![1]) <= 2500)
  assert.match(demo, /if \(playing\) s\.go\(step\)/)
})

test('the Telegram preview uses the bot’s own buttons and lines, in English and Hinglish, and steps quickly', async () => {
  const demo = web('components/landing/telegram-demo.tsx')
  const bot = readFileSync(new URL('../../../../packages/api/src/nova/telegram/telegram-replies.ts', import.meta.url), 'utf8')
  for (const label of ['"Later"', '"Not today"', '"Pause"', '"End"', '"Open Nova"']) assert.ok(bot.includes(`label: ${label}`), label)
  for (const label of ['Later', 'Not today', 'Pause', 'End', 'Open Nova', 'Struggled', 'Okay', 'Good', 'Crushed it']) assert.ok(demo.includes(`'${label}'`), label)
  assert.match(bot, /How did it go\?/)
  assert.match(bot, /Logged: \$\{ended\.minutes\} min\$\{what\}/)
  assert.match(demo, /How did it go\?/)
  assert.match(demo, /Logged: 25 min on Gradient descent\. Good\./)
  assert.match(demo, /en: \{/)
  assert.match(demo, /hi: \{/)
  assert.match(demo, /'Hinglish'/)
  assert.ok(Number(/const STEP_MS = (\d+)/.exec(demo)![1]) <= 3000)
})

test('the focus room and creature previews draw from the app’s own scenes, sounds and village', () => {
  const focus = web('components/landing/focus-demo.tsx')
  assert.match(focus, /from '@\/components\/nova\/focus\/focus-scene'/)
  assert.match(focus, /from '@\/lib\/focus\/soundscapes'/)
  assert.doesNotMatch(focus, /new SoundEngine/)
  const creature = web('components/landing/creature-demo.tsx')
  assert.match(creature, /from '@\/lib\/creature\/places'/)
  assert.match(creature, /CREATURE_DAYS_PER_LEVEL/)
  assert.match(creature, /the real world is 3D/)
})

test('the extension preview uses the popup’s own words and shows only what version 1.0.0 does', () => {
  const demo = web('components/landing/extension-demo.tsx')
  const popup = readFileSync(new URL('../../../extension/src/popup.js', import.meta.url), 'utf8')
  for (const words of ['Save to Nova', 'Study this', 'Save selection', 'Ask Nova', 'Passage saved.']) {
    assert.ok(popup.includes(`'${words}'`), `the popup doesn't say ${words}`)
    assert.ok(demo.includes(words), `the preview doesn't say ${words}`)
  }
  assert.doesNotMatch(demo, /[Ss]creenshot/)
  // An outside link only to the store, opened safely.
  const sections = web('components/landing/sections.tsx')
  assert.match(sections, /const CHROME_STORE_URL: string \| null = (null|'https:\/\/chromewebstore\.google\.com\/detail\/[^']+')/)
  assert.match(sections, /href=\{CHROME_STORE_URL\} target="_blank" rel="noopener noreferrer"/)
})

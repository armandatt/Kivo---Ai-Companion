// The extension's own modules, and an audit of what it is able to do at all.
// Run: npm test --workspace nova-extension   (node --test, no dependencies)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { ADAPTERS, describePage } from '../src/lib/page.js'
import { WORDS, buildCapture, buildEvent, buildQuestion, createClient, disconnectOutcome, newActionId } from '../src/lib/api.js'
import { createStore } from '../src/lib/store.js'
import { NO_PROBE, probePage, readProbe } from '../src/lib/browser.js'
import { REGION_SHOT_KEEP_MS, cropArea, freshShot } from '../src/lib/region.js'
import { inline, parse } from '../src/lib/markdown.js'
import { HISTORY_SENT, THREADS_KEPT, createThreads, historyOf, threadKey } from '../src/lib/thread.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src  = name => readFileSync(join(root, 'src', name), 'utf8')
const sources = ['popup.js', 'sidepanel.js', 'background.js', 'region-overlay.js', 'lib/api.js', 'lib/browser.js', 'lib/markdown.js', 'lib/page.js', 'lib/region.js', 'lib/store.js', 'lib/thread.js', 'lib/ui.js'].map(name => ({ name, text: src(name) }))
const code = text => text.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*')).join('\n')

// ── What the extension is allowed to do ───────────────────────────────────────

test('manifest: activeTab, scripting, sidePanel and storage, and nothing else', () => {
  const manifest = JSON.parse(src('manifest.template.json'))
  assert.equal(manifest.manifest_version, 3)
  // sidePanel: Ask Nova opens beside the page. It reaches no page and adds no install warning.
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'sidePanel', 'storage'])
  assert.equal(Number(manifest.minimum_chrome_version) >= 116, true, 'sidePanel.open needs Chrome 116')
  for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'web_accessible_resources', 'externally_connectable', 'content_security_policy', 'chrome_url_overrides', 'devtools_page', 'side_panel', 'omnibox', 'commands']) {
    assert.equal(manifest[key], undefined, `${key} is not declared`)
  }
  assert.ok(!JSON.stringify(manifest).match(/<all_urls>|\*:\/\/|history|tabs"|webRequest|cookies|bookmarks|clipboard|downloads|webNavigation|debugger/))
  assert.deepEqual(Object.keys(manifest.action).sort(), ['default_icon', 'default_popup', 'default_title'])
})

test('no content script, and one worker with one job: while the popup is closed nothing runs but the picture of an area the learner selected', () => {
  assert.deepEqual(readdirSync(join(root, 'src')).filter(n => !n.endsWith(' 2')).sort(), ['background.js', 'lib', 'manifest.template.json', 'popup.css', 'popup.html', 'popup.js', 'region-overlay.js', 'sidepanel.css', 'sidepanel.html', 'sidepanel.js'])
  assert.deepEqual(readdirSync(join(root, 'src', 'lib')).sort(), ['api.js', 'browser.js', 'markdown.js', 'page.js', 'region.js', 'store.js', 'thread.js', 'ui.js'])
  assert.deepEqual(JSON.parse(src('manifest.template.json')).background, { service_worker: 'background.js', type: 'module' })
  const worker = code(src('background.js'))
  assert.equal((worker.match(/\.addListener\(/g) ?? []).length, 1, 'it listens for one thing')
  assert.match(worker, /chrome\.runtime\.onMessage\.addListener/)
  assert.match(worker, /sender\.id !== chrome\.runtime\.id/, 'only its own overlay')
  assert.ok(!worker.match(/executeScript|tabs\.query|tabs\.get|onUpdated|onActivated|alarms|fetch\(/), 'it reads no tab and calls no server')
})

test('the area selector reads nothing from the page and is off the page before the picture', () => {
  const overlay = code(src('region-overlay.js'))
  assert.ok(!overlay.match(/innerText|document\.body|querySelector|forms|cookie|localStorage|fetch\(|XMLHttpRequest|getSelection/), 'it reads nothing')
  const capture = overlay.slice(overlay.indexOf('captureButton.addEventListener'))
  assert.ok(capture.indexOf('close()') !== -1 && capture.indexOf('close()') < capture.indexOf("type: 'nova-region'"), 'taken off the page first')
  assert.match(capture, /requestAnimationFrame\(\(\) => requestAnimationFrame/, 'and the page drawn without it')
  assert.match(overlay, /event\.key !== 'Escape'/)
})

test('a selected area is cropped by the picture\'s own scale: display density, zoom and scroll play no part', () => {
  const rect = { x: 100, y: 50, w: 200, h: 100 }, viewport = { w: 1000, h: 500 }
  assert.deepEqual(cropArea(rect, viewport, { width: 1000, height: 500 }), { sx: 100, sy: 50, sw: 200, sh: 100 })
  assert.deepEqual(cropArea(rect, viewport, { width: 2000, height: 1000 }), { sx: 200, sy: 100, sw: 400, sh: 200 }, 'retina')
  assert.deepEqual(cropArea(rect, viewport, { width: 1500, height: 750 }), { sx: 150, sy: 75, sw: 300, sh: 150 }, 'a zoom of 150%')
  assert.deepEqual(cropArea({ x: 900, y: 450, w: 500, h: 500 }, viewport, { width: 1000, height: 500 }), { sx: 900, sy: 450, sw: 100, sh: 50 }, 'held to the picture')
  assert.equal(cropArea({ x: 2000, y: 0, w: 10, h: 10 }, viewport, { width: 1000, height: 500 }), null)
  assert.equal(cropArea({ x: NaN, y: 0, w: 10, h: 10 }, viewport, { width: 1000, height: 500 }), null)
})

test('a captured area is handed only to its own tab, and not for long', () => {
  const stored = { src: 'data:image/jpeg;base64,AAAA', tabId: 7, at: 1000 }
  assert.equal(freshShot(stored, 7, 2000), stored)
  assert.equal(freshShot(stored, 8, 2000), null, 'another tab')
  assert.equal(freshShot(stored, 7, 1000 + REGION_SHOT_KEEP_MS + 1), null, 'too old')
  assert.equal(freshShot({ ...stored, src: 'https://x/y.png' }, 7, 2000), null, 'not a picture')
  assert.equal(freshShot(null, 7, 2000), null)
})

test('a capture carries the page and the passage, and nothing to file it under: organising happens in Kivo', () => {
  const capture = buildCapture({ key: 'k-123456789', page, title: ' A page ', text: 'A passage.' })
  assert.deepEqual(capture, { key: 'k-123456789', url: 'https://example.com/a', title: 'A page', text: 'A passage.' })
  assert.equal(buildCapture({ key: 'k', page, fresh: true }).newDraft, true, 'New draft is asked for, never assumed')
  assert.equal(buildCapture({ key: 'k', page }).text, '', 'a page with nothing selected is the page itself')
  const popup = code(src('popup.js'))
  assert.ok(!popup.match(/subjectId|el\('select'|topicName: /), 'no subject or topic is asked for in the popup')
  assert.match(popup, /client\.capture\(buildCapture\(\{ key: ids\.capture, page, title: title\.value, text: probe\.selection, fresh \}\)\)/)
  assert.match(popup, /ids\.capture = newActionId\(\)/, 'a new id only after it succeeded, so a retry repeats it')
})

test('the code uses its browser APIs in one file: the active tab, opening a tab, extension storage, the side panel, one read of that tab, and its screenshot', () => {
  const used = new Set()
  for (const { text } of sources) for (const m of code(text).matchAll(/chrome\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) used.add(`${m[1]}.${m[2]}`)
  assert.deepEqual([...used].sort(), ['action.openPopup', 'action.setBadgeBackgroundColor', 'action.setBadgeText', 'runtime.id', 'runtime.onMessage', 'runtime.sendMessage', 'scripting.executeScript', 'sidePanel.open', 'sidePanel.setOptions', 'storage.local', 'storage.onChanged', 'storage.session', 'tabs.captureVisibleTab', 'tabs.create', 'tabs.query'])
  // lib/browser.js is the adapter; the worker and the overlay run where it can't.
  for (const { name, text } of sources) if (!['lib/browser.js', 'background.js', 'region-overlay.js'].includes(name)) assert.ok(!code(text).match(/\bchrome\b/), `${name} goes through lib/browser.js`)
  const all = sources.map(s => code(s.text)).join('\n')
  assert.match(all, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/)
  assert.equal((all.match(/chrome\.tabs\.query/g) ?? []).length, 1, 'the active tab is the only tab ever asked about')
})

test('inside a page it reads the selection, the canonical link and the page\'s metadata tags, once, and nothing else', () => {
  const adapter = code(src('lib/browser.js'))
  assert.equal((adapter.match(/chrome\.scripting\.executeScript/g) ?? []).length, 2, 'two ways into a page: the probe, and the area selector when asked')
  assert.match(adapter, /executeScript\(\{ target: \{ tabId \}, files: \['region-overlay\.js'\] \}\)/, 'that one tab, that one file')
  assert.match(adapter, /chrome\.scripting\.executeScript\(\{ target: \{ tabId \}, func: probePage \}\)/, 'that one tab, that one function, no files and no all-frames')
  const probe = adapter.match(/export function probePage\(\) \{[\s\S]*?\n\}/)[0]
  assert.match(probe, /window\.getSelection/)
  assert.match(probe, /link\[rel~="canonical"\]\[href\]/)
  assert.ok(!probe.match(/innerText|innerHTML|outerHTML|\.body|forms|\.value|cookie|localStorage|sessionStorage|fetch|XMLHttpRequest|addEventListener|MutationObserver/), 'no page text, forms, cookies, storage, requests or listeners')
  // 1.3.0: what the page says about itself, from its metadata only (12 Nov).
  // Every selector it reads is a <meta>, a link, an itemprop tag or a JSON-LD block.
  const selectors = [...probe.matchAll(/'([a-z][^']*\[[^']*\])'/g)].map(m => m[1])
  assert.ok(selectors.length > 5)
  for (const sel of selectors) assert.match(sel, /^(meta\[|link\[|span\[itemprop="author"\] link\[|script\[type="application\/ld\+json"\])/, `${sel} is a metadata tag`)
  assert.equal((probe.match(/textContent/g) ?? []).length, 1, 'text is read only from a JSON-LD block')
  assert.match(probe, /querySelectorAll\('script\[type="application\/ld\+json"\]'\)/, 'the only list read is the JSON-LD blocks')
  assert.equal((probe.match(/querySelectorAll/g) ?? []).length, 1)
})

test('what the page probe returns is read as data, and a long selection is not cut silently', () => {
  assert.deepEqual(readProbe({ selection: '  Spaced repetition\nworks. ', canonical: 'https://user:pw@example.com/a#top' }, 2000),
    { available: true, selection: 'Spaced repetition\nworks.', tooLong: false, canonicalUrl: 'https://example.com/a', meta: null })
  assert.deepEqual(readProbe({ selection: 'x'.repeat(2001), canonical: null }, 2000), { available: true, selection: '', tooLong: true, canonicalUrl: null, meta: null })
  for (const canonical of ['javascript:alert(1)', 'chrome://settings', 'not an address', 42, `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(readProbe({ selection: '', canonical }, 2000).canonicalUrl, null)
  }
  for (const raw of [null, undefined, 'text', 42, [], { selection: 42 }]) assert.deepEqual(readProbe(raw, 2000), { available: true, selection: '', tooLong: false, canonicalUrl: null, meta: null })
  assert.deepEqual(NO_PROBE, { available: false, selection: '', tooLong: false, canonicalUrl: null, meta: null })
  // The page's metadata: kept to its fields and sizes; empty fields left out.
  const meta = readProbe({ selection: '', canonical: null, meta: { description: '  A  guide ', imageUrl: 'https://x.test/i.png', author: '', types: ['Article', 7, 'x'.repeat(80)], citation: true, cookie: 'no' } }, 2000).meta
  assert.deepEqual(meta, { description: 'A guide', imageUrl: 'https://x.test/i.png', types: ['Article'], citation: true })
  assert.equal(typeof probePage, 'function')
})

test('the selection is sent only by Capture or with a question, and never with a page save or a study request', () => {
  for (const eventType of ['resource_saved', 'study_requested']) {
    assert.ok(!('excerpt' in buildEvent({ eventType, clientEventId: 'x', page, excerpt: 'A passage.' })), `${eventType} carries no passage`)
  }
  const popup = code(src('popup.js'))
  assert.ok(!popup.match(/sendEvent\([^\n]*(probe\.selection|excerpt)/), 'a save or a study request never carries it')
  assert.equal((popup.match(/client\.capture\(/g) ?? []).length, 1, 'Capture sends it')
  // Handed to the side panel only when the learner presses Ask Nova, and only in this browser's memory.
  const handoff = popup.slice(popup.indexOf("ask.addEventListener('click'"), popup.indexOf("show('ready'"))
  assert.match(handoff, /selection: probe\.selection \|\| ''/)
  assert.doesNotMatch(handoff, /client\.|fetch\(/, 'opening the panel sends nothing')
})

test('it keeps nothing in page-readable storage, writes no markup and runs nothing on a timer', () => {
  const all = sources.map(s => code(s.text)).join('\n')
  assert.ok(!sources.filter(s => s.name !== 'background.js').map(s => code(s.text)).join('\n').match(/chrome\.runtime\.onMessage/), 'only the worker listens')
  assert.ok(!all.match(/chrome\.history|chrome\.cookies|chrome\.webRequest|chrome\.webNavigation|chrome\.tabs\.(onUpdated|onActivated|sendMessage|get\b)/), 'no way into a page, its history or its traffic')
  assert.ok(!all.match(/localStorage|sessionStorage|document\.cookie|indexedDB|chrome\.storage\.sync/), 'no page-readable or synced storage')
  assert.ok(!all.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/), 'page titles are set as text, never as markup')
  assert.ok(!all.match(/setInterval|chrome\.alarms|chrome\.idle/), 'nothing runs on a timer')
})

test('the only address it talks to is Nova, fixed at build time', () => {
  const all = sources.map(s => code(s.text)).join('\n')
  const urls = [...all.matchAll(/https?:\/\/[^\s'"`]+/g)].map(m => m[0])
  assert.deepEqual(urls, [], 'no address is written into the code')
  assert.equal((all.match(/\bfetch\(/g) ?? []).length, 2, 'one fetch in each page, handed to the one client (lib/api.js)')
  assert.match(code(src('lib/api.js')), /doFetch\(`\$\{baseUrl\}\$\{path\}`/)
  assert.match(code(src('lib/api.js')), /credentials: 'omit'/)
  assert.ok(!all.match(/openai|anthropic|gemini|\/api\/nova\/message/i), 'no LLM call and no chat route')
  const paths = [...code(src('lib/api.js')).matchAll(/call\('([^']+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(paths, ['/api/nova/extension/ask', '/api/nova/extension/captures', '/api/nova/extension/captures', '/api/nova/extension/connect', '/api/nova/extension/context', '/api/nova/extension/disconnect', '/api/nova/learning-events'])
})

test('the popup page loads only its own files', () => {
  const html = src('popup.html')
  assert.deepEqual([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).sort(), ['popup.css', 'popup.js'])
  assert.ok(!html.match(/<script(?![^>]*src=)[^>]*>\s*\S/), 'no inline script')
  assert.ok(!html.match(/\son[a-z]+="/), "no inline handlers")
})

test('the side panel loads only its own files and the packaged KaTeX', () => {
  const html = src('sidepanel.html')
  assert.deepEqual([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).sort(), ['popup.css', 'sidepanel.css', 'sidepanel.js', 'vendor/katex/katex.min.css', 'vendor/katex/katex.min.js'])
  assert.ok(!html.match(/<script(?![^>]*src=)[^>]*>\s*\S/), 'no inline script')
  assert.ok(!html.match(/\son[a-z]+="/), 'no inline handlers')
})

test('every permission is explained in the popup', () => {
  const popup = src('popup.js')
  assert.match(popup, /"activeTab" lets Nova read this tab\\'s address and title when you click its icon, and take a screenshot of it when you press Screenshot/)
  assert.match(popup, /A screenshot of what that tab is showing, only when you press Screenshot or capture an area you selected\. You see it here first\. It goes to Nova only with a question you ask, and is not kept\./)
  assert.match(popup, /"scripting" lets it read your selected text and the page\\'s own address on that tab, at that moment/)
  assert.match(popup, /"storage" keeps this browser connected/)
  assert.match(popup, /It is sent only if you press Capture, or with a question you ask/)
  assert.match(popup, /"sidePanel" lets Ask Nova open beside the page/)
  assert.match(popup, /Your conversation with Nova about a page stays in this browser\\'s memory until you start a new one or close the browser/)
  assert.match(popup, /Nothing else inside the page: no other text, no forms, no passwords/)
  assert.match(popup, /Not your other tabs, and not your history/)
})

test('the build refuses an insecure Nova address and writes exactly one', () => {
  const out = mkdtempSync(join(tmpdir(), 'nova-ext-'))
  const run = url => execFileSync('node', [join(root, 'scripts', 'build.mjs')], { env: { ...process.env, NOVA_URL: url, NOVA_EXTENSION_OUT: out }, stdio: 'pipe' }).toString()
  assert.throws(() => run('http://nova.example.com'))
  assert.throws(() => run('not a url'))
  run('https://nova.example.com/some/path?x=1')
  assert.equal(readFileSync(join(out, 'config.js'), 'utf8').match(/NOVA_URL = "(.*)"/)[1], 'https://nova.example.com')
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'sidePanel', 'storage'])
  assert.ok(readFileSync(join(out, 'vendor', 'katex', 'katex.min.js')).length > 100_000, 'KaTeX is packaged, not fetched')
  assert.equal(manifest.host_permissions, undefined)
  assert.equal(readFileSync(join(out, 'icons', '128.png')).subarray(1, 4).toString(), 'PNG')
})

test('a build for real use refuses a missing, local or insecure Nova address', () => {
  const out = mkdtempSync(join(tmpdir(), 'nova-ext-'))
  const clean = { ...process.env }
  delete clean.NOVA_URL
  const run = env => execFileSync('node', [join(root, 'scripts', 'build.mjs')], { env: { ...clean, NOVA_EXTENSION_OUT: out, NOVA_RELEASE: '1', ...env }, stdio: 'pipe' }).toString()
  // The address a failure check uses, the development default, and plain http.
  for (const env of [{}, { NOVA_URL: 'http://127.0.0.1:9' }, { NOVA_URL: 'https://127.0.0.1:9' }, { NOVA_URL: 'http://localhost:3000' }, { NOVA_URL: 'http://kivo.example' }, { NOVA_URL: 'https://user:pw@kivo.example' }, { NOVA_URL: 'https://nova.local' }]) {
    assert.throws(() => run(env), /Bad NOVA_URL/, JSON.stringify(env))
  }
  run({ NOVA_URL: 'https://kivo.example' })
  assert.equal(readFileSync(join(out, 'config.js'), 'utf8').match(/NOVA_URL = "(.*)"/)[1], 'https://kivo.example')
  // Without the flag, development still builds against this machine.
  execFileSync('node', [join(root, 'scripts', 'build.mjs')], { env: { ...clean, NOVA_EXTENSION_OUT: out }, stdio: 'pipe' })
  assert.equal(readFileSync(join(out, 'config.js'), 'utf8').match(/NOVA_URL = "(.*)"/)[1], 'http://localhost:3000')
  assert.match(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['build:safari:release'], /^NOVA_RELEASE=1 node scripts\/build\.mjs && xcodebuild /)
})

test('a question about the page carries the question, the address, the title, the selection and the conversation so far, and never the page', () => {
  assert.deepEqual(buildQuestion({ question: '  What is the spacing effect? ', page, title: ' A page ', excerpt: 'A passage.' }),
    { question: 'What is the spacing effect?', url: 'https://example.com/a', title: 'A page', excerpt: 'A passage.', history: [], detail: 'brief' })
  assert.equal(buildQuestion({ question: 'Why?', page, excerpt: '' }).excerpt, null)
  assert.equal(buildQuestion({ question: 'Why?', page, detail: 'detailed' }).detail, 'detailed')
  assert.equal(buildQuestion({ question: 'Why?', page, detail: 'everything' }).detail, 'brief')
  const panel = code(src('sidepanel.js'))
  assert.equal((panel.match(/client\.ask\(/g) ?? []).length, 1, 'asked from one place')
  assert.match(panel, /client\.ask\(buildQuestion\(\{ question: asked, page, excerpt: useSelection \? selection : '', screenshot, history: historyOf\(previous\), detail \}\)\)/)
  assert.match(src('sidepanel.js'), /Nova saw only the title/)
  assert.ok(!code(src('popup.js')).match(/client\.ask\(/), 'the popup asks nothing itself: Ask Nova opens the panel')
})

test('a follow-up carries the latest turns, question and answer only', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ question: `q${i}`, answer: `a${i}`, basis: 'title', at: i }))
  const sent = historyOf([...turns, { question: 'failed', error: 'x' }])
  assert.equal(sent.length, HISTORY_SENT)
  assert.deepEqual(sent.at(-1), { question: 'q9', answer: 'a9' })
  assert.ok(sent.every(t => Object.keys(t).join() === 'question,answer'))
})

test('a conversation is kept per page in session memory only, the latest few', async () => {
  const data = {}
  const area = { get: async k => (k === null ? { ...data } : { [k]: data[k] }), set: async o => Object.assign(data, o), remove: async k => { for (const key of [].concat(k)) delete data[key] } }
  const threads = createThreads(area)
  await threads.save('https://example.com/a#part', { title: 'A', domain: 'example.com' }, [{ question: 'q', answer: 'a' }])
  assert.deepEqual((await threads.load('https://example.com/a')).turns, [{ question: 'q', answer: 'a' }], 'the fragment is not part of the page')
  for (let i = 0; i < THREADS_KEPT + 5; i++) await threads.save(`https://example.com/${i}`, { title: 't', domain: 'example.com' }, [{ question: 'q', answer: 'a' }])
  assert.equal(Object.keys(data).length, THREADS_KEPT)
  assert.equal(threadKey('not a url'), null)
  const panel = code(src('sidepanel.js'))
  assert.match(panel, /createThreads\(browser\.session\(\)\)/, 'chrome.storage.session: in memory, gone when the browser quits')
  assert.ok(!code(src('lib/thread.js')).match(/storage\.local|localStorage/))
})

test('answers are read as Markdown with maths, and nothing in them becomes markup or a script', () => {
  const blocks = parse('## Steps\n\n1. **First** with $x^2$\n2. Second\n\n$$\\frac{a}{b}$$\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n```js\nconst x = 1\n```')
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'list', 'math', 'table', 'code'])
  assert.equal(blocks[2].tex, '\\frac{a}{b}')
  assert.deepEqual(inline('costs $5 and $10'), [{ type: 'text', text: 'costs $5 and $10' }], 'a price is not maths')
  assert.equal(inline('[x](javascript:alert(1))')[0].type, 'text', 'only web links')
  assert.equal(inline('<img src=x onerror=alert(1)>')[0].type, 'text', 'HTML stays text')
  const renderer = code(src('lib/markdown.js'))
  assert.ok(!renderer.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/))
  assert.match(renderer, /trust: false/, 'KaTeX may not make links or load anything')
})

test('a screenshot is taken only by its button, shown before it is sent, and sent only with a question', () => {
  const adapter = code(src('lib/browser.js'))
  assert.equal((adapter.match(/captureVisibleTab/g) ?? []).length, 1, 'one way to take one')
  assert.match(adapter, /chrome\.tabs\.captureVisibleTab\(typeof windowId === 'number' \? windowId : undefined, \{ format: 'jpeg', quality: 90 \}\)/)
  const panel = code(src('sidepanel.js'))
  assert.equal((panel.match(/browser\.captureTab\(/g) ?? []).length, 1)
  const handler = panel.slice(panel.indexOf("shotButton.addEventListener('click'"), panel.indexOf("regionButton.addEventListener('click'"))
  assert.match(handler, /browser\.captureTab\(page\.windowId\)/, 'taken in the Screenshot button handler and nowhere else')
  assert.doesNotMatch(handler, /client\.|fetch\(|sendEvent/, 'taking one sends nothing')
  assert.match(handler, /showAttached\(\)/, 'shown to the learner first')
  assert.ok(!panel.match(/screenshot[^\n]*(store\.|threads\.|chrome\.storage)/i), 'kept nowhere')
  assert.ok(!panel.match(/capture\([^\n]*screenshot/), 'never with a capture')
})

test('a question carries a screenshot only when one was taken, as a JPEG, and waits longer for it', async () => {
  assert.deepEqual(buildQuestion({ question: 'What is this arrow?', page, excerpt: '', screenshot: '/9j/AAAA' }).screenshot, { mimeType: 'image/jpeg', data: '/9j/AAAA' })
  for (const screenshot of [undefined, null, '']) assert.ok(!('screenshot' in buildQuestion({ question: 'Why?', page, screenshot })), 'no field at all without one')
  const timeouts = []
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms) => { timeouts.push(ms); return realSetTimeout(() => {}, 0) }
  try {
    const client = createClient({ baseUrl: 'https://kivo.example', getToken: async () => 'tok', fetch: async () => new Response(JSON.stringify({ ok: true, answer: 'A.', basis: 'title' }), { status: 200 }) })
    await client.ask(buildQuestion({ question: 'Why?', page }))
    await client.ask(buildQuestion({ question: 'Why?', page, screenshot: '/9j/AAAA' }))
  } finally { globalThis.setTimeout = realSetTimeout }
  assert.ok(timeouts[1] > timeouts[0], 'a question with a picture is given longer')
})

// ── Reading the current page ──────────────────────────────────────────────────

test('an ordinary page is described by its address, title and site', () => {
  assert.deepEqual(describePage({ url: 'https://www.example.com/graphs/bfs?x=1', title: '  Breadth-first\n search  ' }), {
    supported: true, url: 'https://www.example.com/graphs/bfs?x=1', domain: 'example.com', kind: 'page', title: 'Breadth-first search',
  })
})

test('a fragment and a login are left out of the address', () => {
  assert.equal(describePage({ url: 'https://user:secret@example.com/a#part', title: 'A' }).url, 'https://example.com/a')
})

test('a page with no title is called by its site, and a very long title is cut', () => {
  assert.equal(describePage({ url: 'https://docs.example.org/x', title: '' }).title, 'docs.example.org')
  assert.equal(describePage({ url: 'https://docs.example.org/x' }).title, 'docs.example.org')
  assert.equal(describePage({ url: 'https://example.com/', title: 'x'.repeat(900) }).title.length, 300)
})

test('browser pages, files and other extensions are not offered', () => {
  for (const url of ['chrome://settings', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///Users/me/secret.pdf', 'view-source:https://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'devtools://devtools/x', 'edge://flags']) {
    assert.deepEqual(describePage({ url, title: 'x' }), { supported: false, reason: 'not_a_web_page' }, url)
  }
  for (const tab of [null, undefined, {}, { url: '' }, { title: 'no url' }]) assert.deepEqual(describePage(tab), { supported: false, reason: 'no_page' })
})

test('every site gets the same treatment: one generic adapter, no special cases', () => {
  assert.equal(ADAPTERS.length, 1)
  const kinds = ['https://www.youtube.com/watch?v=abc', 'https://leetcode.com/problems/two-sum/', 'https://github.com/a/b', 'https://example.edu/course'].map(url => describePage({ url, title: 'T' }).kind)
  assert.deepEqual(kinds, ['page', 'page', 'page', 'page'])
  assert.ok(!code(src('lib/page.js')).match(/youtube|leetcode|github|coursera/i))
})

// ── The event ─────────────────────────────────────────────────────────────────

const page = { supported: true, url: 'https://example.com/a', title: 'A page', domain: 'example.com', kind: 'page' }

test('an event carries the action and the page, and nothing about who the learner is', () => {
  const event = buildEvent({ eventType: 'resource_saved', clientEventId: 'id-1234567890123456', page, title: '  My title ', subjectId: 's1', topicName: ' Graphs ', now: new Date('2026-10-06T12:00:00Z') })
  assert.deepEqual(event, {
    eventType: 'resource_saved', clientEventId: 'id-1234567890123456', url: 'https://example.com/a', title: 'My title',
    capturedAt: '2026-10-06T12:00:00.000Z', subjectId: 's1', topicName: 'Graphs', canonicalUrl: null,
  })
  assert.equal(buildEvent({ eventType: 'resource_saved', clientEventId: 'x', page: { ...page, canonicalUrl: 'https://example.com/canonical' } }).canonicalUrl, 'https://example.com/canonical')
  assert.ok(!Object.keys(event).some(k => /profile|learner|user|companion|token|source|domain|body|html|metadata/i.test(k)))
})

test('a topic is sent only with a subject', () => {
  assert.equal(buildEvent({ eventType: 'resource_saved', clientEventId: 'x', page, subjectId: '', topicName: 'Graphs' }).topicName, null)
  assert.equal(buildEvent({ eventType: 'resource_saved', clientEventId: 'x', page, subjectId: '', topicName: 'Graphs' }).subjectId, null)
  assert.equal(buildEvent({ eventType: 'study_requested', clientEventId: 'x', page, subjectId: 's1', topicName: '   ' }).topicName, null)
})

test('each action gets its own id', () => {
  const ids = new Set(Array.from({ length: 200 }, newActionId))
  assert.equal(ids.size, 200)
  assert.match([...ids][0], /^[0-9a-f-]{36}$/)
})

// ── Talking to Nova ───────────────────────────────────────────────────────────

function client(respond, token = 'nvx_test') {
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return respond(url, init) }
  return { calls, api: createClient({ baseUrl: 'https://nova.test', fetch: fake, getToken: async () => token }) }
}
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('the credential goes in the Authorization header and cookies are never sent', async () => {
  const { calls, api } = client(() => json(200, { status: 'ready' }))
  await api.context()
  assert.equal(calls[0].url, 'https://nova.test/api/nova/extension/context')
  assert.equal(calls[0].init.headers.authorization, 'Bearer nvx_test')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer')
  assert.ok(!calls[0].url.includes('nvx_test'), 'never in the address')
})

test('redeeming a code sends no credential', async () => {
  const { calls, api } = client(() => json(200, { ok: true, token: 'nvx_new' }), null)
  const res = await api.connect('ABCDE-FGHJK', 'Chrome on macOS')
  assert.ok(res.ok)
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: 'ABCDE-FGHJK', label: 'Chrome on macOS' })
})

// The popup's own function, run against a stand-in for the browser's navigator.
const labelIn = navigator => new Function('navigator', `${src('popup.js').match(/function browserLabel\(\) \{[\s\S]*?\n\}/)[0]}\nreturn browserLabel()`)(navigator)

test('a connection is labelled with the browser it was made in', () => {
  const chromeAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  const safariAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
  const hints = (brand, platform) => ({ platform, brands: [{ brand: 'Not?A_Brand' }, { brand: 'Chromium' }, { brand }] })

  // Chrome and its relatives say who they are, and are believed as before.
  assert.equal(labelIn({ userAgentData: hints('Google Chrome', 'macOS'), userAgent: chromeAgent, platform: 'MacIntel' }), 'Google Chrome on macOS')
  assert.equal(labelIn({ userAgentData: hints('Microsoft Edge', 'Windows'), userAgent: chromeAgent, platform: 'Win32' }), 'Microsoft Edge on Windows')
  assert.equal(labelIn({ userAgentData: { platform: 'macOS', brands: [{ brand: 'Chromium' }] }, userAgent: chromeAgent, platform: 'MacIntel' }), 'Chrome on macOS')

  // Safari does not, and was being called Chrome.
  assert.equal(labelIn({ userAgent: safariAgent, platform: 'MacIntel' }), 'Safari on macOS')
  assert.equal(labelIn({ userAgent: safariAgent.replace('Macintosh; Intel Mac OS X 10_15_7', 'iPhone; CPU iPhone OS 26_0 like Mac OS X'), platform: 'iPhone' }), 'Safari on iPhone')

  // Anything else that says nothing keeps the old answer.
  assert.equal(labelIn({ userAgent: chromeAgent, platform: 'MacIntel' }), 'Chrome on MacIntel')
  assert.equal(labelIn({}), 'Chrome')
  for (const navigator of [{ userAgent: safariAgent, platform: 'MacIntel' }, { userAgentData: hints('Google Chrome', 'macOS') }, {}]) assert.ok(labelIn(navigator).length <= 60, 'fits the label Nova keeps')
})

test('with no credential, nothing is sent at all', async () => {
  const { calls, api } = client(() => json(200, {}), null)
  assert.deepEqual(await api.sendEvent({ any: 'thing' }), { ok: false, kind: 'unauthenticated', message: WORDS.unauthenticated })
  assert.equal(calls.length, 0)
})

test('failures come back in words a person can read, never as a status code or an address', async () => {
  const cases = [
    [() => { throw new TypeError('Failed to fetch') }, 'offline'],
    [() => json(401, { error: 'Unauthenticated' }), 'unauthenticated'],
    [() => json(429, { success: false, error: 'rate_limited', message: "That's a lot at once. Give it a minute." }), 'rate_limited'],
    [() => json(500, null), 'failed'],
    [() => json(502, { nonsense: true }), 'failed'],
    [() => json(400, { success: false, error: 'invalid_url', message: 'Nova can only keep ordinary web pages.' }), 'invalid_url'],
    [() => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } }), 'failed'],
  ]
  for (const [respond, kind] of cases) {
    const { api } = client(respond)
    const res = await api.sendEvent({ eventType: 'resource_saved' })
    assert.equal(res.ok, false)
    assert.equal(res.kind, kind)
    assert.ok(res.message.length > 10)
    assert.ok(!res.message.match(/\b(4|5)\d\d\b|POST|GET|\/api\/|fetch|JSON|token <|TypeError|https?:/), `human words: ${res.message}`)
  }
})

test('a retry sends the same action id, so Nova can store it once', async () => {
  let n = 0
  const { calls, api } = client(() => (++n === 1 ? (() => { throw new TypeError('network') })() : json(201, { success: true })))
  const event = buildEvent({ eventType: 'resource_saved', clientEventId: newActionId(), page })
  assert.equal((await api.sendEvent(event)).ok, false)
  assert.equal((await api.sendEvent(event)).ok, true)
  assert.equal(JSON.parse(calls[0].init.body).clientEventId, JSON.parse(calls[1].init.body).clientEventId)
})

// ── What it keeps ─────────────────────────────────────────────────────────────

function area() {
  const data = {}
  return { data, get: async key => ({ [key]: data[key] }), set: async items => Object.assign(data, items), remove: async key => { delete data[key] } }
}

test('the extension stores its credential and nothing else', async () => {
  const storage = area(), store = createStore(storage)
  assert.equal(await store.token(), null)
  await store.save('nvx_abc')
  assert.equal(await store.token(), 'nvx_abc')
  assert.deepEqual(Object.keys(storage.data), ['nova.connection'])
  assert.deepEqual(Object.keys(storage.data['nova.connection']).sort(), ['connectedAt', 'token'])
})

test('disconnecting forgets the credential completely', async () => {
  const storage = area(), store = createStore(storage)
  await store.save('nvx_abc')
  await store.clear()
  assert.equal(await store.token(), null)
  assert.deepEqual(storage.data, {})
})

test('Disconnect says Nova closed the connection only when Nova did', async () => {
  const answer = (status, body = {}) => createClient({ baseUrl: 'https://kivo.example', getToken: async () => 'nvx_abc', fetch: async () => new Response(JSON.stringify(body), { status }) }).disconnect()
  const down   = createClient({ baseUrl: 'https://kivo.example', getToken: async () => 'nvx_abc', fetch: async () => { throw new TypeError('Load failed') } }).disconnect()

  // Nova said so, or no longer knows the credential: closed either way.
  assert.deepEqual(disconnectOutcome(await answer(200, { ok: true })), { confirmed: true, message: WORDS.disconnected })
  assert.deepEqual(disconnectOutcome(await answer(401, { error: 'Unauthenticated' })), { confirmed: true, message: WORDS.disconnected })

  // Nova was not reached, or failed: nothing was closed there, and the words say so.
  for (const result of [await down, await answer(500, { error: 'Failed to disconnect' }), await answer(429), await answer(502)]) {
    const outcome = disconnectOutcome(result)
    assert.equal(outcome.confirmed, false)
    assert.equal(outcome.message, WORDS.disconnect_unconfirmed)
    assert.match(outcome.message, /Browser Extension page/)
    assert.doesNotMatch(outcome.message, /can no longer save/)
  }
})

test('the browser forgets its credential on Disconnect whatever Nova answered', () => {
  const body = code(src('popup.js')).match(/async function disconnect\(\) \{[\s\S]*?\n\}/)[0]
  assert.match(body, /disconnectOutcome\(await client\.disconnect\(\)\)/)
  assert.match(body, /await store\.clear\(\)/, 'cleared without a condition')
  assert.doesNotMatch(body, /\bif\b|\?\s*await|return/, 'no path leaves the credential in place')
  assert.match(body, /outcome\.confirmed \? null : /, 'an unconfirmed disconnect points at Saved')
})

test('the Safari project matches the extension: same version, and an app that opens on the macOS the extension supports', () => {
  const project = readFileSync(join(root, 'safari/Nova/Nova.xcodeproj/project.pbxproj'), 'utf8')
  const all = name => [...project.matchAll(new RegExp(`${name} = ([^;]+);`, 'g'))].map(m => m[1])
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  assert.deepEqual([...new Set(all('MARKETING_VERSION'))], [version])
  assert.deepEqual([...new Set(all('MACOSX_DEPLOYMENT_TARGET'))], ['12.0'])
  assert.ok(all('MARKETING_VERSION').length === 4 && all('MACOSX_DEPLOYMENT_TARGET').length === 4)
})

test('a damaged stored value is treated as not connected', async () => {
  for (const bad of [{ token: 42 }, { token: '' }, 'string', null, []]) {
    const storage = area(); storage.data['nova.connection'] = bad
    assert.equal(await createStore(storage).token(), null)
  }
})

// ── The release ZIP ───────────────────────────────────────────────────────────

const packageWith = (env, release = mkdtempSync(join(tmpdir(), 'nova-ext-release-'))) => {
  const clean = { ...process.env }
  delete clean.NOVA_URL
  const out = execFileSync(process.execPath, [join(root, 'scripts', 'package.mjs')], { env: { ...clean, NOVA_EXTENSION_RELEASE: release, ...env }, stdio: 'pipe' }).toString()
  return { out, zip: readFileSync(join(release, readdirSync(release)[0])), name: readdirSync(release)[0] }
}

// The names in a ZIP's central directory, in order.
function zipNames(buf) {
  const names = []
  for (let at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at !== -1 && buf.readUInt32LE(at) === 0x02014b50; ) {
    const length = buf.readUInt16LE(at + 28)
    names.push(buf.subarray(at + 46, at + 46 + length).toString('utf8'))
    at += 46 + length + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return names
}

test('a release is refused without an https address that is somewhere else', () => {
  for (const env of [{}, { NOVA_URL: 'http://kivo.example' }, { NOVA_URL: 'https://localhost:3000' }, { NOVA_URL: 'https://127.0.0.1' }, { NOVA_URL: 'https://user:pw@kivo.example' }, { NOVA_URL: 'nonsense' }]) {
    assert.throws(() => packageWith(env), /Cannot package/, JSON.stringify(env))
  }
})

test('the release ZIP holds the built extension and nothing else', () => {
  const { zip, name, out } = packageWith({ NOVA_URL: 'https://kivo.example/some/path' })
  assert.equal(name, `nova-extension-${JSON.parse(src('manifest.template.json')).version}.zip`)
  const names = zipNames(zip)
  assert.deepEqual(names.filter(n => !n.startsWith('vendor/katex/fonts/')), ['background.js', 'config.js', 'icons/128.png', 'icons/16.png', 'icons/48.png', 'lib/api.js', 'lib/browser.js', 'lib/markdown.js', 'lib/page.js', 'lib/region.js', 'lib/store.js', 'lib/thread.js', 'lib/ui.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js', 'region-overlay.js', 'sidepanel.css', 'sidepanel.html', 'sidepanel.js', 'vendor/katex/LICENSE', 'vendor/katex/katex.min.css', 'vendor/katex/katex.min.js'])
  assert.ok(names.filter(n => n.startsWith('vendor/katex/fonts/')).every(n => n.endsWith('.woff2')), 'only KaTeX woff2 fonts')
  assert.match(out, /sha256 [0-9a-f]{64}/)
  assert.match(out, /for https:\/\/kivo\.example\n/)
})

test('the same sources and address give the same ZIP, byte for byte', () => {
  const first = packageWith({ NOVA_URL: 'https://kivo.example' }).zip
  const again = packageWith({ NOVA_URL: 'https://kivo.example' }).zip
  assert.ok(first.equals(again))
  assert.ok(!first.equals(packageWith({ NOVA_URL: 'https://other.example' }).zip), 'the address is part of what is shipped')
})

test('the extension and its package.json agree on the version, and the description fits the store', () => {
  const manifest = JSON.parse(src('manifest.template.json'))
  assert.equal(manifest.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  assert.ok(manifest.description.length <= 132)
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
})

// ── How the popup behaves ─────────────────────────────────────────────────────

test('Ask Nova: Enter asks and Shift+Enter is a new line; a failed question stays in the box', () => {
  const panel = code(src('sidepanel.js'))
  assert.match(panel, /if \(e\.key !== 'Enter' \|\| e\.shiftKey \|\| e\.isComposing\) return/)
  assert.match(panel, /form\.requestSubmit\(\)/, 'Enter goes through the same form submit')
  const handler = panel.slice(panel.indexOf('async function ask('), panel.indexOf("question.addEventListener('input'"))
  assert.match(handler, /if \(!asked \|\| asking\) return/, 'a second submit while asking sends nothing')
  const failed = handler.indexOf('turn.error = ')
  const cleared = handler.indexOf("question.value = ''")
  assert.ok(failed > 0 && cleared > failed, 'the box is cleared only after an answer arrived')
  assert.match(panel, /More detail/, 'a fuller answer is one press away')
  assert.match(panel, /New conversation/)
})

test('an action on its way blocks the others, so a double click saves once', () => {
  const send = code(src('popup.js')).match(/async function send\(button, words, request\) \{[\s\S]*?\n  \}/)[0]
  assert.match(send, /if \(buttons\(\)\.some\(b => b\.getAttribute\('aria-busy'\)\)\) return null/)
  assert.match(send, /for \(const b of buttons\(\)\) b\.disabled = true/)
})

test('connection status and the privacy disclosure are said in words, not colour alone', () => {
  const popup = src('popup.js')
  for (const words of ["setStatus('disconnected', 'Not connected')", "setStatus('error', 'Offline')", "setStatus('loading', 'Checking…')"]) assert.ok(popup.includes(words), words)
  assert.match(popup, /toggle\.setAttribute\('aria-expanded', String\(opening\)\)/)
  assert.match(popup, /toggle\.setAttribute\('aria-controls', 'privacy'\)/)
  // A wrong code is explained under the field, which is marked, and kept to fix.
  assert.match(popup, /code\.setAttribute\('aria-invalid', 'true'\)/)
  assert.match(popup, /code\.setAttribute\('aria-describedby', 'code-error'\)/)
})

test('the popup stays within its width, the panel fills its own, and nothing moves for reduced motion', () => {
  const css = src('popup.css')
  assert.match(css, /body \{ width: 420px;/)
  const panel = src('sidepanel.css')
  assert.match(panel, /body\.panel \{ width: auto;/)
  assert.match(panel, /\.md-table \{ overflow-x: auto;/, 'a wide table scrolls, inside the answer')
  assert.match(panel, /\.md pre \{[^}]*overflow-x: auto;/, 'so does code')
  assert.ok(!panel.match(/@import|url\(/), 'no outside fonts or images')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.ok(!css.match(/@import|url\(/), 'no outside fonts or images')
})

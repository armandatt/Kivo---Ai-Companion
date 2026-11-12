import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME_STORE_URL, LISTING, chromeStoreUrl } from './extension-store'
import { browserSupport } from './browser-support'

const here = dirname(fileURLToPath(import.meta.url))
const ID = 'abcdefghijklmnopabcdefghijklmnop'

test('only a Chrome Web Store listing address is accepted', () => {
  assert.equal(chromeStoreUrl(`https://chromewebstore.google.com/detail/nova/${ID}`), `https://chromewebstore.google.com/detail/nova/${ID}`)
  assert.equal(chromeStoreUrl(`https://chromewebstore.google.com/detail/${ID}`), `https://chromewebstore.google.com/detail/${ID}`)
  // Tidied: no query, fragment or trailing slash.
  assert.equal(chromeStoreUrl(` https://chromewebstore.google.com/detail/nova/${ID}/?hl=en&utm_source=x#reviews `), `https://chromewebstore.google.com/detail/nova/${ID}`)
  for (const bad of [
    undefined, null, '', '   ',
    'TODO', 'https://example.com',
    `http://chromewebstore.google.com/detail/nova/${ID}`,                 // not https
    `https://chromewebstore.google.com.evil.com/detail/nova/${ID}`,       // another host
    `https://chrome.google.com/webstore/detail/nova/${ID}`,               // the old store's address
    'https://chromewebstore.google.com/search/nova',                      // a search, not a listing
    'https://chromewebstore.google.com/detail/nova/not-an-id',
    `https://chromewebstore.google.com/detail/nova/${ID.slice(0, 31)}`,   // too short
    `https://chromewebstore.google.com/detail/nova/${ID.slice(0, 31)}z`,  // z is not an id letter
    `https://chromewebstore.google.com/detail/a/b/${ID}`,
    `https://user:pw@chromewebstore.google.com/detail/nova/${ID}`,
    `https://chromewebstore.google.com:8443/detail/nova/${ID}`,
  ]) assert.equal(chromeStoreUrl(bad as string), null, String(bad))
})

test('the live listing is the default, tidied', () => {
  assert.equal(chromeStoreUrl(`${LISTING}?utm_source=ext_app_menu`), LISTING)
  if (!process.env.NEXT_PUBLIC_CHROME_STORE_URL) assert.equal(CHROME_STORE_URL, LISTING)
})

test('browser support is read from the browser’s own report, and never hides the button', () => {
  assert.equal(browserSupport({ brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }], mobile: false }, ''), 'chrome')
  assert.equal(browserSupport({ brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }], mobile: false }, ''), 'chromium')
  assert.equal(browserSupport({ brands: [{ brand: 'Google Chrome' }], mobile: true }, ''), 'mobile')
  assert.equal(browserSupport(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/130.0'), 'other')
  assert.equal(browserSupport(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'), 'other')
  assert.equal(browserSupport(undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'), 'mobile')
  assert.equal(browserSupport(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', true), 'mobile') // iPad
  assert.equal(browserSupport(undefined, undefined), 'unknown')
  // The button is never conditional on the browser.
  const intro = readFileSync(join(here, '../components/nova/saved/extension-install.tsx'), 'utf8')
  assert.doesNotMatch(intro, /support\s*(===|!==)[^\n]*<StoreButton/)
})

test('the store address lives in one place', () => {
  const root = join(here, '..')
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(tsx?|mjs|js)$/.test(name) || name.endsWith('.test.ts')) continue
      if (readFileSync(p, 'utf8').includes('chromewebstore.google.com')) hits.push(p.slice(root.length + 1))
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(join(root, d))
  assert.deepEqual(hits, ['lib/extension-store.ts'])
})

test('the funnel sends where it happened, nothing about the person', () => {
  const funnel = readFileSync(join(here, 'extension-funnel.ts'), 'utf8')
  assert.match(funnel, /track\(event, \{ from \}\)/)
  assert.match(funnel, /from '@vercel\/analytics'/)
})

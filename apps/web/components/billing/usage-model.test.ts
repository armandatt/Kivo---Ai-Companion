import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytes, compareLines, renewsOn, usageRows, type Allowances } from './usage-model'

const MB = 1_000_000, GB = 1_000_000_000
const base = (over: Partial<Allowances> = {}): Allowances => ({
  mode: 'enforce',
  enforced: { nova: true, browser: true, mcp: true, storage: true },
  tier: 'free',
  nova: { used: 0, limit: 150, remaining: 150, resetsAt: '2026-12-01T00:00:00.000Z' },
  browser: { used: 0, limit: 10, remaining: 10, resetsAt: '2026-12-01T00:00:00.000Z' },
  mcp: { lifetimeUsed: 0, lifetimeLimit: 2000, readOnly: false, readOnlyUsed: 0, readOnlyLimit: 100, readOnlyResetsAt: '2026-12-01T00:00:00.000Z' },
  storage: { usedBytes: 0, limitBytes: 500 * MB, remainingBytes: 500 * MB },
  ...over,
})
const utc = { locale: 'en-GB', timeZone: 'UTC' }
const row = (a: Allowances, key: string) => usageRows(a, utc).find(r => r.key === key)!

test('four separate rows, in a fixed order', () => {
  assert.deepEqual(usageRows(base(), utc).map(r => r.key), ['nova', 'browser', 'storage', 'mcp'])
})

test('Free, nothing used: full allowances, empty bars, renewal date', () => {
  const nova = row(base(), 'nova')
  assert.equal(nova.figure, '0 of 150 credits')
  assert.equal(nova.left, '150 left')
  assert.equal(nova.pct, 0)
  assert.equal(nova.state, 'ok')
  assert.equal(nova.renews, 'Renews 1 December')
  assert.equal(row(base(), 'storage').figure, '0 MB of 500 MB')
})

test('the figures are the server\'s: remaining is taken as sent, never recomputed from another limit', () => {
  const a = base({ nova: { used: 40, limit: 150, remaining: 110, resetsAt: null } })
  assert.equal(row(a, 'nova').left, '110 left')
  assert.equal(row(a, 'nova').renews, null)
})

test('partial and nearly used: low from 80%', () => {
  assert.equal(row(base({ nova: { used: 60, limit: 150, remaining: 90, resetsAt: null } }), 'nova').state, 'ok')
  const low = row(base({ nova: { used: 121, limit: 150, remaining: 29, resetsAt: null } }), 'nova')
  assert.equal(low.state, 'low'); assert.equal(low.pct, 81)
})

test('used up: 100%, nothing left, and what happens is said', () => {
  const r = row(base({ browser: { used: 10, limit: 10, remaining: 0, resetsAt: '2026-12-01T00:00:00.000Z' } }), 'browser')
  assert.equal(r.state, 'used_up'); assert.equal(r.pct, 100); assert.equal(r.left, '0 left')
  assert.match(r.atLimit, /already started always finishes/)
  assert.match(r.what, /however many steps/)
})

test('over the limit (a reservation finishing late) still reads as used up, not over 100%', () => {
  const r = row(base({ nova: { used: 152, limit: 150, remaining: 0, resetsAt: null } }), 'nova')
  assert.equal(r.pct, 100); assert.equal(r.state, 'used_up')
})

test('renewal is the viewer\'s own day', () => {
  // Midnight UTC on 1 December is still 30 November in California.
  assert.equal(renewsOn('2026-12-01T00:00:00.000Z', { locale: 'en-GB', timeZone: 'America/Los_Angeles' }), 'Renews 30 November')
  assert.equal(renewsOn('2026-12-01T00:00:00.000Z', { locale: 'en-GB', timeZone: 'Asia/Kolkata' }), 'Renews 1 December')
  assert.equal(renewsOn('not a date'), null)
})

test('Free MCP before the lifetime allowance: lifetime figures, never a monthly reset', () => {
  const r = row(base({ mcp: { lifetimeUsed: 1200, lifetimeLimit: 2000, readOnly: false, readOnlyUsed: 0, readOnlyLimit: 100, readOnlyResetsAt: '2026-12-01T00:00:00.000Z' } }), 'mcp')
  assert.equal(r.figure, '1,200 of 2,000 calls')
  assert.equal(r.left, '800 left')
  assert.match(r.renews!, /Lifetime/)
  assert.doesNotMatch(r.renews!, /Renews/)
  assert.equal(r.extra, undefined)
})

test('Free MCP after the lifetime allowance: read-only, with this month\'s reads and their renewal', () => {
  const r = row(base({ mcp: { lifetimeUsed: 2000, lifetimeLimit: 2000, readOnly: true, readOnlyUsed: 37, readOnlyLimit: 100, readOnlyResetsAt: '2026-12-01T00:00:00.000Z' } }), 'mcp')
  assert.equal(r.state, 'read_only')
  assert.equal(r.figure, '2,000 of 2,000 calls')
  assert.equal(r.extra?.figure, '37 of 100 reads')
  assert.equal(r.extra?.renews, 'Renews 1 December')
  assert.match(r.atLimit, /Reading still works/)
  assert.match(r.atLimit, /starts again each month/)
})

test('Plus and Pro MCP: fair use, no bar, and abuse limits still named', () => {
  const r = row(base({ tier: 'pro', mcp: { lifetimeUsed: 5400, lifetimeLimit: null, readOnly: false, readOnlyUsed: null, readOnlyLimit: null, readOnlyResetsAt: null } }), 'mcp')
  assert.equal(r.state, 'fair_use'); assert.equal(r.pct, null); assert.equal(r.limit, null)
  assert.match(r.atLimit, /very heavy or automated use/)
  assert.doesNotMatch(r.figure + r.renews, /unlimited/i)
})

test('Pro storage in GB; storage never claims to reset', () => {
  const r = row(base({ tier: 'pro', storage: { usedBytes: 1.5 * GB, limitBytes: 15 * GB, remainingBytes: 13.5 * GB } }), 'storage')
  assert.equal(r.figure, '1.5 GB of 15 GB'); assert.equal(r.left, '13.5 GB left'); assert.equal(r.pct, 10)
  assert.match(r.renews!, /Doesn’t reset/)
  assert.match(r.atLimit, /Nothing is deleted/)
})

test('while limits are only measured (shadow), the page says nothing pauses', () => {
  const a = base({ mode: 'shadow', enforced: { nova: false, browser: false, mcp: false, storage: false } })
  for (const r of usageRows(a, utc)) if (r.key !== 'mcp' || a.mcp.lifetimeLimit !== null) assert.match(r.atLimit, /nothing pauses|aren't applied/, r.key)
  const one = base({ mode: 'enforce', enforced: { nova: false, browser: false, mcp: true, storage: true } })
  assert.match(row(one, 'nova').atLimit, /Not applied yet/)
  assert.doesNotMatch(row(one, 'storage').atLimit, /Not applied yet/)
})

test('bytes reads naturally at every size', () => {
  assert.equal(bytes(0), '0 MB'); assert.equal(bytes(250_000), '250 KB'); assert.equal(bytes(2_400_000), '2.4 MB')
  assert.equal(bytes(500 * MB), '500 MB'); assert.equal(bytes(2 * GB), '2 GB')
})

test('comparison with the next plan uses the table it is given', () => {
  const free = { novaCredits: 150, browserTasks: 10, mcpLifetime: 2000, mcpReadOnly: 100, storageBytes: 500 * MB }
  const pro = { novaCredits: 3500, browserTasks: 120, mcpLifetime: null, mcpReadOnly: null, storageBytes: 15 * GB }
  const lines = compareLines(free, pro)
  assert.deepEqual(lines.map(l => [l.now, l.next]), [['150', '3,500'], ['10', '120'], ['500 MB', '15 GB'], ['2,000 calls, then 100 reads a month', 'Fair use']])
})

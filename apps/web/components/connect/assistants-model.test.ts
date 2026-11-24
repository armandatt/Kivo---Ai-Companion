import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASSISTANTS, assistantOf, canWrite, newConnection, since } from './assistants-model'
import { MCP_CLIENTS } from './mcp-clients'

const c = (id: string, client: string, scopes = ['notes:read']) => ({ id, client, scopes, connectedAt: '2026-11-24T10:00:00Z', lastUsedAt: null })

test('a connection is recognised by the name its assistant registered', () => {
  assert.equal(assistantOf('Claude'), 'claude')
  assert.equal(assistantOf('claude.ai (Anthropic)'), 'claude')
  assert.equal(assistantOf('ChatGPT'), 'chatgpt')
  assert.equal(assistantOf('OpenAI Apps'), 'chatgpt')
  assert.equal(assistantOf('Cursor'), null)
})

test('the new connection is the one that was not there before, preferring the assistant being set up', () => {
  const before = [c('a', 'Claude')]
  assert.equal(newConnection(before, before, 'claude'), null)
  assert.equal(newConnection(before, [...before, c('b', 'Claude')], 'claude')?.id, 'b')
  assert.equal(newConnection(before, [...before, c('x', 'Cursor'), c('g', 'ChatGPT')], 'chatgpt')?.id, 'g')
  assert.equal(newConnection(null, [c('b', 'Claude')], 'claude'), null)
})

test('write access is any :write scope', () => {
  assert.equal(canWrite(c('a', 'Claude', ['notes:read'])), false)
  assert.equal(canWrite(c('a', 'Claude', ['notes:read', 'notes:write'])), true)
})

test('since is short', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  assert.equal(since('2026-11-24T11:59:40Z', now), 'just now')
  assert.equal(since('2026-11-24T11:15:00Z', now), '45 min ago')
  assert.equal(since('2026-11-23T10:00:00Z', now), 'yesterday')
  assert.equal(since(null, now), null)
})

test('every assistant here is one the Kivo Connect guide lists as supported', () => {
  for (const a of ASSISTANTS) assert.equal(MCP_CLIENTS.find(m => m.id === a.id)?.status, 'supported')
  for (const a of ASSISTANTS) assert.match(a.settingsUrl, /^https:\/\//)
})

// Founder review #17: links are the vendors' documented pages, never invented deep links.
test('each assistant opens its documented connectors page, with no undocumented parameters', () => {
  const byId = Object.fromEntries(ASSISTANTS.map(a => [a.id, a]))
  assert.equal(byId.claude!.settingsUrl, 'https://claude.ai/customize/connectors')
  assert.equal(byId.chatgpt!.settingsUrl, 'https://chatgpt.com/plugins')
  for (const a of ASSISTANTS) {
    const u = new URL(a.settingsUrl)
    assert.equal(u.search, '', `${a.name}: no query parameters`)
    assert.equal(u.hash, '', `${a.name}: no fragment`)
    assert.ok(a.path.some(p => /paste/i.test(p)), `${a.name}: says where the link is pasted`)
    assert.ok(new URL(a.docsUrl).protocol === 'https:')
  }
})

test('no setup text claims Kivo configures the assistant by itself', () => {
  const words = JSON.stringify([ASSISTANTS, MCP_CLIENTS])
  assert.doesNotMatch(words, /automatically (adds|configures|sets up)|one[- ]click/i)
})

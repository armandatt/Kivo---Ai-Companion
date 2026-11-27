import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MCP_CLIENTS, MCP_PERMISSIONS, MCP_TOOLS, MCP_URL } from './mcp-clients'
import { SOCIAL_LINKS, isSafeExternal, visibleSocialLinks } from '../../lib/site-links'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (p: string) => readFileSync(root + p, 'utf8')

test('the guide lists exactly the tools the MCP server has', () => {
  const server = [...read('packages/api/src/connect/tools.ts').matchAll(/name: "([a-z_]+)", title/g)].map(m => m[1]).sort()
  const listed = MCP_TOOLS.flatMap(g => g.items.map(([name]) => name)).sort()
  assert.deepEqual(listed, server)
})

test('approval and read labels match the server: destructive and structural tools need approval, reads change nothing', () => {
  const src = read('packages/api/src/connect/tools.ts')
  const kindOf = new Map([...src.matchAll(/name: "([a-z_]+)", title: "[^"]*", kind: "(\w+)"/g)].map(m => [m[1], m[2]]))
  for (const [name, , kind] of MCP_TOOLS.flatMap(g => g.items)) {
    const server = kindOf.get(name)
    if (server === 'read') assert.equal(kind, 'read', name)
    if (server === 'structural') assert.equal(kind, 'approval', name)
    if (kind === 'read') assert.equal(server, 'read', name)
  }
})

test('the guide lists exactly the permissions the server grants', () => {
  const block = read('packages/api/src/connect/oauth-rules.ts').split('export const SCOPES = {')[1]!.split('} as const')[0]!
  const server = [...block.matchAll(/"([a-z]+:[a-z]+)":/g)].map(m => m[1]).sort()
  assert.deepEqual(MCP_PERMISSIONS.map(([s]) => s).sort(), server)
})

test('the server address is the production MCP endpoint', () => {
  assert.equal(MCP_URL, 'https://www.thekivo.in/api/mcp')
})

test('only clients Kivo has connected are called supported; every client has steps', () => {
  assert.deepEqual(MCP_CLIENTS.filter(c => c.status === 'supported').map(c => c.id), ['claude', 'chatgpt'])
  for (const c of MCP_CLIENTS) assert.ok(c.steps.length >= 3, c.id)
  assert.equal(new Set(MCP_CLIENTS.map(c => c.id)).size, MCP_CLIENTS.length)
})

test('social links: nothing invented; an unset link is hidden, only plain https is shown', () => {
  for (const l of SOCIAL_LINKS) assert.ok(l.url === null || isSafeExternal(l.url), l.key)
  assert.deepEqual(visibleSocialLinks([{ key: 'x', label: 'X', url: null }, { key: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@kivo' }]).map(l => l.key), ['youtube'])
  for (const bad of ['http://x.com/kivo', 'javascript:alert(1)', 'https://user:pass@x.com/', 'not a url']) assert.equal(isSafeExternal(bad), false, bad)
})

test('the footer opens social links in a new tab safely and shows the published contact address', () => {
  const footer = read('apps/web/components/footer.tsx')
  assert.match(footer, /target="_blank" rel="noopener noreferrer"/)
  assert.match(footer, /mailto:\$\{CONTACT_EMAIL\}/)
  assert.match(read('apps/web/lib/site-links.ts'), /CONTACT_EMAIL = LEGAL_CONTACT/)
})

test('every capability on the guide names a real tool, and examples exist', async () => {
  const { MCP_CAPABILITIES, toolInfo } = await import('./mcp-clients')
  for (const c of MCP_CAPABILITIES) {
    assert.ok(c.asks.length > 0, c.id)
    for (const t of c.tools) assert.ok(toolInfo(t), `${c.id}: ${t} is not a tool`)
  }
})

// Bug batch 28 Nov, item 8: one universal MCP address, copied from the top of the AI Assistants page.
test('REGRESSION item 8: the MCP address is the production URL on Kivo, and the server\'s own elsewhere', async () => {
  const { mcpAddressFor } = await import('./mcp-clients')
  assert.equal(mcpAddressFor('https://www.thekivo.in'), 'https://www.thekivo.in/api/mcp')
  assert.equal(mcpAddressFor('https://thekivo.in'), 'https://www.thekivo.in/api/mcp')
  assert.equal(mcpAddressFor('http://localhost:3100'), 'http://localhost:3100/api/mcp')
  assert.equal(mcpAddressFor('not a url'), 'https://www.thekivo.in/api/mcp')
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(new URL('./assistants-page.tsx', import.meta.url), 'utf8')
  assert.ok(page.indexOf('<McpAddressCard') < page.indexOf('ASSISTANTS.map'), 'the address comes first on the page')
  assert.doesNotMatch(page.slice(page.indexOf('function McpAddressCard')), /Gemini|Grok|Copilot|Perplexity/, 'no assistant is named that has not been verified')
})

// Item 13 (28 Nov, owner request): the page says what connecting does, offers a path for other assistants, and keeps the safety line.
test('the AI Assistants page explains itself: what it can do, other assistants, and that nothing connects without Allow', async () => {
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(new URL('./assistants-page.tsx', import.meta.url), 'utf8')
  assert.match(page, /data-mcp-can/)
  assert.match(page, /function OtherAssistant/)
  assert.match(page, /Nothing connects until you press Allow/)
})

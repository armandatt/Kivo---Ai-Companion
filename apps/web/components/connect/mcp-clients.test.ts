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

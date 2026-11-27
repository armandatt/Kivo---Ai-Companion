// The AI assistants page, as data and pure rules (assistants-model.test.ts).
// Which assistant a connection is comes from the name the assistant
// registered with (OAuth dynamic registration); nothing else names it.

export type AssistantId = 'claude' | 'chatgpt'

export interface Assistant {
  id: AssistantId
  name: string
  mark: string               // a letter mark, not a brand logo
  maker: string              // who makes it, said beside the name
  // Where its connector settings are, as the assistant's own documentation
  // gives it (founder review #17, checked 25 Nov 2026). Neither Claude nor
  // ChatGPT documents a link that opens the add-connector form or fills in
  // the address, so this opens the nearest page and the steps say the rest.
  // Never add query parameters here that the vendor does not document.
  settingsUrl: string
  docsUrl: string            // the vendor's own instructions
  // The three moves, as short as they can be said.
  add: string                // what to press there
  paste: string              // where the address goes
  allow: string
  // The clicks on the assistant's page, in order, for when its screens differ.
  path: string[]
  planNote: string
  tryPrompts: string[]
}

export const ASSISTANTS: readonly Assistant[] = [
  {
    id: 'claude', name: 'Claude', mark: 'C', maker: 'Anthropic',
    settingsUrl: 'https://claude.ai/customize/connectors',
    docsUrl: 'https://claude.com/docs/connectors/custom/add-unlisted',
    add: 'Open Claude connectors', paste: 'MCP server URL', allow: 'After you press Connect in Claude, Kivo opens a page: press Allow.',
    path: ['Add', 'Add custom connector', 'Name: Kivo', 'Paste the link as the MCP server URL', 'Continue, then Add', 'Connect, then Allow on Kivo'],
    planNote: 'Works on every Claude plan; Free allows one custom connector. On Team and Enterprise an Owner adds it first.',
    tryPrompts: ['What have I added to Kivo recently?', 'Save this conversation as a note in Kivo', 'Add these topics to my Knowledge Map'],
  },
  {
    id: 'chatgpt', name: 'ChatGPT', mark: 'G', maker: 'OpenAI',
    settingsUrl: 'https://chatgpt.com/plugins',
    docsUrl: 'https://developers.openai.com/api/docs/guides/custom-mcp-server',
    add: 'Open ChatGPT plugins', paste: 'Server URL, with OAuth', allow: 'After you install it in ChatGPT, Kivo opens a page: press Allow.',
    path: ['+ (add)', 'Add custom MCP server', 'Name: Kivo', 'Paste the link as the Server URL', 'Authentication: OAuth', 'Create as a plugin, then Install', 'Allow on Kivo'],
    planNote: 'Custom MCP servers are a ChatGPT web feature; which plans and workspaces allow them is up to OpenAI.',
    tryPrompts: ['Search my Kivo notes for deadlocks', 'Turn this chat into a Kivo note', 'What’s on my Knowledge Map for OS?'],
  },
]

export interface Connection { id: string; client: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null }

export function assistantOf(client: string): AssistantId | null {
  const c = client.toLowerCase()
  if (/claude|anthropic/.test(c)) return 'claude'
  if (/chatgpt|openai/.test(c)) return 'chatgpt'
  return null
}

export const canWrite = (c: Pick<Connection, 'scopes'>) => c.scopes.some(s => s.endsWith(':write'))

/** A connection that was not there when the learner started setting this assistant up. */
export function newConnection(before: readonly Connection[] | null, now: readonly Connection[], who: AssistantId): Connection | null {
  if (!before) return null
  const seen = new Set(before.map(c => c.id))
  return now.find(c => !seen.has(c.id) && assistantOf(c.client) === who) ?? now.find(c => !seen.has(c.id)) ?? null
}

/** "2 h ago", "yesterday", "12 Nov": how long since, in a few characters. */
export function since(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

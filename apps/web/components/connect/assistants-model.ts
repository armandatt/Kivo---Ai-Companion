// The AI assistants page, as data and pure rules (assistants-model.test.ts).
// Which assistant a connection is comes from the name the assistant
// registered with (OAuth dynamic registration); nothing else names it.

export type AssistantId = 'claude' | 'chatgpt'

export interface Assistant {
  id: AssistantId
  name: string
  mark: string               // a letter mark, not a brand logo
  // Where its connector settings are. Opened in a new tab by the learner.
  settingsUrl: string
  // The three moves, as short as they can be said.
  add: string                // what to press there
  paste: string              // where the address goes
  allow: string
  tryPrompts: string[]
}

export const ASSISTANTS: readonly Assistant[] = [
  {
    id: 'claude', name: 'Claude', mark: 'C',
    settingsUrl: 'https://claude.ai/settings/connectors',
    add: 'Add custom connector', paste: 'connector link', allow: 'Tap Connect in Claude, then Allow on Kivo',
    tryPrompts: ['What have I added to Kivo recently?', 'Save this conversation as a note in Kivo', 'Add these topics to my Knowledge Map'],
  },
  {
    id: 'chatgpt', name: 'ChatGPT', mark: 'G',
    settingsUrl: 'https://chatgpt.com/#settings/Connectors',
    add: 'Developer mode → Create', paste: 'MCP server link, sign-in: OAuth', allow: 'Tap Connect in ChatGPT, then Allow on Kivo',
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

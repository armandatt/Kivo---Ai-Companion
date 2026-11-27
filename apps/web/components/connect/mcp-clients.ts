// What the Kivo Connect guide says, as data, so another MCP client, tool or
// permission is one entry here and the page draws it (app/(legal)/integrations/
// kivo-connect/page.tsx). Everything must match the server:
//   endpoint     apps/api/app/api/mcp (KIVO_CONNECT_ORIGIN + /api/mcp)
//   permissions  packages/api/src/connect/oauth-rules.ts SCOPES
//   tools        packages/api/src/connect/tools.ts TOOLS (mcp-clients.test.ts holds the list to it)
//   allowances   packages/api/src/billing/accounting/rules.ts (Free's MCP calls)
// A client is listed as supported only once it has been connected for real.

export const MCP_URL = 'https://www.thekivo.in/api/mcp'

// The setup-and-use demonstration on the guide (founder review #04): a real
// recording of adding Kivo in Claude or ChatGPT, signing in, allowing, a read
// and a write that reaches Kivo. None exists yet (it needs the owner's own
// Claude or ChatGPT account), so none is shown: never put another video here.
// What to record and how to add it: docs/KIVO_CONNECT_VIDEO.md.
export const CONNECT_VIDEO: import('@/components/media/demo-video').DemoVideoSource | null = null

export interface McpClient {
  id: string
  name: string
  // 'supported': Kivo has connected it end to end. 'untested': it should work
  // by the protocol, and is said to be untested.
  status: 'supported' | 'untested'
  intro?: string
  steps: string[]                        // in order; the server address is shown beside them
  note?: string
}

export const MCP_CLIENTS: McpClient[] = [
  {
    id: 'claude', name: 'Claude', status: 'supported',
    intro: 'On claude.ai and in the Claude desktop app. Works on every Claude plan; Free allows one custom connector.',
    steps: [
      'Open Claude’s connectors page (claude.ai/customize/connectors). Choose Add, then Add custom connector. (Team and Enterprise: an Owner adds it under Organization settings › Connectors; members then choose Connect.)',
      'Name it Kivo and paste the server address above as the MCP server URL. Choose Continue, keep the authentication Claude detects, then Add.',
      'Choose Connect. A Kivo page opens; sign in if asked.',
      'Kivo shows which assistant is asking and what it may do. Choose Allow.',
      'In a conversation, turn Kivo on from the tools menu.',
    ],
    note: 'There is no link that adds Kivo to Claude for you: Claude does not offer one, so the address has to be pasted. Claude’s own guide: claude.com/docs/connectors/custom/add-unlisted.',
  },
  {
    id: 'chatgpt', name: 'ChatGPT', status: 'supported',
    intro: 'On chatgpt.com, on the web.',
    steps: [
      'Open ChatGPT’s plugins page (chatgpt.com/plugins), choose the + button, then Add custom MCP server.',
      'Name it Kivo. Under Connection, paste the server address above as the Server URL, and choose OAuth for authentication.',
      'Read ChatGPT’s warning, choose I understand and want to continue, then Create as a plugin, and install it.',
      'Sign in to Kivo if asked, and choose Allow.',
      'In a conversation, type @ and choose Kivo.',
    ],
    note: 'Which ChatGPT plans and workspaces may add custom MCP servers is up to OpenAI, and its menu names change from time to time; the steps on Kivo’s side stay the same. OpenAI’s own guide: developers.openai.com/api/docs/guides/custom-mcp-server.',
  },
  {
    id: 'other', name: 'Other MCP clients', status: 'untested',
    intro: 'Any client that can add a remote MCP server over Streamable HTTP and sign in with OAuth (with dynamic client registration and PKCE) should be able to connect. Kivo has not tested these.',
    steps: [
      'Add a remote (HTTP) MCP server in the client and paste the server address above.',
      'Choose OAuth sign-in. The client registers itself with Kivo; no API key is needed.',
      'Sign in to Kivo in the window that opens and select Allow.',
    ],
    note: 'Clients that only run local (stdio) servers or that need a static API key cannot connect: Kivo signs in with OAuth only.',
  },
]

export type ToolKind = 'read' | 'write' | 'approval'
export const MCP_TOOLS: Array<{ group: string; items: Array<[name: string, what: string, kind: ToolKind]> }> = [
  { group: 'Your workspace', items: [
    ['get_my_profile', 'Which Kivo account is connected and what it may do', 'read'],
    ['list_workspaces', 'Your workspaces and top-level subjects', 'read'],
    ['get_workspace_context', 'One workspace: its subjects, topics and recent notes', 'read'],
    ['get_workspace_structure', 'The subject and topic outline of a workspace', 'read'],
    ['get_dashboard_summary', 'Counts and recent activity across your knowledge', 'read'],
    ['summarize_workspace', 'A summary of a workspace’s material', 'read'],
  ] },
  { group: 'Notes', items: [
    ['search_notes', 'Find notes by words in their title or text', 'read'],
    ['get_note', 'Read one note, and look at its images when asked', 'read'],
    ['list_recent_notes', 'Notes you changed most recently', 'read'],
    ['create_note', 'Create a note, with screenshots or images if given, optionally filed under a subject or topic', 'write'],
    ['update_note', 'Edit exact passages of a note, replace its whole text (a long note needs approval), add text or images at the end or under a heading, or rename it (needs approval). The text before each change is kept.', 'write'],
    ['restore_note_version', 'Undo a change to a note: put back its text as it was before the last edit, replace or addition', 'write'],
    ['set_topic_status', 'Mark a topic not started, in progress or completed, when you say where it stands', 'write'],
    ['link_notes', 'Link a note to another note or a topic', 'write'],
    ['move_note', 'Refile a note under another subject or topic', 'approval'],
    ['delete_note', 'Delete a note', 'approval'],
  ] },
  { group: 'Knowledge Map', items: [
    ['get_knowledge_map', 'Your subjects, topics and how they connect', 'read'],
    ['search_knowledge_nodes', 'Find a subject or topic on the map', 'read'],
    ['get_node_connections', 'What a subject or topic connects to', 'read'],
    ['add_knowledge_node', 'Add a subject or topics', 'write'],
    ['update_knowledge_node', 'Describe a topic (at once), or rename a subject or topic (needs approval)', 'write'],
    ['connect_knowledge_nodes', 'Connect two items on the map', 'write'],
    ['build_knowledge_map', 'Build or extend a map from an outline (preview first)', 'approval'],
  ] },
  { group: 'Saved web pages', items: [
    ['save_page', 'Save a web page to Kivo, optionally filed under a subject or topic', 'write'],
    ['get_saved_page', 'Read one saved page’s details', 'read'],
    ['search_saved_pages', 'Find saved pages by words in their title, site or notes', 'read'],
    ['file_saved_page', 'File a saved page under a subject or topic', 'write'],
    ['unfile_saved_page', 'Take a saved page off a subject or topic (the page stays saved)', 'write'],
  ] },
  { group: 'Understanding your knowledge', items: [
    ['global_search', 'Search notes and the map together', 'read'],
    ['find_related_content', 'Notes and topics related to one item', 'read'],
    ['analyze_knowledge', 'How your material is structured, and where it is thin', 'read'],
    ['recommend_connections', 'Links that may be missing between notes and topics', 'read'],
    ['find_knowledge_gaps', 'Topics with little or no material', 'read'],
    ['organize_workspace', 'A proposed reorganisation (nothing is changed)', 'read'],
  ] },
  { group: 'Saving and reviewed changes', items: [
    ['capture_knowledge', 'Save ideas from the conversation as notes, skipping duplicates and adding to existing notes (preview first)', 'write'],
    ['preview_knowledge_changes', 'Show exactly what a set of changes would do', 'read'],
    ['execute_knowledge_changes', 'Apply a previewed set of changes once you have approved it in Kivo', 'approval'],
    ['check_approval', 'See whether you approved or declined a change, and its result', 'read'],
  ] },
]

export const MCP_PERMISSIONS: Array<[scope: string, what: string]> = [
  ['profile:read', 'your name and which account is connected'],
  ['workspace:read', 'your workspaces, subjects and topics'],
  ['notes:read', 'read and search your notes'],
  ['notes:write', 'create, add to, link, move and (with your approval) delete notes'],
  ['knowledge:read', 'read your Knowledge Map and your saved pages'],
  ['knowledge:write', 'add, describe and connect subjects and topics'],
  ['pages:write', 'save web pages to Kivo and file them on your Knowledge Map'],
]

// The guide's three things an assistant can do with Kivo, by tool name: each
// line on the page is that tool's own description from MCP_TOOLS (never
// written twice), and each example is something those tools answer.
// mcp-clients.test.ts checks every name is a tool.
export const MCP_CAPABILITIES: Array<{ id: string; title: string; summary: string; tools: string[]; asks: string[] }> = [
  {
    id: 'find', title: 'Find your knowledge',
    summary: 'Search your notes, your Knowledge Map and the pages you saved, and open exactly the one you need.',
    tools: ['search_notes', 'get_note', 'search_saved_pages', 'search_knowledge_nodes', 'global_search'],
    asks: ['Find my notes about paging', 'What have I saved about LangGraph?'],
  },
  {
    id: 'understand', title: 'Understand where you stand',
    summary: 'See how a subject is structured, what connects to what, and which topics still have nothing written.',
    tools: ['get_workspace_structure', 'get_node_connections', 'find_related_content', 'find_knowledge_gaps', 'recommend_connections'],
    asks: ['Which topics in Operating Systems have no notes yet?', 'What connects to Deadlocks?'],
  },
  {
    id: 'work', title: 'Work with your knowledge',
    summary: 'Turn a good conversation into notes, add topics, file saved pages and link ideas, all as ordinary Kivo records.',
    tools: ['capture_knowledge', 'create_note', 'update_note', 'add_knowledge_node', 'save_page', 'link_notes'],
    asks: ['Save the key ideas from this chat under Operating Systems', 'Add these five topics to my DBMS subject'],
  },
]

/** A tool's description and kind, from MCP_TOOLS. */
export function toolInfo(name: string): { what: string; kind: ToolKind } | null {
  for (const g of MCP_TOOLS) for (const [n, what, kind] of g.items) if (n === name) return { what, kind }
  return null
}

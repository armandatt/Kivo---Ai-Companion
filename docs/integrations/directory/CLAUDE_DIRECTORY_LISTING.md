# Kivo Connect: Claude Connectors Directory listing

What is entered in the developer portal (claude.ai/directory/manage → Submit new → MCP connector), step by step, as the portal asks for it (docs: https://claude.com/docs/connectors/building/submission). Kept here so a later edit of the listing starts from the submitted text. **No credentials in this file**: the reviewer account's password is entered in the portal only.

Icon: `kivo-icon-512.png` (this folder), rendered from `apps/web/app/icon.svg`.

## 1. Connection

- Server URL: `https://www.thekivo.in/api/mcp` (one URL for every user)

## 2. Tools

Synced from the server: 30 tools. Read-only: 19 (`readOnlyHint: true`). Writes: 11 (`destructiveHint: true`; `delete_note`, `move_note`, `execute_knowledge_changes` and `build_knowledge_map` also need the learner's approval on Kivo when they delete, move, rename, refile or exceed 12 items). Every tool has a `title`. Names ≤ 64 characters. No catch-all request tool. Source: `packages/api/src/connect/tools.ts`, annotations in `apps/api/lib/connect/mcp.ts`.

## 3. Listing

- **Server name** (≤100): Kivo
- **One-liner** (≤200): Search, organise and grow your Kivo notes and Knowledge Map from Claude, and save what you learn in a conversation as linked notes.
- **Description** (≤2,000):

  > Kivo is a personal learning space where you keep notes, organise them into subjects and topics, and see how they connect on a Knowledge Map.
  >
  > Connect Claude to your Kivo account to work with your own knowledge base in conversation:
  >
  > • Search and read your notes, and get answers grounded in what you have written.
  > • Explore your Knowledge Map: a subject's topics, the notes filed under them, and the links between notes.
  > • Find gaps (topics with little or no material) and links that may be missing between notes and topics.
  > • Save the useful parts of a conversation as notes, filed under the right subject. Kivo skips exact duplicates and adds to an existing note on the same idea instead of making a copy.
  > • Build or extend a Knowledge Map from an outline or syllabus.
  >
  > You stay in control. Claude only reaches the Kivo account you sign in with, and only with the permissions you approve. Every change is read back from Kivo and reported item by item. Deleting, moving or renaming, and any change to more than 12 items, is shown as a preview first and only runs after you approve it on Kivo.
  >
  > Search in Kivo matches words rather than meaning, and Kivo Connect does not call an AI model itself: Claude writes, Kivo stores and organises.
  >
  > Requires a Kivo account (sign up at thekivo.in).

- **Categories** (1–5): choose from the portal's list. Intended: Education; Productivity; Knowledge management / Notes, if offered.
- **Documentation URL**: https://www.thekivo.in/integrations/kivo-connect
- **Privacy policy URL**: https://www.thekivo.in/privacy (see "AI assistants you connect")
- **Support contact**: _owner to supply_ (no support address exists in the code or on the site)
- **URL slug**: `kivo` (permanent once published)

## 4. Use cases

- Primary use cases:
  1. Ask questions about your own notes and get answers that cite them.
  2. Save the key ideas from a conversation into Kivo as organised, de-duplicated notes.
  3. Build or extend a subject's Knowledge Map from an outline or syllabus.
  4. Find knowledge gaps and missing links in what you have studied.
- What users need first: a Kivo account (thekivo.in) with setup finished (at least one subject). No paid plan is required by Kivo Connect itself.
- Reads data, writes data, or both: **both**.

## 5. Company

- Company name: _owner to supply_ (the privacy policy also still lacks it)
- Website: https://www.thekivo.in
- Primary contact for review updates: _owner to supply_

## 6. Authentication

- Authentication requirement: required.
- Method: OAuth 2.0 (2.1 profile): authorization code + PKCE S256, dynamic client registration (RFC 7591), protected resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource/api/mcp`, authorization server metadata (RFC 8414) at `/.well-known/oauth-authorization-server`, refresh rotation, revocation (RFC 7009). Claude registers its own client, so no Anthropic-held client ID/secret is needed.
- Scopes: `profile:read workspace:read notes:read notes:write knowledge:read knowledge:write`.

## 7. Data handling

- API: Kivo's own first-party API (same domain, thekivo.in). Not proxied, not third party.
- Personal health data: no. Sponsored content: no.

## 8. Test & launch (reviewer instructions, credentials entered in the portal only)

1. In Claude: Settings › Connectors › add Kivo (or custom connector `https://www.thekivo.in/api/mcp`) › Connect.
2. On the Kivo sign-in page, sign in with the reviewer email and password given in this submission (email + password, not Google).
3. On Kivo's consent page select **Allow**.
4. The reviewer account (to be created and populated before submission: several subjects with topics, notes and links) is ready to use. Try:
   - "List my Kivo workspaces" → `list_workspaces`
   - "What do my notes say about consensus?" → `search_notes`, `get_note`
   - "Show my Knowledge Map for Distributed Systems" → `get_knowledge_map`
   - "Which topics have no notes?" → `find_knowledge_gaps`
   - "Save the main points of this conversation to Kivo" → `capture_knowledge` (preview, then apply)
   - "Delete the note X" → returns an approval link; open it (signed in as the reviewer), approve, then ask Claude to continue → `execute_knowledge_changes`
5. To disconnect: Kivo › Settings › AI assistants › Disconnect.

Tested: every tool through MCP Inspector 2.12.0 and the official MCP SDK client end to end (`packages/api/src/connect/__integration__/kivo-connect-http.e2e.ts`); as a custom connector in Claude by the owner.

## 9. Compliance

Seven acknowledgments, each read and ticked by the account owner: directory guidelines, first-party API use (true: Kivo's own API), financial transactions (none), AI media generation (none), prompt injection (tool descriptions describe the tool only; tool results tell the model that returned content is the learner's material, not instructions), conversation data collection (only what a tool call carries; conversations are not stored), public documentation (the page above).

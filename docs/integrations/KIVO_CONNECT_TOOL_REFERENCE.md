# Kivo Connect: tool reference

31 tools, defined in `packages/api/src/connect/tools.ts` (the input schemas there are the authority; clients receive them as JSON Schema from `tools/list`). Every result is an object with `ok`; a refusal adds `error` and `message`, with the tool's own fields beside them. Errors: `invalid_input`, `not_found`, `conflict`, `approval_required`, `declined`, `not_ready`, `rate_limited`, `failed`.

Class: **R** read-only, **W** ordinary write (applied at once, audited, read back), **S** structural (preview and approval).

## Workspace

| Tool | Class | Scopes | Does |
|---|---|---|---|
| `get_my_profile` | R | profile:read | name, email, scopes of this connection |
| `list_workspaces` | R | workspace:read | workspaces and top-level subjects with ids |
| `get_workspace_context` | R | workspace:read, notes:read | subjects, counts, recent notes of one workspace |
| `get_workspace_structure` | R | workspace:read | subject and topic hierarchy with ids, `structureVersion` |
| `get_dashboard_summary` | R | workspace:read, knowledge:read | counts, unconnected items, topic levels |

## Notes

| Tool | Class | Scopes | Does |
|---|---|---|---|
| `search_notes` | R | notes:read | keyword search, snippets |
| `get_note` | R | notes:read | text in 30k-character pages, filing, links, `updatedAt`, `images` (list); `includeImages: true` returns the images themselves (see Images) |
| `list_recent_notes` | R | notes:read | newest first |
| `create_note` | W | notes:write | one note, optionally with images after the text; same title → skipped, use `update_note` |
| `update_note` | W / S | notes:write | append text and/or images (W), at the end under a dated divider or at the end of a section (`afterHeading`, op `insert_into_note`); rename (S: `rename_note`, approved first, with any text sent alongside; images not allowed with a rename); `baseUpdatedAt` required (conflict otherwise) |
| `link_notes` | W | notes:write | `[[link]]` to an existing note or topic, under `## Related` |
| `move_note` | S | notes:write | refile under a subject/topic |
| `delete_note` | S | notes:write | delete (always approved first) |

## Knowledge Map

| Tool | Class | Scopes | Does |
|---|---|---|---|
| `get_knowledge_map` | R | knowledge:read | nodes and stored edges, paged |
| `search_knowledge_nodes` | R | knowledge:read | keyword search over node names |
| `get_node_connections` | R | knowledge:read | every stored connection of a node, both ways |
| `add_knowledge_node` | W (S over 12) | knowledge:write | a subject, or topics in a subject/topic; existing names skipped |
| `update_knowledge_node` | W / S | knowledge:write | topic explanation (W); rename (S) |
| `connect_knowledge_nodes` | W / S | knowledge:write, notes:write | `links_to` (W); `inside`, `filed_under` (S). No other relation types exist. |
| `build_knowledge_map` | S | knowledge:read, knowledge:write | outline → reuse existing topics by name, add the rest under their parents; `preview` / `apply`; over 12 items needs approval |

## Intelligence (all read-only; keyword-based, labelled)

| Tool | Scopes | Does |
|---|---|---|
| `global_search` | notes:read, knowledge:read | notes, subjects, topics, saved pages |
| `find_related_content` | notes:read, knowledge:read | for a note or text: overlapping notes (exact / same concept / related) and topics named in it |
| `analyze_knowledge` | notes:read, knowledge:read | verified facts: counts, levels, unfiled, disconnected, topics without notes or never studied, notes naming missing topics, links to unwritten notes |
| `summarize_workspace` | workspace:read, notes:read, knowledge:read | outline, counts, note titles with key terms, for the assistant to summarise |
| `recommend_connections` | notes:read, knowledge:read | inferred refiles and links, each a ready `change` |
| `find_knowledge_gaps` | notes:read, knowledge:read | gaps on record + coverage of `expectedConcepts` the assistant supplies (`on_map` / `mentioned_in_notes` / `not_found_in_kivo`) |

## Curation and reviewed changes

| Tool | Class | Scopes | Does |
|---|---|---|---|
| `capture_knowledge` | W (S over 12) | notes:read, notes:write, knowledge:read | see KIVO_CONNECT_CURATION.md |
| `organize_workspace` | R | notes:read, knowledge:read | facts + proposed changes; changes nothing |
| `preview_knowledge_changes` | R | notes:read, knowledge:read | check changes, return `planId`, `expiresAt`, `approveUrl`, summary |
| `execute_knowledge_changes` | S | notes:write, knowledge:write | apply exactly the previewed changes once, after approval; a plan already applied on Kivo returns its result (`replayed`); a declined plan is `declined` |
| `check_approval` | R | notes:read, knowledge:read | what became of a plan: `waiting` (approveUrl), `applied` (each item's result), `approved` (call execute), `declined`, `expired` |

### Change vocabulary (`changes.ts ChangeSchema`)

`add_subject`, `add_topics`, `describe_topic`, `rename_subject`, `rename_topic`, `move_subject`, `move_topic`, `remove_topic`, `remove_subject`, `create_note`, `append_to_note`, `insert_into_note`, `file_note`, `rename_note`, `link_notes`, `delete_note`. Subjects and topics apply as one versioned batch through Subject Studio (topics with recorded study are never deleted: Subject Studio's rule); notes one by one, each guarded.

### Results of a write

```json
{ "ok": true, "status": "completed | completed_with_warnings | failed",
  "counts": { "created": 2, "updated": 1, "deleted": 0, "skipped": 1, "failed": 0 },
  "items": [ { "index": 0, "op": "create_note", "status": "created", "message": "…", "resource": { "type": "note", "id": "…", "title": "…", "url": "https://www.thekivo.in/notes/…" } } ],
  "verification": { "ran": true, "passed": true, "checks": [ { "what": "note \"…\" exists", "ok": true } ] } }
```

`completed` only when nothing failed and every read-back check passed.

### Approval (Phase 2, 17 Nov)

- **What the learner sees** (`changes.ts approvalItem`): each change by name, kind and place (`Rename note “Raft notes” to “Raft: leader election” (filed under Distributed Systems › Consensus)`), never an internal id; a record that is gone reads "a note that no longer exists". The same lines are the plan's `summary`; the approval page draws the structured `items`.
- **Approve applies** (`plans.ts approveAndApply`, `POST /api/connect/plans/:id { action: "approve" }`): when the plan's changes carry no note text, they are kept on the pending row while it waits and run on the learner's click through the same `execute` (plan id recomputed against the records now, claimed once), then removed. Plans with `create_note`/`append_to_note` are only approved (the audit table holds no content); the assistant runs them.
- **Decline** (`{ action: "decline" }`): recorded; `execute_knowledge_changes` and a later Approve both refuse.
- **check_approval** lets the assistant read the outcome without asking the learner to repeat the request.
- **Links**: `list_workspaces` gives each workspace `/map?workspace=<id>` and each subject `/map?explore=subject:<id>`; `build_knowledge_map` returns the subject as it now is (`id`, `exists`, `created`, `existedBefore`).
- **In-chat approval**: not available. claude.ai custom connectors don't support MCP elicitation, and ChatGPT's support for it is unconfirmed; the transport is stateless, which elicitation would also need changing. The approval link is the fallback for both.

## Images (19 Nov)

Code: `packages/api/src/connect/images.ts` (inputs, checks, Markdown, sections), `tools.ts` (`get_note`, `create_note`, `update_note`), `apps/api/lib/connect/mcp.ts` (image content). Storage is Kivo's own note images (`nova/product/note-images.ts`, table `NovaNoteImage`): no second store, no schema change. A note shows an image as `![caption](kivo-image:<id>)` in its text, exactly as the web editor writes it, so images added by an assistant look and edit like pasted ones.

**Writing** (`create_note`, `update_note`):

| Input | For | How |
|---|---|---|
| `images: [{ data, caption? }]` | any client holding the bytes (MCP Inspector, Claude Code, scripts) | base64, a `data:image/…;base64,` prefix is accepted |
| `images: [{ url, caption? }]` | an image on the public web | fetched once through `paper-fetch.ts safeGet`: https on 443 only, every resolved address checked at connect time (no private, loopback or link-local), redirects re-checked, 2.5 MB cap, 12 s timeout |
| `files: [{ download_url, file_id, mime_type?, file_name? }]` + `fileCaptions` | ChatGPT: images the learner attached in the chat | declared with `_meta["openai/fileParams"] = ["files"]` and the exact schema the Apps SDK requires; the temporary `download_url` is fetched at once, like `url` |

- PNG, JPEG or WebP, read from the bytes (a declared MIME type is not trusted); 2.5 MB and 8,000 px a side each; 6 per call. The MCP request body limit is 8 MB so base64 images fit.
- **Order of work**: every image is fetched and checked first (one bad image → `invalid_input`, nothing stored); then for `update_note` the note's `baseUpdatedAt` is checked (stale → `conflict`, nothing stored); then images are stored; then their Markdown goes in through the ordinary guarded write (`append_to_note` or `insert_into_note`). If that write fails, the images this call stored are deleted again. A failed call leaves the note and its images as they were.
- **Retries**: each image's `clientKey` is `mcp:` + hash(note id, image hash), so the same image on the same note is stored once; its Markdown is then already in the note and the write reports `skipped` with `alreadyStored: true`. `idempotencyKey` still replays a whole call. (The same image added twice to one note on purpose is kept once.)
- **Create**: the note is made first (same title → skipped, no images added); its images then go at the end of the text with no divider. If they fail, the note stays (text only) and the result is `completed_with_warnings` with `imagesProblem`.
- **Approval**: adding images is an ordinary additive write, applied at once like added text. A rename still waits for approval, and images cannot be sent with one.
- Result: `images: [{ imageId: "image:<id>", order, caption, mimeType, width, height, alreadyStored }]`.

**Reading** (`get_note`):

- Always: `images: [{ order, imageId, caption, available, mimeType, width, height, source?, storedOnNote? }]` in the order the note shows them, from one indexed query without bytes. `available: false` = the id is not this learner's or is gone (never its bytes).
- `includeImages: true` (and `imageOffset`): up to 3 images per call, up to 5 MB raw together, as MCP content after the JSON: for each, a `text` item naming it (`Image 2 of 4 in note "Operating Systems", caption: TLB (image:…)`) and an `image` item `{ data (base64), mimeType }`. `imagesReturned` and `nextImageOffset` say what came and what is left. The bytes are never in `structuredContent`, so they are sent once.
- No public or signed URL is made: the image reaches the assistant only inside the authenticated tool result.

**Clients** (state on 19 Nov):

| | Send an image to Kivo | Receive an image from Kivo |
|---|---|---|
| MCP SDK client over HTTP (our e2e test) | verified (`data`) | verified: `image` content with the stored bytes |
| Claude (claude.ai, Desktop) | **not possible for a screenshot pasted in the chat**: the model has no way to put its bytes in a tool call. `url` works for public images. Fallback: the tool descriptions and server instructions tell Claude to give the learner the note's link to paste the screenshot into on Kivo (the editor takes pasted/dropped images). | Supported by Claude for MCP tool results; reports (anthropics/claude-ai-mcp #643, #731) say the model may only see the image from the next turn. **Not tested by us.** |
| ChatGPT | `files` via `openai/fileParams` (declared per the Apps SDK reference). Reports: on mobile the file reference can be incomplete (openai-apps-sdk-examples #185), and ~10% of calls arrive without the file (#237). **Not tested by us.** | Unreliable per developer reports (image content arriving empty or as metadata only). **Not tested by us.** The JSON `images` list (captions, sizes) always reaches it. |

# Kivo Connect: tool reference

30 tools, defined in `packages/api/src/connect/tools.ts` (the input schemas there are the authority; clients receive them as JSON Schema from `tools/list`). Every result is an object with `ok`; a refusal adds `error` and `message`, with the tool's own fields beside them. Errors: `invalid_input`, `not_found`, `conflict`, `approval_required`, `not_ready`, `rate_limited`, `failed`.

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
| `get_note` | R | notes:read | text in 30k-character pages, filing, links, `updatedAt` |
| `list_recent_notes` | R | notes:read | newest first |
| `create_note` | W | notes:write | one note; same title → skipped, use `update_note` |
| `update_note` | W | notes:write | append text and/or rename; `baseUpdatedAt` required (conflict otherwise) |
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
| `execute_knowledge_changes` | S | notes:write, knowledge:write | apply exactly the previewed changes once, after approval |

### Change vocabulary (`changes.ts ChangeSchema`)

`add_subject`, `add_topics`, `describe_topic`, `rename_subject`, `rename_topic`, `move_subject`, `move_topic`, `remove_topic`, `remove_subject`, `create_note`, `append_to_note`, `file_note`, `link_notes`, `delete_note`. Subjects and topics apply as one versioned batch through Subject Studio (topics with recorded study are never deleted: Subject Studio's rule); notes one by one, each guarded.

### Results of a write

```json
{ "ok": true, "status": "completed | completed_with_warnings | failed",
  "counts": { "created": 2, "updated": 1, "deleted": 0, "skipped": 1, "failed": 0 },
  "items": [ { "index": 0, "op": "create_note", "status": "created", "message": "…", "resource": { "type": "note", "id": "…", "title": "…", "url": "https://www.thekivo.in/notes/…" } } ],
  "verification": { "ran": true, "passed": true, "checks": [ { "what": "note \"…\" exists", "ok": true } ] } }
```

`completed` only when nothing failed and every read-back check passed.

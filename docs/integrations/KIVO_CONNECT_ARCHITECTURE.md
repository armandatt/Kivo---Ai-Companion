# Kivo Connect: architecture

Kivo Connect lets an AI assistant (ChatGPT, Claude, any remote MCP client) work in a learner's Kivo: search and read notes, save knowledge from a conversation, build and connect the Knowledge Map, and analyse what is there. Kivo stays the only copy of the data.

## Shape

```
ChatGPT / Claude / MCP Inspector
        │  HTTPS, MCP Streamable HTTP (stateless, JSON responses), OAuth 2.1 bearer token
        ▼
www.thekivo.in  (Vercel, apps/web)  ── rewrites ──►  Render, apps/api
   /connect/authorize   consent page (web)              /api/mcp                      app/api/mcp/route.ts → lib/connect/mcp.ts
   /connect/approve     plan approval page (web)        /api/oauth/{register,token,revoke}
   Settings › AI assistants                             /.well-known/oauth-*          metadata
                                                        /api/connect/{authorize,connections,plans/[id]}  (session cookie)
        │
        ▼
packages/api/src/connect            no HTTP, no model
   tools.ts        the 30 tools: schema, scopes, class, handler; runTool
   changes.ts      the change vocabulary → Kivo's own writers; read-back verification
   plans.ts        preview → approve → execute (HMAC plan id, single run)
   curation.ts     capture_knowledge and build_knowledge_map planners (pure)
   knowledge.ts    workspaces, search, map, analysis (reads through owners)
   similarity.ts   keyword overlap (pure)
   oauth*.ts, authorize.ts, learner.ts, audit.ts
        │
        ▼
Existing domain modules (unchanged behaviour)
   notes.ts (createNote, updateNote guarded on version, deleteNote, + searchNoteBodies)
   setup-edit.ts (applyStudyEdits: versioned subject/topic batch, all or nothing)
   knowledge-map.ts (map read model), learning-events.ts (saved pages), workspaces.ts
        │
        ▼
Prisma → Neon Postgres
```

## Rules it keeps

- **Thin layer.** No tool writes a learning table. Notes go through `notes.ts`, subjects and topics through Subject Studio's batch (`applyStudyEdits`), so every validation, guard and limit the web app has applies. `registry.test.ts` fails if a `connect/` file touches `prisma.novaNote`, `novaSubject`, `novaTopicMastery`, `novaLearningEvent`, `novaTask` or `novaWorkspace`, or runs raw SQL.
- **No second model.** The assistant is the language model: it extracts, summarises and words. Kivo compares, decides by explicit rules, writes and verifies. Nothing in `connect/` calls an LLM (held by `registry.test.ts`), so Kivo Connect costs no AI spend.
- **No second graph.** Kivo's map has stored relationships only: subject inside subject, topic inside topic or subject, a note filed under a subject/topic, a note's `[[link]]` to a note or topic, task steps and waits. Tools offer those and no others. There is no "prerequisite of" or "similar to" type; such relations belong in note text.
- **Keyword, not semantic.** Kivo has no embeddings and no full-text index; search is case-insensitive substring matching (`ILIKE`) ranked by word overlap. Every search and recommendation says `basis: "keyword"`.
- **Workspaces** are Kivo's own: a `NovaWorkspace` (made from a template or by Build with Nova) and each top-level subject. Ids: `workspace:<id>`, `subject:<id>`. Map node ids are the map's: `subject:`, `topic:`, `note:`, `resource:`, `task:`.
- **Stateless transport.** Each POST builds an MCP server holding only the tools the token's scopes allow, for the token's learner, and discards it. Nothing is kept in process, so reconnects and restarts need nothing.

## Schema (additive)

`NovaConnectClient` (registered assistants), `NovaConnectGrant` (one approval: hashed code, access and refresh tokens, previous refresh hash, scopes, resource, expiries, revocation), `NovaConnectAudit` (writes and refusals; idempotency keys and results; pending plans). All new tables; `User` gains two relation fields. `prisma db push` before deploying the API.

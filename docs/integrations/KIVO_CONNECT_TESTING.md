# Kivo Connect: testing

## Automated

| Suite | Command | What it proves |
|---|---|---|
| Unit (Jest, no DB) | `cd packages/api && npx jest --config jest.config.ts src/connect src/nova/__tests__/extension-origin.test.ts` | OAuth rules (PKCE RFC 7636 vector, redirects, registration, scopes, resource), keyword overlap, curation and map planning, the approval rule, plan id binding, registry (every spec'd tool, scopes, no identity arguments, no direct table writes, no model calls), CORS route guards |
| Integration (real Postgres) | `cd packages/api && NOVA_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest npx tsx --test src/connect/__integration__/kivo-connect.itest.ts` | OAuth end to end incl. single-use codes, rotation, reuse revocation, revocation; scopes; cross-user isolation and audit; idempotent create; stale update refused; capture skip/enrich/create with provenance; nested map build, rebuild reuse, approval enforced, single run; changed-after-preview and tampered plans refused; partial failure reporting; analysis |
| HTTP end to end (official MCP SDK client) | start `apps/api` on the test DB (header of `kivo-connect-http.e2e.ts`), then `NOVA_TEST_DATABASE_URL=… KIVO_E2E_API=http://localhost:3001 JWT_SECRET=kivo-connect-e2e-secret npx tsx --test src/connect/__integration__/kivo-connect-http.e2e.ts` | 401 + discovery, DCR, consent with the session (forged Origin refused), PKCE token exchange, initialize, tools/list (30, annotations, schemas), tools/call, approval on Kivo, refresh, revocation |

The test database is the Docker one (`nova-test-pg`, port 54329). Push the schema there first: `cd packages/db && DATABASE_URL=… DIRECT_URL=… npx prisma db push`.

## MCP Inspector

Pinned `@modelcontextprotocol/inspector@2.12.0` (CLI), against a local API on the test DB with a token minted on that DB:

```
npx -y @modelcontextprotocol/inspector@2.12.0 --cli http://localhost:3001/api/mcp --transport http \
  --header "Authorization: Bearer <token>" --method tools/list
```

Seen on 2026-11-13: 30 tools listed; `build_knowledge_map` and `capture_knowledge` applied and verified; a bad token made Inspector start its OAuth discovery.

## Client compatibility checklist

| Check | MCP Inspector | ChatGPT | Claude |
|---|---|---|---|
| Discovery from 401 + metadata | ✓ (CLI started OAuth) | not yet tested | not yet tested |
| Dynamic registration, consent, PKCE | ✓ via SDK e2e | not yet tested | not yet tested |
| tools/list, tools/call, structured results | ✓ | not yet tested | not yet tested |
| Approval link flow | ✓ via SDK e2e | not yet tested | not yet tested |

ChatGPT and Claude can only be tested against a deployed HTTPS endpoint with their own accounts; see KIVO_CONNECT_DEPLOYMENT.md. Do not claim compatibility until both rows are filled in from real sessions.

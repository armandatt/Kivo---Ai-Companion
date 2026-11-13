# Kivo Connect: deployment

Kivo Connect runs inside the existing API on Render and is reached through the web app's origin (Vercel rewrites). No new service, subdomain or DNS record.

## Order

1. **Neon:** `cd packages/db && npx prisma db push` (three new tables, additive; `User` gains relation fields only, no column). Must come before the API, or the new routes fail.
2. **Render (API):** set `KIVO_CONNECT_ORIGIN=https://www.thekivo.in` (no trailing slash; falls back to `NEXT_PUBLIC_APP_URL`, so check that one if unset). Deploy.
3. **Vercel (web):** deploys on merge: rewrites for `/api/mcp`, `/api/oauth/*`, `/api/connect/*`, `/.well-known/oauth-*`, the consent and approval pages, Settings › AI assistants.
4. Check: `curl -i -X POST https://www.thekivo.in/api/mcp` → 401 with `WWW-Authenticate: Bearer resource_metadata="https://www.thekivo.in/.well-known/oauth-protected-resource/api/mcp"`; that address and `/.well-known/oauth-authorization-server` return JSON naming `https://www.thekivo.in`.

No other variable: tokens are random (no new secret); plan ids use the existing `JWT_SECRET`.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `KIVO_CONNECT_ORIGIN` | Render (API) | Issuer, resource and consent-page origin. Must be the exact origin users connect to (`https://www.thekivo.in`): tokens are bound to `<origin>/api/mcp`. |
| `JWT_SECRET` (existing) | Render | signs the session read by the consent page; keys plan ids |

## Connecting

The MCP server URL is **`https://www.thekivo.in/api/mcp`** (shown in Settings › AI assistants).

- **Claude** (claude.ai, Pro/Max/Team/Enterprise): Settings → Connectors → Add custom connector → paste the URL → Connect → sign in to Kivo if asked → Allow.
- **ChatGPT** (plans with developer mode / custom connectors): Settings → Apps & Connectors → Advanced → Developer mode on → Create → MCP server URL, authentication OAuth → Create → Connect → Allow.
- **MCP Inspector**: `npx @modelcontextprotocol/inspector`, transport Streamable HTTP, the URL; it runs the OAuth flow itself.

Menu names change; the parts that matter are "custom connector / remote MCP server", the URL, and OAuth.

## Operating

- Logs: `{"layer":"kivo_connect", …}` lines (tool, ok, error kind, ms; authorized/denied; plan approved; refresh reuse). Never content or tokens.
- Health: `GET /api/health` (existing). MCP needs the API awake: a cold start on a sleeping instance can exceed an assistant's timeout.
- Revoke everything for one learner: Settings › AI assistants › Disconnect (or `NovaConnectGrant.revokedAt`).
- Graceful shutdown: requests are short and stateless; nothing to drain beyond Next's own.
- Staging: the same code on another origin; set `KIVO_CONNECT_ORIGIN` to that origin. Tokens from one origin are refused by the other.

# Kivo Connect: authentication

OAuth 2.1 authorization code with PKCE, as the MCP authorization specification asks of a remote server. Kivo is both the protected resource and the authorization server, on one origin (`KIVO_CONNECT_ORIGIN`, production `https://www.thekivo.in`).

## Endpoints

| Purpose | Address |
|---|---|
| MCP endpoint (resource) | `https://www.thekivo.in/api/mcp` |
| Protected resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource/api/mcp` (also without the path) |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server` |
| Dynamic client registration (RFC 7591) | `POST /api/oauth/register` |
| Authorization (consent page) | `/connect/authorize` (web page) → `GET/POST /api/connect/authorize` |
| Token | `POST /api/oauth/token` (form or JSON) |
| Revocation (RFC 7009) | `POST /api/oauth/revoke` |

## Flow

1. The client calls `/api/mcp` without a token and gets **401** with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`.
2. It reads both metadata documents, registers itself (public client, `token_endpoint_auth_method: none`, or with a secret), and opens `/connect/authorize?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256&resource`.
3. The page needs the learner's Kivo session (signed-out visitors are sent to sign in and back). It shows the assistant's self-declared name, the scopes in words and the return host. **Allow** issues a code bound to the account, client, exact redirect address, PKCE challenge, scopes and resource, valid 5 minutes. **Don't allow** returns `access_denied`. Both carry `state` and `iss`.
4. The client exchanges the code with the `code_verifier`: access token (1 hour) and refresh token (30 days).
5. Refresh rotates both tokens. Presenting a refresh token that was already rotated revokes the whole grant (a leaked or replayed copy).

## Checks

- Redirect addresses are registered up front and compared exactly; https only, or http on `localhost`/`127.0.0.1`/`[::1]`. Until `client_id` and `redirect_uri` check out, errors are shown on the page and nothing is redirected.
- PKCE `S256` only. Codes are single use (guarded write). Tokens are random with prefixes (`kca_`, `kcr_`, `kcc_`), stored only as SHA-256.
- A token is accepted only for the resource it was issued for (RFC 8707 audience).
- The user is the grant's user. No tool reads a user, profile or account id from its arguments (`registry.test.ts`).
- The consent and approval POSTs refuse other sites (`crossSiteProblem`: JSON only, own `Origin`, `Sec-Fetch-Site`). The web app sends `X-Frame-Options: DENY`.
- Disconnecting (Settings › AI assistants) or RFC 7009 revocation ends the grant at once.

## Scopes

| Scope | Allows |
|---|---|
| `profile:read` | name, email, connection details |
| `workspace:read` | workspaces, subjects, topics |
| `notes:read` | read and search notes |
| `notes:write` | create, add to, rename, link, refile and (with approval) delete notes |
| `knowledge:read` | the Knowledge Map and analysis |
| `knowledge:write` | add, describe, rename, move subjects and topics; build maps |

A client that asks for no scope gets all six on the consent screen. The MCP server registers only the tools whose scopes the token has.

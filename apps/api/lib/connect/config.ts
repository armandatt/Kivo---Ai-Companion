// Kivo Connect's public addresses. The MCP endpoint and the OAuth endpoints
// are served by this API but reached through the web app's origin (its
// rewrites), because approving a connection needs the learner's Kivo session,
// whose cookie lives on that origin. One origin is the issuer, the resource
// and the consent page's home.
//
// KIVO_CONNECT_ORIGIN: e.g. https://www.thekivo.in (no trailing slash).
// Falls back to NEXT_PUBLIC_APP_URL; in development to http://localhost:3000.
// In production one of them must be set: an issuer must never be guessed.

export function connectOrigin(): string {
  const raw = process.env.KIVO_CONNECT_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")
  if (!raw) throw new Error("KIVO_CONNECT_ORIGIN is not set")
  return raw.replace(/\/+$/, "")
}

export const mcpUrl = () => `${connectOrigin()}/api/mcp`
export const resourceMetadataUrl = () => `${connectOrigin()}/.well-known/oauth-protected-resource/api/mcp`

export const CONNECT_VERSION = "1.0.0"

// Public OAuth endpoints (registration, token, revocation, metadata) answer
// any origin: they take no cookie, and browser tools (MCP Inspector) call
// them. Never put these headers on a cookie-authenticated route.
export const OPEN_CORS: Record<string, string> = {
  "access-control-allow-origin":   "*",
  "access-control-allow-headers":  "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-allow-methods":  "GET, POST, DELETE, OPTIONS",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age":        "600",
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...OPEN_CORS, ...extra } })
}
export const preflight = () => new Response(null, { status: 204, headers: OPEN_CORS })

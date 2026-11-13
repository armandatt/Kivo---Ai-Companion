// OAuth metadata for Kivo Connect: RFC 9728 (protected resource) and RFC 8414
// (authorization server). The authorization endpoint is the web app's
// consent page; the others are this API's routes, reached through the web
// app's origin.

//@ts-ignore
import { ALL_SCOPES } from "@repo/api/connect/oauth-rules"
import { connectOrigin, json, mcpUrl } from "./config"

export function protectedResource(): Response {
  return json({
    resource: mcpUrl(),
    authorization_servers: [connectOrigin()],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Kivo",
    resource_documentation: `${connectOrigin()}/integrations/kivo-connect`,
  }, 200, { "cache-control": "public, max-age=300" })
}

export function authorizationServer(): Response {
  const o = connectOrigin()
  return json({
    issuer: o,
    authorization_endpoint: `${o}/connect/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    registration_endpoint: `${o}/api/oauth/register`,
    revocation_endpoint: `${o}/api/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${o}/guide`,
  }, 200, { "cache-control": "public, max-age=300" })
}

// Form or JSON body → plain fields; the client's credentials from Basic auth or the body.
export async function readForm(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? ""
  const text = (await req.text().catch(() => "")).slice(0, 20_000)
  if (type.includes("application/json")) {
    try { const o = JSON.parse(text); return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string> } catch { return {} }
  }
  return Object.fromEntries(new URLSearchParams(text))
}

export function clientCredentials(req: Request, form: Record<string, string>): { clientId: string | null; secret: string | null } {
  const auth = req.headers.get("authorization") ?? ""
  if (auth.startsWith("Basic ")) {
    try {
      const [id, secret] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":")
      return { clientId: id ? decodeURIComponent(id) : null, secret: secret ? decodeURIComponent(secret) : null }
    } catch { /* fall through */ }
  }
  return { clientId: form.client_id ?? null, secret: form.client_secret ?? null }
}

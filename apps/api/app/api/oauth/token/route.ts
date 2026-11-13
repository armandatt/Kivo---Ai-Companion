// POST /api/oauth/token: authorization_code (with PKCE) and refresh_token.
// Codes are single use; refresh tokens rotate, and a reused one ends the grant.
//@ts-ignore
import { clientAuthenticates, exchangeCode, findClient, refreshTokens } from "@repo/api/connect/oauth"
import { allowAttempt } from "../../../../lib/nova/extension-access"
import { json, preflight } from "../../../../lib/connect/config"
import { clientCredentials, readForm } from "../../../../lib/connect/metadata"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const form = await readForm(req)
  const creds = clientCredentials(req, form)
  if (!creds.clientId || !allowAttempt(`oauth:token:${creds.clientId}`, 60, 60_000)) return json({ error: "invalid_client", error_description: "Unknown client, or too many requests." }, 401)
  const client = await findClient(creds.clientId)
  if (!client || !clientAuthenticates(client, creds.secret)) return json({ error: "invalid_client", error_description: "Client authentication failed." }, 401)
  try {
    const result =
      form.grant_type === "authorization_code" ? await exchangeCode({ clientRowId: client.id, code: form.code, redirectUri: form.redirect_uri, verifier: form.code_verifier })
      : form.grant_type === "refresh_token" ? await refreshTokens({ clientRowId: client.id, refreshToken: form.refresh_token, scope: form.scope })
      : { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." }
    return json(result, "error" in result ? 400 : 200, { pragma: "no-cache" })
  } catch (err) {
    console.error(JSON.stringify({ layer: "kivo_connect", event: "token_failed", error: err instanceof Error ? err.name : "unknown" }))
    return json({ error: "server_error" }, 500)
  }
}
export const OPTIONS = preflight

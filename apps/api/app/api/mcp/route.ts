// POST/GET/DELETE /api/mcp: Kivo Connect's MCP endpoint (Streamable HTTP).
// The caller is the learner the OAuth access token belongs to: verified here
// (live, unrevoked, issued for this endpoint) before anything else runs. No
// id in the request names a user. 401 carries the protected-resource
// metadata address, which is how ChatGPT and Claude find the sign-in flow.

//@ts-ignore
import { authenticateAccessToken } from "@repo/api/connect/oauth"
//@ts-ignore
import { learnerFor } from "@repo/api/connect/learner"
import { allowAttempt } from "../../../lib/nova/extension-access"
import { connectOrigin, json, mcpUrl, OPEN_CORS, preflight, resourceMetadataUrl } from "../../../lib/connect/config"
import { serveMcp } from "../../../lib/connect/mcp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const BODY_MAX_BYTES = 1_200_000
// Per connection: calls a minute. One process (Render), so memory is the answer.
const CALLS_PER_MINUTE = 120

function unauthorized(error: "invalid_token" | null, description: string) {
  const challenge = [`Bearer resource_metadata="${resourceMetadataUrl()}"`, ...(error ? [`error="${error}"`, `error_description="${description}"`] : [])].join(", ")
  return json({ error: error ?? "unauthorized", error_description: description }, 401, { "www-authenticate": challenge })
}

async function handle(req: Request): Promise<Response> {
  const header = req.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null
  if (!token) return unauthorized(null, "Connect your Kivo account to use this.")
  const caller = await authenticateAccessToken(token, mcpUrl())
  if (!caller) return unauthorized("invalid_token", "The access token is not valid, has expired or was revoked.")

  if (!allowAttempt(`mcp:${caller.grantId}`, CALLS_PER_MINUTE, 60_000)) {
    return json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests to Kivo; wait a minute." }, id: null }, 429, { "retry-after": "60" })
  }
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return json({ jsonrpc: "2.0", error: { code: -32600, message: "Request too large." }, id: null }, 413)

  const learner = await learnerFor(caller)
  if (!learner.ok) return json({ jsonrpc: "2.0", error: { code: -32001, message: learner.message }, id: null }, 403)

  const res = await serveMcp(req, learner.learner, connectOrigin())
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(OPEN_CORS)) out.headers.set(k, v)
  return out
}

export async function POST(req: Request) {
  try { return await handle(req) }
  catch (err) {
    console.error(JSON.stringify({ layer: "kivo_connect", event: "mcp_failed", error: err instanceof Error ? err.name : "unknown" }))
    return json({ jsonrpc: "2.0", error: { code: -32603, message: "Kivo could not handle this request." }, id: null }, 500)
  }
}
// Stateless: no server-to-client stream and no session to end.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!auth) return unauthorized(null, "Connect your Kivo account to use this.")
  return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" })
}
export const DELETE = () => json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" })
export const OPTIONS = preflight

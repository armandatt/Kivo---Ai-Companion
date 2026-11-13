// POST /api/oauth/register: RFC 7591 dynamic client registration. ChatGPT and
// Claude register themselves before the learner sees anything; a client owns
// nothing until a learner approves it. Limited per minute across all callers.
//@ts-ignore
import { parseRegistration } from "@repo/api/connect/oauth-rules"
//@ts-ignore
import { registerClient } from "@repo/api/connect/oauth"
import { allowAttempt } from "../../../../lib/nova/extension-access"
import { json, preflight } from "../../../../lib/connect/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  if (!allowAttempt("oauth:register", 30, 60_000)) return json({ error: "temporarily_unavailable", error_description: "Too many registrations; try again in a minute." }, 429)
  const text = (await req.text().catch(() => "")).slice(0, 20_000)
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* invalid below */ }
  const parsed = parseRegistration(body)
  if (!parsed.ok) return json({ error: parsed.error, error_description: parsed.description }, 400)
  try {
    return json(await registerClient(parsed.reg), 201)
  } catch (err) {
    console.error(JSON.stringify({ layer: "kivo_connect", event: "register_failed", error: err instanceof Error ? err.name : "unknown" }))
    return json({ error: "server_error" }, 500)
  }
}
export const OPTIONS = preflight

// POST /api/oauth/revoke: RFC 7009. Either token ends the whole grant. The
// answer is the same whether or not the token existed.
//@ts-ignore
import { clientAuthenticates, findClient, revokeToken } from "@repo/api/connect/oauth"
import { json, preflight } from "../../../../lib/connect/config"
import { clientCredentials, readForm } from "../../../../lib/connect/metadata"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const form = await readForm(req)
  const creds = clientCredentials(req, form)
  const client = await findClient(creds.clientId)
  if (!client || !clientAuthenticates(client, creds.secret)) return json({ error: "invalid_client" }, 401)
  await revokeToken(form.token, client.id)
  return json({}, 200)
}
export const OPTIONS = preflight

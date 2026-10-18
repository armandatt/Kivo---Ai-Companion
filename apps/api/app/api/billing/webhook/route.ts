import { NextResponse } from "next/server"
//@ts-ignore
import { handleWebhook } from "@repo/api/billing/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/billing/webhook: the payment provider's events. No session: the
// signature over the raw body is the only proof, checked before anything is
// read. Answers fast; nothing about the request is logged but the event type.
export async function POST(req: Request) {
  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }
  const { status, body } = await handleWebhook({ rawBody, headers })
  return NextResponse.json(body, { status })
}

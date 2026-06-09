import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { jwtVerify } from "jose"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
)

function randomHex(bytes = 16): string {
  // Web Crypto API — available in all Next.js environments (Edge + Node)
  const arr = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("")
}

async function getBotName(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_BOT_USERNAME ?? process.env.BOT_USERNAME
  if (configured) return configured.replace(/^@/, "")

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN
  if (!botToken) return "kevo_companion_bot"

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { cache: "no-store" })
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } }
    return data.result?.username ?? "kevo_companion_bot"
  } catch {
    return "kevo_companion_bot"
  }
}

export async function POST() {
  // ── 1. Verify session ─────────────────────────────────────────────────────
  let userId: string
  try {
    const store = await cookies()
    const sessionToken = store.get("kevo_session")?.value
    if (!sessionToken) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 })
    }
    const { payload } = await jwtVerify(sessionToken, SECRET)
    const uid = (payload as { userId?: string }).userId
    if (!uid) return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    userId = uid
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[generate-token] auth:", msg)
    return NextResponse.json({ error: `Auth error: ${msg}` }, { status: 401 })
  }

  // ── 2. Generate token + upsert ────────────────────────────────────────────
  try {
    const { prisma } = await import("@repo/db/client")
    const connectToken = randomHex(16)

    // Update existing profile if present, otherwise create a minimal one
    const existing = await prisma.userProfile.findUnique({
      where:  { userId },
      select: { id: true },
    })

    if (existing) {
      await prisma.userProfile.update({
        where: { userId },
        data:  { telegramConnectToken: connectToken },
      })
    } else {
      await prisma.userProfile.create({
        data: {
          userId,
          telegramConnectToken: connectToken,
          secondaryDomains: [],
          aspirationWords:  [],
        },
      })
    }

    const botName = await getBotName()
    return NextResponse.json({
      token:    connectToken,
      deeplink: `https://t.me/${botName}?start=${connectToken}`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[generate-token] db:", msg)
    return NextResponse.json({ error: `Could not save token: ${msg.slice(0, 120)}` }, { status: 500 })
  }
}

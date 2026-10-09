import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { jwtVerify } from "jose"
import { companionOf, type Companion } from "@repo/api/nova/product/companion"
import { DashboardShell } from "@/components/dashboard-shell"
import { THEME_SCRIPT } from "@/components/theme/kivo-theme"

export const dynamic = "force-dynamic"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
)

async function getUserId(): Promise<string | null> {
  try {
    const store = await cookies()
    const token = store.get("kevo_session")?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
    return (payload as { userId?: string }).userId ?? null
  } catch {
    return null
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userId = await getUserId()
  if (!userId) redirect("/signin")

  // Dynamic import: avoids Prisma loading DATABASE_URL at build time.
  // Wrapped in try/catch — if DB is unavailable (e.g. missing env in Preview
  // deployments), let the authenticated user through rather than hard-crashing.
  // The companion is then left unknown and the shell asks the API for it
  // before showing any companion-specific page.
  let companion: Companion | null = null
  try {
    const { prisma } = await import("@repo/db/client")
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { onboardingComplete: true, primaryPersona: true, telegramChatId: true },
    })
    if (!profile?.onboardingComplete) redirect("/onboarding")

    const messenger = profile.telegramChatId
      ? await prisma.messengerUser.findUnique({
          where:  { platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId } },
          select: { persona: true },
        })
      : null
    // The same rule the API uses to decide who is a Nova learner.
    companion = companionOf({
      primaryPersona:   profile.primaryPersona,
      hasLinkedChat:    profile.telegramChatId !== null,
      messengerPersona: messenger ? messenger.persona : undefined,
    })
  } catch (err) {
    console.error("[dashboard/layout] DB unavailable, skipping onboarding check:", err)
  }

  return (
    <>
      {/* Sets the theme before anything paints. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <DashboardShell companion={companion}>{children}</DashboardShell>
    </>
  )
}

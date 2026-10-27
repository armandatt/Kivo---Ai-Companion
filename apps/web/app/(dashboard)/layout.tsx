import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { jwtVerify } from "jose"
import { companionOf, type Companion } from "@repo/api/nova/product/companion"
import { DashboardShell } from "@/components/dashboard-shell"
import { THEME_SCRIPT } from "@/components/theme/kio-theme"
import { dashboardEntry, type DashboardEntry } from "@/lib/auth/dashboard-entry"
import { sessionSecret } from "@/lib/auth/session-secret"

export const dynamic = "force-dynamic"


async function getUserId(): Promise<string | null> {
  try {
    const store = await cookies()
    const token = store.get("kevo_session")?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, sessionSecret())
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
  // The lookup is guarded: if the DB is unavailable (e.g. missing env in
  // Preview deployments), let the authenticated user through rather than
  // hard-crashing. The companion is then left unknown and the shell asks the
  // API for it before showing any companion-specific page.
  //
  // Nothing in the try block redirects. redirect() works by throwing, and a
  // redirect thrown in here would be caught as a database failure.
  let companion: Companion | null = null
  let entry: DashboardEntry = "enter"
  try {
    const { prisma } = await import("@repo/db/client")
    const account = await prisma.user.findUnique({
      where:  { id: userId },
      select: { userProfile: { select: { onboardingComplete: true, primaryPersona: true, telegramChatId: true } } },
    })
    const profile = account?.userProfile ?? null
    entry = dashboardEntry({ exists: account !== null, onboardingComplete: profile?.onboardingComplete })

    if (entry === "enter" && profile) {
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
    }
  } catch (err) {
    console.error("[dashboard/layout] DB unavailable, skipping onboarding check:", err)
  }
  if (entry !== "enter") redirect(entry)

  return (
    <>
      {/* Sets the theme before anything paints. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <DashboardShell companion={companion}>{children}</DashboardShell>
    </>
  )
}

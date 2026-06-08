import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { jwtVerify } from "jose"
import { DashboardShell } from "@/components/dashboard-shell"

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
  try {
    const { prisma } = await import("@repo/db/client")
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { onboardingComplete: true },
    })
    if (!profile?.onboardingComplete) redirect("/onboarding")
  } catch (err) {
    console.error("[dashboard/layout] DB unavailable, skipping onboarding check:", err)
  }

  return <DashboardShell>{children}</DashboardShell>
}

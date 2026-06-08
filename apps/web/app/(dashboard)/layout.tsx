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

  // Dynamic import: Prisma must not be loaded at build time (no DATABASE_URL in Vercel build env)
  const { prisma } = await import("@repo/db/client")
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { onboardingComplete: true },
  })

  if (!profile?.onboardingComplete) redirect("/onboarding")

  return <DashboardShell>{children}</DashboardShell>
}

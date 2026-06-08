import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { jwtVerify } from "jose"
import { prisma } from "@repo/db/client"
import { DashboardShell } from "@/components/dashboard-shell"

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

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { onboardingComplete: true },
  })

  if (!profile?.onboardingComplete) redirect("/onboarding")

  return <DashboardShell>{children}</DashboardShell>
}

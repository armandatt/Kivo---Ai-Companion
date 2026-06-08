import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard-shell"

async function getSession(): Promise<string | null> {
  const store = await cookies()
  return store.get("kevo_session")?.value ?? null
}

async function fetchOnboardingStatus(token: string): Promise<boolean> {
  try {
    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/nav`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache:   "no-store",
    })
    if (!res.ok) return false
    const data = await res.json()
    return data?.onboardingComplete ?? false
  } catch {
    return false
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const token = await getSession()
  if (!token) redirect("/signin")

  const onboardingComplete = await fetchOnboardingStatus(token)
  if (!onboardingComplete) redirect("/onboarding")

  return <DashboardShell>{children}</DashboardShell>
}

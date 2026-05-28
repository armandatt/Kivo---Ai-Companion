import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { getSession } from "@/lib/auth/session"
import Sidebar from "@/components/dashboard/sidebar"
import TopBar from "@/components/dashboard/topbar"
import BottomNav from "@/components/dashboard/bottom-nav"

type NavData = {
  user: { name: string | null; email: string; image: string | null }
  tier: string
  streakCount: number
  activeGoalCount: number
  overdueCount: number
  hasUnreadReviews: boolean
  evolutionAvailable: boolean
  creatureStage: string
  onboardingComplete: boolean
  platforms: {
    telegram: { connected: boolean; deeplink: string | null }
    whatsapp: { connected: boolean }
  }
}

async function fetchNavData(token: string): Promise<NavData | null> {
  try {
    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/nav`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect("/signin")

  const cookieStore = await cookies()
  const token = cookieStore.get("kevo_session")?.value ?? ""
  const navData = await fetchNavData(token)

  if (navData && !navData.onboardingComplete) {
    redirect("/onboarding")
  }

  const user = navData?.user ?? {
    name: session.name ?? null,
    email: session.email,
    image: session.image ?? null,
  }

  const tier = navData?.tier ?? "free"

  return (
    <>
      <div
        style={{
          display: "flex",
          height: "100vh",
          backgroundColor: "#0D0D0D",
          overflow: "hidden",
        }}
      >
        <div className="kevo-sidebar-wrapper">
          <Sidebar
            streakCount={navData?.streakCount ?? 0}
            activeGoalCount={navData?.activeGoalCount ?? 0}
            overdueCount={navData?.overdueCount ?? 0}
            hasUnreadReviews={navData?.hasUnreadReviews ?? false}
            evolutionAvailable={navData?.evolutionAvailable ?? false}
            creatureStage={navData?.creatureStage ?? "egg"}
            user={user}
            tier={tier}
          />
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <TopBar
            user={user}
            tier={tier}
            hasUnread={navData?.hasUnreadReviews ?? false}
            telegramConnected={navData?.platforms?.telegram?.connected ?? false}
            telegramDeeplink={navData?.platforms?.telegram?.deeplink ?? null}
            whatsappConnected={navData?.platforms?.whatsapp?.connected ?? false}
          />
          <main
            className="kevo-main-content"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "28px 32px",
            }}
          >
            {children}
          </main>
        </div>
      </div>

      <BottomNav creatureStage={navData?.creatureStage ?? "egg"} />
    </>
  )
}

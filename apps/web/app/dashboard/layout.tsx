import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Sidebar from "@/components/dashboard/sidebar"
import TopBar from "@/components/dashboard/topbar"
import BottomNav from "@/components/dashboard/bottom-nav"
import WelcomeSplash from "@/components/dashboard/welcome-splash"

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
  persona: string
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
  const cookieStore = await cookies()
  const token = cookieStore.get("kevo_session")?.value ?? ""
  if (!token) redirect("/signin")

  const navData = await fetchNavData(token)
  if (!navData) redirect("/signin")

  if (!navData.onboardingComplete) {
    redirect("/onboarding")
  }

  const user = navData.user

  const tier = navData.tier

  return (
    <>
      <WelcomeSplash name={user.name ?? null} />
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
            streakCount={navData.streakCount}
            activeGoalCount={navData.activeGoalCount}
            overdueCount={navData.overdueCount}
            hasUnreadReviews={navData.hasUnreadReviews}
            evolutionAvailable={navData.evolutionAvailable}
            creatureStage={navData.creatureStage}
            user={user}
            tier={tier}
            persona={navData.persona}
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
            hasUnread={navData.hasUnreadReviews}
            telegramConnected={navData.platforms.telegram.connected}
            telegramDeeplink={navData.platforms.telegram.deeplink}
            whatsappConnected={navData.platforms.whatsapp.connected}
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

      <BottomNav creatureStage={navData.creatureStage} />
    </>
  )
}

import { cookies } from "next/headers"
import { parseTodayTasks } from "@/lib/plan-parser"
import StreakCounter from "@/components/dashboard/streak-counter"
import CreatureThumbnail from "@/components/dashboard/creature-thumbnail"
import GoalCard from "@/components/dashboard/goal-card"
import MoodRing from "@/components/dashboard/mood-ring"
import TodayPlan from "@/components/dashboard/today-plan"
import UpcomingDeadlines from "@/components/dashboard/upcoming-deadlines"
import LastMessage from "@/components/dashboard/last-message"
import TelegramConnectBanner from "@/components/dashboard/telegram-connect-banner"

type MoodEntry = { date: string; mood: string }

type DashboardData = {
  user: { name: string | null; email: string; image: string | null }
  profile: {
    creatureName: string | null
    creatureType: string | null
    creatureColor: string | null
    primaryPersona: string | null
    personaName: string | null
    primaryGoal30d: string | null
    goalCategory: string | null
    aspirationWords: string[]
    onboardingComplete: boolean
    preferredCheckInTime: string | null
  } | null
  streak: { current: number; best: number; broken: boolean }
  mood: MoodEntry[]
  planContent: string | null
  planId: string | null
  deadlines: Array<{ id: string; title: string; dueAt: string }>
  lastMessage: { text: string; timestamp: string } | null
  telegramConnected: boolean
}

async function fetchDashboard(): Promise<DashboardData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/dashboard`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })

    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function DashboardPage() {
  const data = await fetchDashboard()

  const streak = data?.streak ?? { current: 0, best: 0, broken: false }
  const profile = data?.profile ?? null
  const mood = data?.mood ?? []
  const deadlines = data?.deadlines ?? []
  const lastMessage = data?.lastMessage ?? null
  const telegramConnected = data?.telegramConnected ?? false
  const planContent = data?.planContent ?? null
  const planId = data?.planId ?? null
  const todayTasks = parseTodayTasks(planContent, planId)

  return (
    <div style={{ maxWidth: "1100px" }}>
      {/* 2×2 grid — above the fold */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          marginBottom: "16px",
        }}
      >
        <StreakCounter
          current={streak.current}
          best={streak.best}
          broken={streak.broken}
          skipUsed={false}
        />
        <CreatureThumbnail
          creatureType={profile?.creatureType ?? null}
          creatureColor={profile?.creatureColor ?? null}
          creatureName={profile?.creatureName ?? null}
          streak={streak.current}
        />
        <GoalCard
          goal={profile?.primaryGoal30d ?? null}
          category={profile?.goalCategory ?? null}
        />
        <MoodRing entries={mood} />
      </div>

      {/* Below the fold */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {!telegramConnected && <TelegramConnectBanner />}
        <TodayPlan tasks={todayTasks} planId={planId} />
        <UpcomingDeadlines deadlines={deadlines} />
        <LastMessage
          message={lastMessage}
          personaName={profile?.personaName ?? null}
        />
      </div>
    </div>
  )
}

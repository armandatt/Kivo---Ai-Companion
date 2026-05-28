import { cookies } from "next/headers"
import AspirationAnchor from "@/components/goals/aspiration-anchor"
import GoalList from "@/components/goals/goal-list"
import GoalArchive from "@/components/goals/goal-archive"

type GoalItem = {
  id: string
  title: string
  category: string | null
  daysTotal: number
  daysRemaining: number
  status: "active" | "completed" | "closed"
  createdAt: string
}

type ArchiveItem = {
  id: string
  title: string
  category: string | null
  status: "completed" | "closed"
  completedAt: string | null
  daysTaken: number | null
  createdAt: string
}

type GoalsData = {
  goals: GoalItem[]
  archive: ArchiveItem[]
  aspirationWords: string[]
  tier: string
}

async function fetchGoals(): Promise<GoalsData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/goals`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })

    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function GoalsPage() {
  const data = await fetchGoals()
  const goals = data?.goals ?? []
  const archive = data?.archive ?? []
  const aspirationWords = data?.aspirationWords ?? []
  const tier = data?.tier ?? "free"

  return (
    <div style={{ maxWidth: "760px", position: "relative" }}>
      <AspirationAnchor words={aspirationWords} />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
            Goals
          </h1>
          <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
            Your active commitments. Set new ones by messaging Kevo.
          </p>
        </div>

        <GoalList goals={goals} tier={tier} />

        <div style={{ height: "20px" }} />

        <GoalArchive archive={archive} />
      </div>
    </div>
  )
}

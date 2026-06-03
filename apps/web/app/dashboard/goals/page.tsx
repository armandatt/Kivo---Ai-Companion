import { cookies } from "next/headers"
import AspirationAnchor from "@/components/goals/aspiration-anchor"
import GoalList from "@/components/goals/goal-list"
import GoalArchive from "@/components/goals/goal-archive"

type GoalItem = {
  id: string
  title: string
  category: string | null
  daysTotal: number | null
  daysRemaining: number | null
  status: "active" | "paused" | "completed" | "closed"
  createdAt: string
  source?: "web" | "telegram"
}

type ArchiveItem = {
  id: string
  title: string
  category?: string | null
  status: "completed" | "closed" | "abandoned"
  completedAt?: string | null
  daysTaken?: number | null
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
  const data            = await fetchGoals()
  const goals           = data?.goals ?? []
  const archive         = data?.archive ?? []
  const aspirationWords = data?.aspirationWords ?? []
  const tier            = data?.tier ?? "free"

  const activeGoals    = goals.filter((g) => g.status === "active")
  const pausedGoals    = goals.filter((g) => g.status === "paused")
  const completedGoals = archive.filter((a) => a.status === "completed")

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <AspirationAnchor words={aspirationWords} />

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Header */}
        <div style={{ marginBottom: "24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
              Goals
            </h1>
            <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
              Your active commitments. Set new ones by messaging your companion.
            </p>
          </div>
          {/* Quick stats */}
          <div style={{ display: "flex", gap: "8px" }}>
            {[
              { label: "Active",    value: activeGoals.length,    color: "var(--kv-accent)" },
              { label: "Paused",    value: pausedGoals.length,    color: "#F59E0B" },
              { label: "Completed", value: completedGoals.length, color: "#22C55E" },
            ].map((s) => (
              <div key={s.label} style={{
                backgroundColor: "#111111",
                border:          "1px solid #2A2A2A",
                borderRadius:    "8px",
                padding:         "8px 14px",
                textAlign:       "center",
              }}>
                <p style={{ fontSize: "18px", fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: "10px", color: "#666", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 2-column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px", alignItems: "start" }}>
          {/* Left: active + paused goals */}
          <div>
            <GoalList goals={goals} tier={tier} />
          </div>

          {/* Right: archive */}
          <div>
            <GoalArchive archive={archive} />
          </div>
        </div>
      </div>
    </div>
  )
}

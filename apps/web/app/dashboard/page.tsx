import { cookies } from "next/headers"
import { parseTodayTasks } from "@/lib/plan-parser"
import GymStatCards from "@/components/dashboard/gym-stat-cards"
import WeekSplit from "@/components/dashboard/week-split"
import NextSessionTargets from "@/components/dashboard/next-session-targets"
import LiftProgress from "@/components/dashboard/lift-progress"
import RexFlags from "@/components/dashboard/rex-flags"
import VolumeHeatmap from "@/components/dashboard/volume-heatmap"
import NovaDashboard from "@/components/dashboard/nova-dashboard"
import NovaIntro from "@/components/dashboard/nova-intro"
import RexIntro from "@/components/dashboard/rex-intro"
import type { GymData } from "@/types/gym"

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
  gymData: GymData | null
}

async function fetchDashboard(): Promise<DashboardData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null
    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/dashboard`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache:   "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function DashboardPage() {
  const data = await fetchDashboard()

  const streak           = data?.streak ?? { current: 0, best: 0, broken: false }
  const profile          = data?.profile ?? null
  const mood             = data?.mood ?? []
  const deadlines        = data?.deadlines ?? []
  const lastMessage      = data?.lastMessage ?? null
  const telegramConnected = data?.telegramConnected ?? false
  const planContent      = data?.planContent ?? null
  const planId           = data?.planId ?? null
  const todayTasks       = parseTodayTasks(planContent, planId)
  const gym              = data?.gymData ?? null

  const isRex = profile?.primaryPersona === "rex"

  // ── Rex gym dashboard ─────────────────────────────────────────────────────
  if (isRex) {
    // Not yet connected to Telegram — show rich Rex intro
    if (!telegramConnected || !gym) {
      return <RexIntro userName={data?.user?.name ?? null} />
    }

    return (
      <div style={{ maxWidth: "1200px" }}>
        <GymStatCards gym={gym} />

        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <WeekSplit gym={gym} />
          <NextSessionTargets gym={gym} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <LiftProgress gym={gym} />
          <RexFlags gym={gym} />
        </div>

        <div style={{ marginBottom: "12px" }}>
          <VolumeHeatmap gym={gym} />
        </div>

        <RexCompanionCard lastMessage={lastMessage} telegramConnected={telegramConnected} />
      </div>
    )
  }

  // ── Nova dashboard ────────────────────────────────────────────────────────
  if (!telegramConnected) {
    return <NovaIntro userName={data?.user?.name ?? null} />
  }

  return (
    <NovaDashboard
      userName={data?.user?.name ?? null}
      streak={streak}
      mood={mood}
      todayTasks={todayTasks}
      deadlines={deadlines}
      lastMessage={lastMessage}
      primaryGoal={profile?.primaryGoal30d ?? null}
      telegramConnected={telegramConnected}
      personaName={profile?.personaName ?? "Nova"}
    />
  )
}

// ── Rex companion card ────────────────────────────────────────────────────────
function RexCompanionCard({
  lastMessage,
  telegramConnected,
}: {
  lastMessage:       { text: string; timestamp: string } | null
  telegramConnected: boolean
}) {
  const preview     = lastMessage?.text?.slice(0, 120) ?? "No conversation yet. Open Telegram to start training with Rex."
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME ?? ""
  const deeplink    = botUsername ? `https://t.me/${botUsername}` : null

  return (
    <div
      style={{
        backgroundColor: "#111111",
        border:          "1px solid #2A2A2A",
        borderRadius:    "10px",
        padding:         "16px 20px",
        display:         "flex",
        alignItems:      "center",
        gap:             "14px",
      }}
    >
      <div
        style={{
          width:           "40px",
          height:          "40px",
          borderRadius:    "50%",
          background:      "linear-gradient(135deg, #00F5A0, #00C070)",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          fontSize:        "16px",
          fontWeight:      700,
          color:           "#0D0D0D",
          flexShrink:      0,
        }}
      >
        R
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 3px" }}>
          Rex — your gym coach
        </p>
        <p
          style={{
            fontSize:     "12px",
            color:        "#666",
            margin:       0,
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}
        >
          {preview}
        </p>
      </div>
      {telegramConnected && deeplink && (
        <a
          href={deeplink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize:       "12px",
            fontWeight:     600,
            color:          "#00F5A0",
            textDecoration: "none",
            whiteSpace:     "nowrap",
            flexShrink:     0,
          }}
        >
          Open Rex ↗
        </a>
      )}
    </div>
  )
}

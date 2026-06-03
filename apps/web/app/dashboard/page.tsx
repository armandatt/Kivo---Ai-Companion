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
import GymStatCards from "@/components/dashboard/gym-stat-cards"
import WeekSplit from "@/components/dashboard/week-split"
import NextSessionTargets from "@/components/dashboard/next-session-targets"
import LiftProgress from "@/components/dashboard/lift-progress"
import RexFlags from "@/components/dashboard/rex-flags"
import VolumeHeatmap from "@/components/dashboard/volume-heatmap"
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

  // ── Rex gym dashboard ────────────────────────────────────────────────────────
  if (gym) {
    return (
      <div style={{ maxWidth: "1200px" }}>
        {/* 4 top stat cards */}
        <GymStatCards gym={gym} />

        {/* Main 2-col: 60 / 40 */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <WeekSplit gym={gym} />
          <NextSessionTargets gym={gym} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <LiftProgress gym={gym} />
          <RexFlags gym={gym} />
        </div>

        {/* Volume + heatmap (full width, 2-col internal) */}
        <div style={{ marginBottom: "12px" }}>
          <VolumeHeatmap gym={gym} />
        </div>

        {/* Nova companion card */}
        <NovaCompanionCard
          personaName={profile?.personaName ?? null}
          lastMessage={lastMessage}
          telegramConnected={telegramConnected}
        />
      </div>
    )
  }

  // ── Default dashboard (non-Rex / no gym data) ─────────────────────────────
  return (
    <div style={{ maxWidth: "1100px" }}>
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

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {!telegramConnected && <TelegramConnectBanner />}
        <TodayPlan tasks={todayTasks} planId={planId} />
        <UpcomingDeadlines deadlines={deadlines} />
        <LastMessage message={lastMessage} personaName={profile?.personaName ?? null} />
      </div>
    </div>
  )
}

// ── Nova companion card ───────────────────────────────────────────────────────

function NovaCompanionCard({
  personaName,
  lastMessage,
  telegramConnected,
}: {
  personaName:        string | null
  lastMessage:        { text: string; timestamp: string } | null
  telegramConnected:  boolean
}) {
  const name    = personaName ?? "Nova"
  const preview = lastMessage?.text?.slice(0, 120) ?? "No conversation yet. Open Telegram to start talking with Nova."
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
      {/* Avatar */}
      <div
        style={{
          width:           "40px",
          height:          "40px",
          borderRadius:    "50%",
          background:      "linear-gradient(135deg, #6366F1, #8B5CF6)",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          fontSize:        "16px",
          fontWeight:      700,
          color:           "#FFFFFF",
          flexShrink:      0,
        }}
      >
        N
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 3px" }}>
          {name} — your study companion
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

      {/* CTA */}
      {deeplink && (
        <a
          href={deeplink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize:       "12px",
            fontWeight:     600,
            color:          "#888",
            textDecoration: "none",
            whiteSpace:     "nowrap",
            flexShrink:     0,
          }}
        >
          Open Telegram ↗
        </a>
      )}
    </div>
  )
}

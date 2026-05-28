import { cookies } from "next/headers"
import StreakHeatmap from "@/components/insights/streak-heatmap"
import FocusSessionLog from "@/components/insights/focus-session-log"
import MoodTrendChart from "@/components/insights/mood-trend-chart"
import WeeklyReviewArchive from "@/components/insights/weekly-review-archive"
import BehaviouralPatternCards from "@/components/insights/behavioural-pattern-cards"

type HeatmapDay = { date: string; level: "high" | "medium" | "low" | "skip" | "none" }
type MoodPoint = { date: string; score: number | null; moodTag: string | null }
type FocusSession = { id: string; durationMin: number; status: "completed" | "abandoned"; startedAt: string }
type WeeklyReview = { id: string; weekLabel: string; summary: string; fullContent: string; createdAt: string }

type InsightsData = {
  heatmap: { days: HeatmapDay[]; currentStreak: number; longestStreak: number; totalDays: number }
  moodTrend: { points: MoodPoint[]; insight: string }
  focusSessions: FocusSession[]
  weeklyReviews: WeeklyReview[]
  tier: string
}

async function fetchInsights(): Promise<InsightsData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/insights`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })

    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function ProgressPage() {
  const data = await fetchInsights()

  const heatmap = data?.heatmap ?? { days: [], currentStreak: 0, longestStreak: 0, totalDays: 0 }
  const moodTrend = data?.moodTrend ?? { points: [], insight: "" }
  const focusSessions = data?.focusSessions ?? []
  const weeklyReviews = data?.weeklyReviews ?? []
  const tier = data?.tier ?? "free"

  return (
    <div style={{ maxWidth: "1000px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          Insights
        </h1>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          Your engagement patterns and energy trends.
        </p>
      </div>

      <StreakHeatmap
        days={heatmap.days}
        currentStreak={heatmap.currentStreak}
        longestStreak={heatmap.longestStreak}
        totalDays={heatmap.totalDays}
      />

      <div style={{ height: "20px" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <FocusSessionLog sessions={focusSessions} tier={tier} />
        <MoodTrendChart points={moodTrend.points} insight={moodTrend.insight} />
      </div>

      <div style={{ height: "20px" }} />

      <WeeklyReviewArchive reviews={weeklyReviews} tier={tier} />

      <div style={{ height: "20px" }} />

      <BehaviouralPatternCards tier={tier} />
    </div>
  )
}

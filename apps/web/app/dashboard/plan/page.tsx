import { cookies } from "next/headers"
import WeekView from "@/components/planner/week-view"
import DeadlineCalendar from "@/components/planner/deadline-calendar"
import TaskList from "@/components/planner/task-list"
import { buildWeekDays } from "@/lib/plan-parser"

type DeadlineItem = {
  id: string
  title: string
  dueAt: string
  status: "active" | "completed" | "overdue"
}

type PlannerData = {
  weekDays: Array<{ date: string; tasks: unknown[] }>
  deadlines: DeadlineItem[]
  hasPlan: boolean
  planContent: string | null
  planId: string | null
}

async function fetchPlanner(): Promise<PlannerData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/planner`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })

    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function getWeekDates(): string[] {
  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayOfWeek)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

export default async function PlanPage() {
  const data = await fetchPlanner()
  const deadlines = data?.deadlines ?? []
  const hasPlan = data?.hasPlan ?? false
  const planContent = data?.planContent ?? null
  const planId = data?.planId ?? null

  const weekDates = getWeekDates()
  const weekDays = buildWeekDays(planContent, planId, weekDates)

  return (
    <div style={{ width: "100%" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          Planner
        </h1>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          Your weekly plan and upcoming deadlines.
        </p>
      </div>

      <div className="kevo-week-scroll">
        <WeekView weekDays={weekDays} hasPlan={hasPlan} planId={planId} />
      </div>

      <div
        className="kevo-planner-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          gap: "20px",
          marginTop: "20px",
        }}
      >
        <DeadlineCalendar deadlines={deadlines} />
        <TaskList deadlines={deadlines} />
      </div>
    </div>
  )
}

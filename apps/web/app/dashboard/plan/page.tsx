import { cookies } from "next/headers"
import WeekView from "@/components/planner/week-view"
import DeadlineCalendar from "@/components/planner/deadline-calendar"
import TaskList from "@/components/planner/task-list"

type Task = { id: string; title: string; status: "pending" | "done" | "skipped" }
type WeekDay = { date: string; tasks: Task[] }

type DeadlineItem = {
  id: string
  title: string
  dueAt: string
  status: "active" | "completed" | "overdue"
}

type PlannerData = {
  weekDays: WeekDay[]
  deadlines: DeadlineItem[]
  hasPlan: boolean
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

export default async function PlanPage() {
  const data = await fetchPlanner()
  const weekDays = data?.weekDays ?? []
  const deadlines = data?.deadlines ?? []
  const hasPlan = data?.hasPlan ?? false

  return (
    <div style={{ maxWidth: "1100px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          Planner
        </h1>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          Your weekly plan and upcoming deadlines.
        </p>
      </div>

      <div className="kevo-week-scroll">
        <WeekView weekDays={weekDays} hasPlan={hasPlan} />
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

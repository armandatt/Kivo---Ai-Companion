import { NextResponse } from "next/server"
import { getSession } from "../lib/auth/session"

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  // Plan and Deadline data lives on MessengerUser — no FK to web User
  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayOfWeek)
  monday.setHours(0, 0, 0, 0)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return {
      date: toDateStr(d),
      tasks: [] as Array<{ id: string; title: string; status: string }>,
    }
  })

  return NextResponse.json({ weekDays, deadlines: [], hasPlan: false })
}

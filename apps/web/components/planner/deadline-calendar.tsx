"use client"

import { useState } from "react"

interface DeadlineItem {
  id: string
  title: string
  dueAt: string
  status: "active" | "completed" | "overdue"
}

interface DeadlineCalendarProps {
  deadlines: DeadlineItem[]
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function getDotColor(deadline: DeadlineItem, doneIds: Set<string>): string {
  if (doneIds.has(deadline.id) || deadline.status === "completed") return "#888888"
  if (deadline.status === "overdue") return "#EF4444"
  const daysUntil = Math.ceil((new Date(deadline.dueAt).getTime() - Date.now()) / 86400000)
  return daysUntil <= 3 ? "#F59E0B" : "#00F5A0"
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

export default function DeadlineCalendar({ deadlines }: DeadlineCalendarProps) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())

  const todayStr = toDateStr(today)

  const deadlineMap = new Map<string, DeadlineItem[]>()
  for (const d of deadlines) {
    const key = d.dueAt.split("T")[0]
    if (!deadlineMap.has(key)) deadlineMap.set(key, [])
    deadlineMap.get(key)!.push(d)
  }

  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
    setSelectedDay(null)
  }

  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
    setSelectedDay(null)
  }

  function dayStr(day: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }

  function toggleDone(id: string) {
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedDeadlines = selectedDay ? (deadlineMap.get(selectedDay) ?? []) : []

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      {/* Month nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <button
          onClick={prevMonth}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#888888",
            fontSize: "18px",
            padding: "4px 8px",
            lineHeight: 1,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF" }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={nextMonth}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#888888",
            fontSize: "18px",
            padding: "4px 8px",
            lineHeight: 1,
          }}
        >
          ›
        </button>
      </div>

      {/* Day name headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "2px",
          marginBottom: "4px",
        }}
      >
        {DAY_NAMES.map((n) => (
          <div key={n} style={{ textAlign: "center" }}>
            <span style={{ fontSize: "10px", color: "#555555", fontWeight: 600 }}>{n}</span>
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />

          const dateStr = dayStr(day)
          const isToday = dateStr === todayStr
          const isSelected = selectedDay === dateStr
          const dayDeadlines = deadlineMap.get(dateStr) ?? []

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDay(isSelected ? null : dateStr)}
              style={{
                background: isSelected
                  ? "rgba(0, 245, 160, 0.08)"
                  : isToday
                  ? "rgba(255, 255, 255, 0.04)"
                  : "none",
                border: isSelected
                  ? "1px solid rgba(0, 245, 160, 0.2)"
                  : isToday
                  ? "1px solid #333333"
                  : "1px solid transparent",
                borderRadius: "6px",
                cursor: dayDeadlines.length > 0 ? "pointer" : "default",
                padding: "5px 2px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  color: isToday ? "#FFFFFF" : isSelected ? "#00F5A0" : "#888888",
                  fontWeight: isToday ? 700 : 400,
                  lineHeight: 1,
                }}
              >
                {day}
              </span>
              {dayDeadlines.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: "2px",
                    flexWrap: "wrap",
                    justifyContent: "center",
                  }}
                >
                  {dayDeadlines.slice(0, 3).map((dl) => (
                    <div
                      key={dl.id}
                      style={{
                        width: "5px",
                        height: "5px",
                        borderRadius: "50%",
                        backgroundColor: getDotColor(dl, doneIds),
                      }}
                    />
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day panel */}
      {selectedDay && (
        <div
          style={{
            marginTop: "14px",
            borderTop: "1px solid #2A2A2A",
            paddingTop: "14px",
          }}
        >
          <p style={{ fontSize: "12px", color: "#888888", margin: "0 0 10px", fontWeight: 600 }}>
            {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
          {selectedDeadlines.length === 0 ? (
            <p style={{ fontSize: "12px", color: "#444444", margin: 0 }}>
              No deadlines this day.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {selectedDeadlines.map((dl) => (
                <div key={dl.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    onClick={() => toggleDone(dl.id)}
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "4px",
                      border: doneIds.has(dl.id) ? "none" : "1px solid #444444",
                      backgroundColor: doneIds.has(dl.id) ? "#00F5A0" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      padding: 0,
                    }}
                  >
                    {doneIds.has(dl.id) && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path
                          d="M1 3L3 5L7 1"
                          stroke="#0D0D0D"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                  <span
                    style={{
                      fontSize: "13px",
                      color: doneIds.has(dl.id) ? "#555555" : "#FFFFFF",
                      textDecoration: doneIds.has(dl.id) ? "line-through" : "none",
                    }}
                  >
                    {dl.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {deadlines.length === 0 && (
        <div style={{ marginTop: "16px", textAlign: "center" }}>
          <p style={{ fontSize: "12px", color: "#444444", margin: 0 }}>
            No deadlines yet.{" "}
            <a
              href="https://t.me"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#00F5A0", textDecoration: "none" }}
            >
              Tell Kevo →
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

"use client"

import { useState, useEffect } from "react"
import { TELEGRAM_BOT_URL } from "@/lib/telegram"

type Task = { id: string; title: string }
type WeekDay = { date: string; tasks: Task[] }

interface WeekViewProps {
  weekDays: WeekDay[]
  hasPlan: boolean
  planId: string | null
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

const TODAY = toDateStr(new Date())
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export default function WeekView({ weekDays, hasPlan, planId }: WeekViewProps) {
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())

  // Hydrate completion state from localStorage after mount
  useEffect(() => {
    if (!planId) return
    try {
      const raw = localStorage.getItem(`kevo_plan_done_${planId}`)
      if (raw) setDoneIds(new Set(JSON.parse(raw) as string[]))
    } catch {}
  }, [planId])

  function toggleTask(taskId: string) {
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      if (planId) {
        try {
          localStorage.setItem(`kevo_plan_done_${planId}`, JSON.stringify([...next]))
        } catch {}
      }
      return next
    })
  }

  const noTasks = weekDays.every((d) => d.tasks.length === 0)

  if (!hasPlan || noTasks) {
    return (
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "40px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "15px", fontWeight: 600, color: "#555555", margin: 0 }}>
          No plan yet for this week
        </p>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0, lineHeight: 1.55, maxWidth: "340px" }}>
          Tell Kevo what you&apos;re working on this week and we&apos;ll build a plan together.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "#0D0D0D",
              backgroundColor: "#00F5A0",
              padding: "9px 18px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Open Telegram →
          </a>
          <button
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              padding: "9px 18px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Rebuild this week
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" }}>
      {weekDays.map((day, i) => {
        const isToday = day.date === TODAY
        const isPast = day.date < TODAY && !isToday
        const dayNum = new Date(day.date + "T00:00:00").getDate()

        return (
          <div
            key={day.date}
            style={{
              backgroundColor: isToday ? "#1E1E1E" : "#1A1A1A",
              border: "1px solid #2A2A2A",
              borderTop: isToday ? "2px solid #00F5A0" : "1px solid #2A2A2A",
              borderRadius: "8px",
              padding: "12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              minHeight: "120px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: isToday ? "#00F5A0" : "#555555",
                }}
              >
                {DAY_NAMES[i]}
              </span>
              <span
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  color: isToday ? "#FFFFFF" : "#444444",
                }}
              >
                {dayNum}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {day.tasks.length === 0 ? (
                <div
                  style={{
                    width: "20px",
                    height: "2px",
                    backgroundColor: "#2A2A2A",
                    borderRadius: "1px",
                  }}
                />
              ) : (
                day.tasks.map((task) => {
                  const done = doneIds.has(task.id)
                  return (
                    <button
                      key={task.id}
                      onClick={() => toggleTask(task.id)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "6px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        textAlign: "left",
                      }}
                    >
                      {done ? (
                        <div
                          style={{
                            width: "14px",
                            height: "14px",
                            borderRadius: "3px",
                            backgroundColor: isPast ? "rgba(0, 245, 160, 0.15)" : "#00F5A0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: "1px",
                          }}
                        >
                          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                            <path
                              d="M1 3L3 5L7 1"
                              stroke={isPast ? "#00F5A0" : "#0D0D0D"}
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      ) : (
                        <div
                          style={{
                            width: "14px",
                            height: "14px",
                            borderRadius: "3px",
                            border: "1px solid #444444",
                            backgroundColor: "transparent",
                            flexShrink: 0,
                            marginTop: "1px",
                          }}
                        />
                      )}
                      <span
                        style={{
                          fontSize: "11px",
                          color: done ? "#555555" : "#CCCCCC",
                          lineHeight: 1.4,
                          textDecoration: done ? "line-through" : "none",
                        }}
                      >
                        {task.title}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

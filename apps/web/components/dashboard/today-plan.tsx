"use client"

import { useState } from "react"

interface Task {
  id: string
  title: string
  completed: boolean
}

interface TodayPlanProps {
  tasks: Task[]
}

export default function TodayPlan({ tasks: initial }: TodayPlanProps) {
  const [tasks, setTasks] = useState<Task[]>(initial)

  const toggle = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))

  const done = tasks.filter((t) => t.completed).length

  /* Empty state */
  if (tasks.length === 0) {
    return (
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <p style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 16px" }}>
          Today's Plan
        </p>
        <div
          style={{
            padding: "20px 16px",
            border: "1px dashed #333333",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "14px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "14px", color: "#888888", margin: 0, lineHeight: 1.55 }}>
            No plan yet — tell Kevo what's happening this week
          </p>
          <a
            href="https://t.me"
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
              letterSpacing: "0.02em",
            }}
          >
            Open Telegram →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <p style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>
          Today's Plan
        </p>
        <span style={{ fontSize: "12px", color: "#888888" }}>
          {done}/{tasks.length} done
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {tasks.map((task, i) => (
          <button
            key={task.id}
            onClick={() => toggle(task.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              background: "none",
              border: "none",
              borderBottom: i < tasks.length - 1 ? "1px solid #2A2A2A" : "none",
              cursor: "pointer",
              padding: "11px 0",
              textAlign: "left",
            }}
          >
            {/* Custom checkbox */}
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "4px",
                border: task.completed ? "none" : "1px solid #444444",
                backgroundColor: task.completed ? "#00F5A0" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background-color 0.15s ease",
              }}
            >
              {task.completed && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path
                    d="M1 4L3.5 6.5L9 1"
                    stroke="#0D0D0D"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <span
              style={{
                fontSize: "14px",
                color: task.completed ? "#555555" : "#FFFFFF",
                textDecoration: task.completed ? "line-through" : "none",
                transition: "color 0.15s ease",
                lineHeight: 1.4,
              }}
            >
              {task.title}
            </span>
          </button>
        ))}
      </div>

      <a
        href="/dashboard/plan"
        style={{
          display: "inline-block",
          marginTop: "16px",
          fontSize: "13px",
          fontWeight: 600,
          color: "#00F5A0",
          textDecoration: "none",
        }}
      >
        View full week →
      </a>
    </div>
  )
}

"use client"

import { useState } from "react"
import { Pencil, Lock } from "lucide-react"

const CATEGORY_LABELS: Record<string, string> = {
  fitness: "Fitness",
  study: "Study",
  work: "Work",
  life: "Life",
  general: "Goal",
}

interface GoalCardProps {
  goal: string | null
  category: string | null
  isLocked?: boolean
  daysTotal?: number
  daysRemaining?: number
}

export default function GoalCard({
  goal,
  category,
  isLocked = false,
  daysTotal = 30,
  daysRemaining = 30,
}: GoalCardProps) {
  const [completed, setCompleted] = useState(false)
  const progressPercent = Math.round(Math.max(0, Math.min(1, (daysTotal - daysRemaining) / daysTotal)) * 100)
  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : "Goal"

  /* No goal set */
  if (!goal) {
    return (
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px dashed #333333",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <p style={{ fontSize: "15px", fontWeight: 600, color: "#555555", margin: 0 }}>
          No active goal
        </p>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0, lineHeight: 1.55 }}>
          Tell Kevo what you're working on this month and we'll track it together.
        </p>
        <a
          href="https://t.me"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
        >
          Set a goal on Telegram →
        </a>
      </div>
    )
  }

  /* Locked — upgrade required */
  if (isLocked) {
    return (
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          opacity: 0.55,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Lock size={13} color="#888888" />
          <span style={{ fontSize: "12px", color: "#888888" }}>Pro goal</span>
        </div>
        <p style={{ fontSize: "14px", color: "#888888", margin: 0, lineHeight: 1.5 }}>
          {goal}
        </p>
        <a
          href="/upgrade"
          style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
        >
          Upgrade →
        </a>
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
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        opacity: completed ? 0.55 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#00F5A0",
              backgroundColor: "rgba(0, 245, 160, 0.08)",
              padding: "3px 8px",
              borderRadius: "4px",
              marginBottom: "10px",
            }}
          >
            {categoryLabel}
          </span>
          <p
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#FFFFFF",
              margin: 0,
              lineHeight: 1.45,
              textDecoration: completed ? "line-through" : "none",
            }}
          >
            {goal}
          </p>
        </div>
        <button
          aria-label="Edit goal"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px",
            color: "#555555",
            flexShrink: 0,
            marginTop: "2px",
          }}
        >
          <Pencil size={13} />
        </button>
      </div>

      {/* Days remaining */}
      <p style={{ fontSize: "12px", color: "#888888", margin: 0 }}>
        {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining
      </p>

      {/* Progress bar */}
      <div
        style={{
          height: "4px",
          backgroundColor: "#2A2A2A",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPercent}%`,
            backgroundColor: "#00F5A0",
            borderRadius: "2px",
            transition: "width 0.8s ease",
          }}
        />
      </div>

      {/* CTA */}
      {!completed ? (
        <button
          onClick={() => setCompleted(true)}
          style={{
            alignSelf: "flex-start",
            fontSize: "12px",
            fontWeight: 600,
            color: "#FFFFFF",
            backgroundColor: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            padding: "7px 14px",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Mark complete
        </button>
      ) : (
        <p style={{ fontSize: "12px", color: "#00F5A0", margin: 0 }}>
          ✓ Marked complete — tell Kevo to set a new one
        </p>
      )}
    </div>
  )
}

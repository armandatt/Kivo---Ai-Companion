"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import CompleteModal from "./complete-modal"
import { TELEGRAM_BOT_URL } from "@/lib/telegram"

const CATEGORY_LABELS: Record<string, string> = {
  fitness: "Fitness",
  study: "Study",
  work: "Work",
  life: "Life",
  general: "Goal",
}

interface GoalItem {
  id: string
  title: string
  category: string | null
  daysTotal: number | null
  daysRemaining: number | null
  status: "active" | "paused" | "completed" | "closed"
  createdAt: string
  source?: "web" | "telegram"
}

interface GoalListProps {
  goals: GoalItem[]
  tier: string
}

function GoalCardItem({
  goal,
  onComplete,
}: {
  goal: GoalItem
  onComplete: (id: string, title: string) => void
}) {
  const progress =
    goal.daysTotal && goal.daysRemaining != null
      ? Math.round(Math.max(0, Math.min(1, (goal.daysTotal - goal.daysRemaining) / goal.daysTotal)) * 100)
      : 0
  const categoryLabel = goal.category
    ? (CATEGORY_LABELS[goal.category] ?? goal.category)
    : "Goal"

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
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
              marginBottom: "12px",
            }}
          >
            {categoryLabel}
          </span>
          <p
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "#FFFFFF",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {goal.title}
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
          }}
        >
          <Pencil size={14} />
        </button>
      </div>

      {goal.daysRemaining != null && (
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          {goal.daysRemaining} day{goal.daysRemaining !== 1 ? "s" : ""} remaining
        </p>
      )}

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
            width: `${progress}%`,
            backgroundColor: "#00F5A0",
            borderRadius: "2px",
            transition: "width 0.8s ease",
          }}
        />
      </div>

      <button
        onClick={() => onComplete(goal.id, goal.title)}
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
    </div>
  )
}

function LockedGoalCard() {
  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
        opacity: 0.55,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
        Track multiple goals simultaneously
      </p>
      <a
        href="/upgrade"
        style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
      >
        Unlock unlimited goals →
      </a>
    </div>
  )
}

export default function GoalList({ goals, tier }: GoalListProps) {
  const [pendingComplete, setPendingComplete] = useState<{ id: string; title: string } | null>(null)
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set())

  const visible = goals.filter((g) => !archivedIds.has(g.id))
  const isPro = tier === "pro"

  function handleComplete(id: string, title: string) {
    setPendingComplete({ id, title })
  }

  function handleConfirm() {
    if (pendingComplete) {
      setArchivedIds((prev) => new Set(prev).add(pendingComplete.id))
    }
    setPendingComplete(null)
  }

  if (!visible.length && !isPro) {
    return (
      <>
        <div
          style={{
            backgroundColor: "#1A1A1A",
            border: "1px dashed #333333",
            borderRadius: "12px",
            padding: "32px 24px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <p style={{ fontSize: "16px", fontWeight: 600, color: "#555555", margin: 0 }}>
            No active goal
          </p>
          <p style={{ fontSize: "13px", color: "#888888", margin: 0, lineHeight: 1.55 }}>
            Tell Kevo what you&apos;re working on this month and we&apos;ll track it together.
          </p>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
          >
            Set a goal on Telegram →
          </a>
        </div>
        <CompleteModal
          isOpen={false}
          goalTitle=""
          onConfirm={handleConfirm}
          onClose={() => setPendingComplete(null)}
        />
      </>
    )
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {visible.map((goal) => (
          <GoalCardItem key={goal.id} goal={goal} onComplete={handleComplete} />
        ))}

        {!isPro && <LockedGoalCard />}

        <p style={{ fontSize: "13px", color: "#888888", margin: "4px 0 0" }}>
          Set new goals by{" "}
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#00F5A0", textDecoration: "none", fontWeight: 600 }}
          >
            messaging Kevo →
          </a>
        </p>
      </div>

      <CompleteModal
        isOpen={!!pendingComplete}
        goalTitle={pendingComplete?.title ?? ""}
        onConfirm={handleConfirm}
        onClose={() => setPendingComplete(null)}
      />
    </>
  )
}

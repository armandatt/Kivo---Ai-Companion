"use client"

import { useState } from "react"

interface DeadlineItem {
  id: string
  title: string
  dueAt: string
  status: "active" | "completed" | "overdue"
}

type SortKey = "dueDate" | "category" | "created"

interface TaskListProps {
  deadlines: DeadlineItem[]
}

function formatDue(dueAt: string): { label: string; overdue: boolean; soon: boolean } {
  const diff = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000)
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, overdue: true, soon: false }
  if (diff === 0) return { label: "Today", overdue: false, soon: true }
  if (diff === 1) return { label: "Tomorrow", overdue: false, soon: true }
  if (diff <= 3) return { label: `${diff}d`, overdue: false, soon: true }
  if (diff <= 7) return { label: `${diff}d`, overdue: false, soon: false }
  return {
    label: new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    overdue: false,
    soon: false,
  }
}

const SORT_TABS: { key: SortKey; label: string }[] = [
  { key: "dueDate", label: "Due Date" },
  { key: "category", label: "Category" },
  { key: "created", label: "Created" },
]

export default function TaskList({ deadlines }: TaskListProps) {
  const [sort, setSort] = useState<SortKey>("dueDate")
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterSoon, setFilterSoon] = useState(false)

  function toggleDone(id: string) {
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sorted = [...deadlines].sort((a, b) => {
    if (sort === "dueDate") {
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    }
    return 0
  })

  const filtered = sorted.filter((d) => {
    const diff = Math.ceil((new Date(d.dueAt).getTime() - Date.now()) / 86400000)
    if (filterOverdue) return diff < 0
    if (filterSoon) return diff >= 0 && diff <= 3
    return true
  })

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Sort tabs */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
        {SORT_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            style={{
              fontSize: "12px",
              fontWeight: sort === key ? 600 : 400,
              color: sort === key ? "#0D0D0D" : "#888888",
              backgroundColor: sort === key ? "#00F5A0" : "transparent",
              border: sort === key ? "1px solid #00F5A0" : "1px solid #333333",
              padding: "4px 12px",
              borderRadius: "20px",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button
          onClick={() => { setFilterOverdue((p) => !p); setFilterSoon(false) }}
          style={{
            fontSize: "11px",
            fontWeight: filterOverdue ? 600 : 400,
            color: filterOverdue ? "#0D0D0D" : "#888888",
            backgroundColor: filterOverdue ? "#F59E0B" : "transparent",
            border: filterOverdue ? "1px solid #F59E0B" : "1px solid #333333",
            padding: "3px 10px",
            borderRadius: "20px",
            cursor: "pointer",
          }}
        >
          Overdue
        </button>
        <button
          onClick={() => { setFilterSoon((p) => !p); setFilterOverdue(false) }}
          style={{
            fontSize: "11px",
            fontWeight: filterSoon ? 600 : 400,
            color: filterSoon ? "#0D0D0D" : "#888888",
            backgroundColor: filterSoon ? "#00F5A0" : "transparent",
            border: filterSoon ? "1px solid #00F5A0" : "1px solid #333333",
            padding: "3px 10px",
            borderRadius: "20px",
            cursor: "pointer",
          }}
        >
          Due Soon
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <p style={{ fontSize: "13px", color: "#444444", margin: 0 }}>
            {deadlines.length === 0
              ? "No deadlines yet — tell Kevo what's coming up."
              : "No deadlines match this filter."}
          </p>
          {deadlines.length === 0 && (
            <a
              href="https://t.me"
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                marginTop: "10px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#00F5A0",
                textDecoration: "none",
              }}
            >
              Open Telegram →
            </a>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {filtered.map((dl, i) => {
            const { label, overdue, soon } = formatDue(dl.dueAt)
            const isDone = doneIds.has(dl.id)

            return (
              <div
                key={dl.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "11px 0",
                  borderBottom: i < filtered.length - 1 ? "1px solid #2A2A2A" : "none",
                }}
              >
                <button
                  onClick={() => toggleDone(dl.id)}
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "4px",
                    border: isDone ? "none" : "1px solid #444444",
                    backgroundColor: isDone ? "#00F5A0" : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  {isDone && (
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
                    flex: 1,
                    fontSize: "13px",
                    color: isDone ? "#555555" : "#FFFFFF",
                    textDecoration: isDone ? "line-through" : "none",
                  }}
                >
                  {dl.title}
                </span>

                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: isDone ? "#555555" : overdue ? "#EF4444" : soon ? "#F59E0B" : "#888888",
                    backgroundColor: isDone
                      ? "transparent"
                      : overdue
                      ? "rgba(239, 68, 68, 0.08)"
                      : soon
                      ? "rgba(245, 158, 11, 0.08)"
                      : "transparent",
                    border: isDone
                      ? "none"
                      : overdue
                      ? "1px solid rgba(239, 68, 68, 0.2)"
                      : soon
                      ? "1px solid rgba(245, 158, 11, 0.2)"
                      : "none",
                    padding: overdue || soon ? "2px 6px" : "0",
                    borderRadius: "4px",
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

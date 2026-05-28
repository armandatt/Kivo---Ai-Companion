"use client"

import { useState } from "react"

interface ArchiveItem {
  id: string
  title: string
  category: string | null
  status: "completed" | "closed"
  completedAt: string | null
  daysTaken: number | null
  createdAt: string
}

interface GoalArchiveProps {
  archive: ArchiveItem[]
}

export default function GoalArchive({ archive }: GoalArchiveProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded((p) => !p)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontSize: "13px",
          color: "#888888",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span>View history ({archive.length})</span>
        <span
          style={{
            fontSize: "10px",
            display: "inline-block",
            transition: "transform 0.15s ease",
            transform: expanded ? "rotate(180deg)" : "none",
          }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: "12px",
            backgroundColor: "#1A1A1A",
            border: "1px solid #2A2A2A",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          {archive.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center" }}>
              <p style={{ fontSize: "13px", color: "#555555", margin: 0 }}>No archived goals yet.</p>
            </div>
          ) : (
            archive.map((item, i) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  borderBottom: i < archive.length - 1 ? "1px solid #2A2A2A" : "none",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                  {item.status === "completed" ? (
                    <div
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(0, 245, 160, 0.1)",
                        border: "1px solid rgba(0, 245, 160, 0.3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path
                          d="M1 3L3 5L7 1"
                          stroke="#00F5A0"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  ) : (
                    <div
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        backgroundColor: "#2A2A2A",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: "13px",
                      color: "#888888",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  {item.completedAt && (
                    <span style={{ fontSize: "12px", color: "#555555" }}>
                      {new Date(item.completedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                  {item.status === "completed" && item.daysTaken !== null ? (
                    <span style={{ fontSize: "12px", color: "#555555" }}>{item.daysTaken}d</span>
                  ) : item.status === "closed" ? (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#555555",
                        backgroundColor: "#222222",
                        padding: "2px 8px",
                        borderRadius: "4px",
                      }}
                    >
                      Closed
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

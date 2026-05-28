"use client"

import { useState } from "react"

interface CreatureLog {
  id: string
  text: string
  createdAt: string
}

interface CreatureLogFeedProps {
  logs: CreatureLog[]
  creatureName: string
}

function highlightName(text: string, name: string): React.ReactNode[] {
  if (!name || name === "Your Creature") return [text]
  const regex = new RegExp(`(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} style={{ color: "#00F5A0" }}>
        {part}
      </span>
    ) : (
      part
    )
  )
}

export default function CreatureLogFeed({ logs, creatureName }: CreatureLogFeedProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const displayName = creatureName !== "Your Creature" ? creatureName : "your creature"

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 16px" }}>
        Log
      </p>

      {logs.length === 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "#444444",
            textAlign: "center",
            padding: "20px 0",
            lineHeight: 1.55,
          }}
        >
          Kevo will mention {displayName} in messages as you build momentum.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {logs.map((log, i) => {
            const isExpanded = expandedId === log.id
            const text = log.text
            const preview = text.length > 100 ? text.slice(0, 100) + "…" : text

            return (
              <button
                key={log.id}
                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "4px",
                  padding: "12px 0",
                  borderBottom: i < logs.length - 1 ? "1px solid #2A2A2A" : "none",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span style={{ fontSize: "11px", color: "#888888" }}>
                  {new Date(log.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span style={{ fontSize: "13px", color: "#CCCCCC", lineHeight: 1.5 }}>
                  {highlightName(isExpanded ? text : preview, creatureName)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

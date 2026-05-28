"use client"

import { useState } from "react"

const STAGES = [
  { key: "egg", label: "Egg", emoji: "🥚", day: "Day 1" },
  { key: "hatchling", label: "Hatchling", emoji: "🐣", day: "Day 3" },
  { key: "creature", label: "Creature", emoji: "🦎", day: "Day 7" },
  { key: "beast", label: "Beast", emoji: "🐲", day: "Day 21" },
  { key: "legend", label: "Legend", emoji: "🐉", day: "Day 50" },
]

const STAGE_ORDER = ["egg", "hatchling", "creature", "beast", "legend"]

interface EvolutionEvent {
  stage: string
  reachedAt: string
  message?: string
}

interface EvolutionTimelineProps {
  stage: string
  history: EvolutionEvent[]
}

export default function EvolutionTimeline({ stage, history }: EvolutionTimelineProps) {
  const [activePopover, setActivePopover] = useState<string | null>(null)
  const currentIndex = Math.max(0, STAGE_ORDER.indexOf(stage))

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 24px" }}>
        Evolution
      </p>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
        }}
      >
        {/* Track line */}
        <div
          style={{
            position: "absolute",
            left: "16px",
            right: "16px",
            height: "1px",
            backgroundColor: "#2A2A2A",
            top: "50%",
            transform: "translateY(-16px)",
            zIndex: 0,
          }}
        />

        {STAGES.map((s, i) => {
          const isPast = i < currentIndex
          const isCurrent = i === currentIndex
          const isFuture = i > currentIndex
          const historyEntry = history.find((h) => h.stage === s.key)
          const isPopoverOpen = activePopover === s.key

          return (
            <div
              key={s.key}
              style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <button
                onClick={() => {
                  if (isPast && historyEntry) {
                    setActivePopover(isPopoverOpen ? null : s.key)
                  }
                }}
                style={{
                  width: isCurrent ? "56px" : "42px",
                  height: isCurrent ? "56px" : "42px",
                  borderRadius: "50%",
                  backgroundColor: "#111111",
                  border: isCurrent
                    ? "2px solid #00F5A0"
                    : isPast
                    ? "1px solid #333333"
                    : "1px solid #222222",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isCurrent ? "30px" : "22px",
                  cursor: isPast && historyEntry ? "pointer" : "default",
                  opacity: isFuture ? 0.2 : 1,
                  boxShadow: isCurrent ? "0 0 18px rgba(0, 245, 160, 0.2)" : "none",
                  padding: 0,
                  transition: "box-shadow 0.2s",
                }}
              >
                {s.emoji}
              </button>

              <span
                style={{
                  fontSize: "10px",
                  color: isCurrent ? "#00F5A0" : isPast ? "#555555" : "#333333",
                  fontWeight: isCurrent ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {isCurrent ? s.label : s.day}
              </span>

              {/* Popover */}
              {isPopoverOpen && historyEntry && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 10px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    backgroundColor: "#111111",
                    border: "1px solid #2A2A2A",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    minWidth: "160px",
                    zIndex: 10,
                    boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
                  }}
                >
                  <p style={{ fontSize: "11px", color: "#888888", margin: "0 0 4px" }}>
                    {new Date(historyEntry.reachedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p style={{ fontSize: "12px", color: "#CCCCCC", margin: 0, lineHeight: 1.4 }}>
                    {historyEntry.message ?? `Evolved to ${s.label}`}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

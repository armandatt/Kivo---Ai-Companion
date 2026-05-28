"use client"

import { useState } from "react"

const MOOD_CONFIG: Record<string, { color: string; label: string }> = {
  motivated: { color: "#00F5A0", label: "Motivated" },
  neutral: { color: "#F59E0B", label: "Neutral" },
  calm: { color: "#60A5FA", label: "Calm" },
  stressed: { color: "#EF4444", label: "Stressed" },
  no_data: { color: "#2A2A2A", label: "No data" },
}

function getDayLabel(dateStr: string, index: number): string {
  if (!dateStr) return ["M", "T", "W", "T", "F", "S", "S"][index] ?? "—"
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1)
}

interface MoodEntry {
  date: string
  mood: string
}

interface MoodRingProps {
  entries: MoodEntry[]
}

export default function MoodRing({ entries }: MoodRingProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  const normalized: MoodEntry[] = Array.from({ length: 7 }, (_, i) =>
    entries[i] ?? { date: "", mood: "no_data" }
  )

  const hoveredCfg = hovered !== null
    ? MOOD_CONFIG[normalized[hovered].mood] ?? MOOD_CONFIG.no_data
    : null

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#888888",
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          7-Day Mood
        </p>
        {hoveredCfg && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: hoveredCfg.color,
              backgroundColor: `${hoveredCfg.color}14`,
              padding: "3px 8px",
              borderRadius: "4px",
              transition: "all 0.15s ease",
            }}
          >
            {hoveredCfg.label}
          </span>
        )}
      </div>

      {/* Bar dots */}
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", height: "40px" }}>
        {normalized.map((entry, i) => {
          const cfg = MOOD_CONFIG[entry.mood] ?? MOOD_CONFIG.no_data
          const isHovered = hovered === i
          const hasData = entry.mood !== "no_data"
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                height: "100%",
                justifyContent: "flex-end",
              }}
            >
              <div
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  width: "100%",
                  height: isHovered ? "26px" : hasData ? "18px" : "8px",
                  borderRadius: "3px",
                  backgroundColor: cfg.color,
                  cursor: hasData ? "pointer" : "default",
                  transition: "height 0.15s ease, box-shadow 0.15s ease",
                  boxShadow: isHovered && hasData ? `0 0 10px ${cfg.color}55` : "none",
                }}
              />
            </div>
          )
        })}
      </div>

      {/* Day labels */}
      <div style={{ display: "flex", gap: "8px" }}>
        {normalized.map((entry, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: "10px", color: "#555555" }}>
              {getDayLabel(entry.date, i)}
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {Object.entries(MOOD_CONFIG)
          .filter(([k]) => k !== "no_data")
          .map(([k, cfg]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  backgroundColor: cfg.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: "10px", color: "#555555" }}>{cfg.label}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

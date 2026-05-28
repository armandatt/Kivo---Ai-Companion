"use client"

interface HeatmapDay {
  date: string
  level: "high" | "medium" | "low" | "skip" | "none"
}

interface StreakHeatmapProps {
  days: HeatmapDay[]
  currentStreak: number
  longestStreak: number
  totalDays: number
}

const LEVEL_COLORS: Record<string, string> = {
  high: "#00F5A0",
  medium: "rgba(0, 245, 160, 0.45)",
  low: "rgba(0, 245, 160, 0.2)",
  skip: "rgba(245, 158, 11, 0.45)",
  none: "#2A2A2A",
}

const DAY_LABELS = ["Mo", "", "We", "", "Fr", "", "Su"]

export default function StreakHeatmap({ days, currentStreak, longestStreak, totalDays }: StreakHeatmapProps) {
  const firstDate = days.length > 0 ? new Date(days[0].date + "T00:00:00") : new Date()
  const startOffset = (firstDate.getDay() + 6) % 7

  const padded: (HeatmapDay | null)[] = [...Array(startOffset).fill(null), ...days]
  while (padded.length % 7 !== 0) padded.push(null)
  const numCols = padded.length / 7

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      {/* Stats */}
      <div style={{ display: "flex", gap: "32px", marginBottom: "20px" }}>
        {[
          { label: "Current Streak", value: `${currentStreak}d` },
          { label: "Longest Streak", value: `${longestStreak}d` },
          { label: "Total Days", value: String(totalDays) },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: "26px", fontWeight: 700, color: "#FFFFFF", lineHeight: 1 }}>
              {value}
            </span>
            <span style={{ fontSize: "11px", color: "#888888" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: "flex", gap: "4px", alignItems: "flex-start" }}>
        {/* Day name labels */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginRight: "4px" }}>
          {DAY_LABELS.map((label, i) => (
            <div key={i} style={{ width: "16px", height: "12px", display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: "9px", color: "#444444", lineHeight: 1 }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Week columns */}
        <div style={{ display: "flex", gap: "2px" }}>
          {Array.from({ length: numCols }, (_, ci) => (
            <div key={ci} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {Array.from({ length: 7 }, (_, ri) => {
                const cell = padded[ci * 7 + ri]
                return (
                  <div
                    key={ri}
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "2px",
                      backgroundColor: cell ? LEVEL_COLORS[cell.level] : "transparent",
                    }}
                    title={cell?.date}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginTop: "12px",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "10px", color: "#444444" }}>Less</span>
        {(["none", "low", "medium", "high"] as const).map((level) => (
          <div
            key={level}
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "2px",
              backgroundColor: LEVEL_COLORS[level],
            }}
          />
        ))}
        <span style={{ fontSize: "10px", color: "#444444" }}>More</span>
        <div style={{ width: "1px", height: "12px", backgroundColor: "#333333", margin: "0 4px" }} />
        <div style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: LEVEL_COLORS["skip"] }} />
        <span style={{ fontSize: "10px", color: "#888888" }}>Skip</span>
      </div>
    </div>
  )
}

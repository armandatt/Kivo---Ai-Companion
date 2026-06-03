import type { GymData } from "@/types/gym"

interface Props { gym: GymData }

export default function WeekSplit({ gym }: Props) {
  const gymAway = (() => {
    if (gym.minutesUntilGym === null) return null
    const m = gym.minutesUntilGym
    if (m < 0) return `${Math.abs(Math.round(m / 60))}h ago`
    if (m < 60) return `${m}m away`
    const h = Math.round(m / 60)
    return `${h}h away`
  })()

  return (
    <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        This Week's Split
      </p>

      {/* Day chips */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
        {gym.splitDays.map(({ dayName, muscles, isRest, isToday, isCompleted }) => {
          const bg = isCompleted
            ? "rgba(0,245,160,0.12)"
            : isToday && !isRest
            ? "rgba(0,245,160,0.08)"
            : "transparent"
          const border = isCompleted
            ? "1px solid rgba(0,245,160,0.4)"
            : isToday && !isRest
            ? "1px solid #00F5A0"
            : "1px solid #2A2A2A"
          const labelColor = isCompleted || (isToday && !isRest) ? "#FFFFFF" : isRest ? "#333" : "#666"
          const muscleColor = isCompleted ? "#00F5A0" : isToday && !isRest ? "#FFFFFF" : isRest ? "#333" : "#555"

          return (
            <div
              key={dayName}
              style={{
                backgroundColor: bg,
                border,
                borderRadius: "8px",
                padding: "8px 12px",
                minWidth: "64px",
                textAlign: "center",
              }}
            >
              <p style={{ fontSize: "11px", fontWeight: 600, color: labelColor, margin: "0 0 3px", textTransform: "uppercase" }}>
                {dayName}
              </p>
              <p style={{ fontSize: "11px", color: muscleColor, margin: 0, whiteSpace: "nowrap" }}>
                {isRest ? "Rest" : muscles}
              </p>
            </div>
          )
        })}
      </div>

      {/* Today line */}
      {gym.todayMuscles && (
        <p style={{ fontSize: "13px", color: "#888", margin: 0 }}>
          <span style={{ color: "#FFFFFF", fontWeight: 600 }}>Today: {gym.todayMuscles}</span>
          {gym.gymTimeStr && (
            <> &middot; Gym at {gym.gymTimeStr}{gymAway && <> &middot; <span style={{ color: "#00F5A0" }}>{gymAway}</span></>}</>
          )}
        </p>
      )}
      {!gym.todayMuscles && (
        <p style={{ fontSize: "13px", color: "#555", margin: 0 }}>Rest day — recover well.</p>
      )}
    </div>
  )
}

import type { GymData } from "@/types/gym"

interface Props { gym: GymData }

export default function LiftProgress({ gym }: Props) {
  if (!gym.mainLifts.length) {
    return (
      <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Lift Progress
        </p>
        <p style={{ fontSize: "13px", color: "#555" }}>No lifts logged yet. Start a session to track progress.</p>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Lift Progress
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {gym.mainLifts.map(({ exercise, currentKg, deltaKg, isPR, trend }) => {
          const deltaColor = deltaKg > 0 ? "#00F5A0" : deltaKg < 0 ? "#EF4444" : "#555"
          const deltaStr   = deltaKg > 0 ? `+${deltaKg}` : deltaKg < 0 ? `${deltaKg}` : "—"

          // Mini sparkline
          const min    = Math.min(...trend)
          const max    = Math.max(...trend)
          const span   = max - min || 1
          const BAR_W  = 200

          return (
            <div key={exercise}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ fontSize: "14px", color: "#CCCCCC", flex: 1, fontWeight: 500 }}>{exercise}</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF" }}>{currentKg} kg</span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: deltaColor, minWidth: "36px", textAlign: "right" }}>
                  {deltaStr}
                </span>
                {isPR && (
                  <span style={{
                    fontSize: "10px", fontWeight: 700, backgroundColor: "rgba(0,245,160,0.15)",
                    color: "#00F5A0", border: "1px solid rgba(0,245,160,0.4)",
                    padding: "1px 6px", borderRadius: "4px",
                  }}>
                    PR
                  </span>
                )}
              </div>

              {/* Sparkline */}
              {trend.length > 1 && (
                <div style={{ display: "flex", gap: "3px", alignItems: "flex-end", height: "24px" }}>
                  {trend.map((w, i) => {
                    const pct    = (w - min) / span
                    const height = Math.max(4, Math.round(pct * 20))
                    const isLast = i === trend.length - 1
                    return (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: `${height}px`,
                          backgroundColor: isLast ? "#00F5A0" : "rgba(0,245,160,0.25)",
                          borderRadius: "2px",
                        }}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import type { GymData } from "@/types/gym"

interface Props { gym: GymData }

function getFlagDisplay(flag: string): { icon: string; text: string; color: string } {
  if (flag.startsWith("STALL:")) {
    const ex = flag.replace("STALL: ", "")
    return { icon: "!", text: `${ex} stalling. Add a rep this session.`, color: "#F59E0B" }
  }
  if (flag.startsWith("REGRESSION:")) {
    const ex = flag.replace("REGRESSION: ", "")
    return { icon: "!", text: `${ex} dropped 2 sessions. Sleep or stress?`, color: "#EF4444" }
  }
  if (flag === "LOW_CONSISTENCY") {
    return { icon: "!", text: "Consistency slipping. What's blocking training?", color: "#F59E0B" }
  }
  if (flag === "OVERREACHING") {
    return { icon: "!", text: "RPE too high. Cut 15% this session.", color: "#EF4444" }
  }
  if (flag.startsWith("MUSCLE_AVOIDANCE:")) {
    const m = flag.replace("MUSCLE_AVOIDANCE: ", "")
    return { icon: "!", text: `${m} untrained 10+ days. Fix this week.`, color: "#F59E0B" }
  }
  if (flag.startsWith("LOW_VOLUME:")) {
    const m = flag.replace("LOW_VOLUME: ", "")
    return { icon: "!", text: `${m} volume low. Add a set next session.`, color: "#F59E0B" }
  }
  if (flag.startsWith("PROGRESSING:")) {
    const rest = flag.replace("PROGRESSING: ", "")
    return { icon: "✓", text: `${rest} next session.`, color: "#00F5A0" }
  }
  if (flag.startsWith("STREAK:")) {
    return { icon: "✓", text: flag.replace("STREAK: ", ""), color: "#00F5A0" }
  }
  if (flag.includes("streak") || flag.includes("Don't break")) {
    return { icon: "✓", text: flag, color: "#00F5A0" }
  }
  return { icon: "·", text: flag, color: "#555" }
}

export default function RexFlags({ gym }: Props) {
  const visible = gym.flags.slice(0, 5)

  return (
    <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Rex's Flags
      </p>

      {visible.length === 0 ? (
        <p style={{ fontSize: "13px", color: "#555" }}>No flags yet. Keep training.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {visible.map((flag, i) => {
            const { icon, text, color } = getFlagDisplay(flag)
            return (
              <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    backgroundColor: color === "#00F5A0" ? "rgba(0,245,160,0.1)" : color === "#EF4444" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                    border: `1px solid ${color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9px",
                    fontWeight: 900,
                    color,
                    marginTop: "1px",
                  }}
                >
                  {icon}
                </span>
                <span style={{ fontSize: "12px", color: "#AAAAAA", lineHeight: 1.5 }}>{text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

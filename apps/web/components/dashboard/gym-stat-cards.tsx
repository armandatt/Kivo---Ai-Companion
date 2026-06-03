import type { GymData } from "@/types/gym"

interface Props { gym: GymData }

export default function GymStatCards({ gym }: Props) {
  const volFormatted = gym.volumeThisWeekKg >= 1000
    ? `${(gym.volumeThisWeekKg / 1000).toFixed(1).replace(/\.0$/, "")},${String(gym.volumeThisWeekKg % 1000).padStart(3, "0")}`
    : String(gym.volumeThisWeekKg)

  const cards = [
    {
      label: "Streak",
      value: `${gym.streak} 🔥`,
      sub:   "days in a row",
      accent: true,
    },
    {
      label: "This week",
      value: `${gym.sessionsThisWeek} / ${gym.plannedThisWeek}`,
      sub:   "sessions done",
      accent: false,
    },
    {
      label: "Consistency",
      value: `${gym.consistencyScore}%`,
      sub:   "last 4 weeks",
      accent: gym.consistencyScore >= 70,
    },
    {
      label: "Volume",
      value: volFormatted,
      sub:   "kg lifted this week",
      accent: false,
    },
  ]

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
      {cards.map(({ label, value, sub, accent }) => (
        <div
          key={label}
          style={{
            backgroundColor: "#111111",
            border: "1px solid #2A2A2A",
            borderRadius: "10px",
            padding: "20px 20px 16px",
          }}
        >
          <p style={{ fontSize: "11px", fontWeight: 500, color: "#666", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {label}
          </p>
          <p style={{ fontSize: "28px", fontWeight: 700, color: accent ? "#00F5A0" : "#FFFFFF", margin: "0 0 4px", lineHeight: 1 }}>
            {value}
          </p>
          <p style={{ fontSize: "12px", color: "#555", margin: 0 }}>{sub}</p>
        </div>
      ))}
    </div>
  )
}

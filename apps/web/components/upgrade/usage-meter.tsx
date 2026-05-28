"use client"

interface Props {
  used: number
  limit: number
  tier: string
}

export default function UsageMeter({ used, limit, tier }: Props) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const fillColor = pct >= 85 ? "#EF4444" : pct >= 60 ? "#F59E0B" : "#00F5A0"

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: 0 }}>
          Daily usage
        </p>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#888888",
            backgroundColor: "#2A2A2A",
            padding: "3px 10px",
            borderRadius: "20px",
            textTransform: "capitalize" as const,
          }}
        >
          {tier}
        </span>
      </div>

      {/* Track */}
      <div
        style={{
          height: "6px",
          backgroundColor: "#2A2A2A",
          borderRadius: "3px",
          overflow: "hidden",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: fillColor,
            borderRadius: "3px",
            transition: "width 0.4s ease, background-color 0.3s",
          }}
        />
      </div>

      <p style={{ fontSize: "12px", color: "#888888", margin: 0 }}>
        {used} of {limit} messages used today
      </p>
    </div>
  )
}

"use client"

const MOCK_PATTERNS = [
  {
    insight: "You focus best on Tuesday mornings",
    note: "Based on 18 sessions",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="#00F5A0" strokeWidth="1.2" />
        <path d="M8 5v3.5l2 2" stroke="#00F5A0" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    insight: "Workout completion drops when sleep is short",
    note: "Correlation: 0.72",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 8.5C3 5.46 5.46 3 8.5 3a5.49 5.49 0 0 1 4.5 2.35" stroke="#00F5A0" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M13 8.5A4.5 4.5 0 0 1 4 10" stroke="#00F5A0" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="11.5" cy="4.5" r="1" fill="#00F5A0" />
      </svg>
    ),
  },
  {
    insight: "Goal completion peaks after check-ins",
    note: "Based on 8 weeks",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="3" stroke="#00F5A0" strokeWidth="1.2" />
        <path d="M5.5 8l2 2 3.5-3.5" stroke="#00F5A0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export default function BehaviouralPatternCards({ tier }: { tier: string }) {
  const isLocked = tier === "free"

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
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: 0 }}>
          Behavioural Patterns
        </p>
        {isLocked && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#888888",
              backgroundColor: "#111111",
              border: "1px solid #2A2A2A",
              padding: "2px 8px",
              borderRadius: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Pro
          </span>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            filter: isLocked ? "blur(4px)" : "none",
            pointerEvents: isLocked ? "none" : "auto",
          }}
        >
          {MOCK_PATTERNS.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "14px 16px",
                backgroundColor: "#111111",
                border: "1px solid #2A2A2A",
                borderLeft: "3px solid #00F5A0",
                borderRadius: "8px",
              }}
            >
              <div style={{ flexShrink: 0, marginTop: "1px" }}>{p.icon}</div>
              <div>
                <p style={{ fontSize: "13px", color: "#FFFFFF", margin: "0 0 3px" }}>
                  {p.insight}
                </p>
                <p style={{ fontSize: "11px", color: "#888888", margin: 0 }}>{p.note}</p>
              </div>
            </div>
          ))}
        </div>

        {isLocked && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
              Patterns unlock with Pro
            </p>
            <a
              href="/dashboard/settings"
              style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
            >
              Unlock patterns →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

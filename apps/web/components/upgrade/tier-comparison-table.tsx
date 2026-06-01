"use client"

const FEATURES = [
  { label: "Daily check-ins", free: true, pro: true, elite: true },
  { label: "Goal tracking", free: true, pro: true, elite: true },
  { label: "Streak heatmap", free: true, pro: true, elite: true },
  { label: "7-day session history", free: true, pro: true, elite: true },
  { label: "90-day session history", free: false, pro: true, elite: true },
  { label: "Mood trend chart", free: false, pro: true, elite: true },
  { label: "Behavioural patterns", free: false, pro: true, elite: true },
  { label: "Weekly review archive", free: false, pro: true, elite: true },
  { label: "Pro companion personas", free: false, pro: true, elite: true },
  { label: "Multi-platform sync", free: false, pro: false, elite: true },
  { label: "Priority support", free: false, pro: false, elite: true },
  { label: "Custom personas", free: false, pro: false, elite: true },
]

const TIERS = [
  { key: "free", label: "Free", price: null },
  { key: "pro", label: "Pro", price: "₹499/mo" },
  { key: "elite", label: "Elite", price: "₹999/mo" },
]

interface Props {
  currentTier: "free" | "pro" | "elite"
}

export default function TierComparisonTable({ currentTier }: Props) {
  return (
    <div className="kevo-tier-scroll" style={{ borderRadius: "12px" }}>
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        overflow: "hidden",
        minWidth: "600px",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr repeat(3, 160px)",
          borderBottom: "1px solid #2A2A2A",
        }}
      >
        <div style={{ padding: "20px 20px 16px" }} />
        {TIERS.map((tier) => {
          const isCurrent = tier.key === currentTier
          return (
            <div
              key={tier.key}
              style={{
                padding: "20px 12px 16px",
                textAlign: "center" as const,
                borderTop: isCurrent ? "2px solid #00F5A0" : "2px solid transparent",
                position: "relative",
              }}
            >
              <p
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#FFFFFF",
                  margin: "0 0 4px",
                }}
              >
                {tier.label}
              </p>
              <p
                style={{
                  fontSize: "13px",
                  color: "#888888",
                  margin: isCurrent ? "0 0 8px" : "0",
                }}
              >
                {tier.price ?? "Free"}
              </p>
              {isCurrent && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "#00F5A0",
                    backgroundColor: "rgba(0, 245, 160, 0.1)",
                    border: "1px solid rgba(0, 245, 160, 0.2)",
                    padding: "2px 10px",
                    borderRadius: "20px",
                    letterSpacing: "0.04em",
                  }}
                >
                  Current plan
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Feature rows */}
      {FEATURES.map((feature, i) => {
        const bg = i % 2 === 0 ? "#1A1A1A" : "#161616"
        return (
          <div
            key={feature.label}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr repeat(3, 160px)",
              backgroundColor: bg,
            }}
          >
            <div style={{ padding: "12px 20px", fontSize: "13px", color: "#CCCCCC" }}>
              {feature.label}
            </div>
            {(["free", "pro", "elite"] as const).map((t) => (
              <div
                key={t}
                style={{
                  padding: "12px",
                  textAlign: "center" as const,
                  fontSize: "14px",
                }}
              >
                {feature[t] ? (
                  <CheckIcon />
                ) : (
                  <span style={{ color: "#444444" }}>—</span>
                )}
              </div>
            ))}
          </div>
        )
      })}

      {/* CTA row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr repeat(3, 160px)",
          borderTop: "1px solid #2A2A2A",
          padding: "16px 0",
        }}
      >
        <div />
        {/* Free — no CTA */}
        <div style={{ padding: "0 12px", textAlign: "center" as const }}>
          {currentTier === "free" && (
            <span style={{ fontSize: "12px", color: "#555555" }}>Current</span>
          )}
        </div>
        {/* Pro */}
        <div style={{ padding: "0 12px" }}>
          {currentTier !== "pro" && currentTier !== "elite" ? (
            <button
              style={{
                width: "100%",
                padding: "10px 0",
                fontSize: "13px",
                fontWeight: 700,
                color: "#0D0D0D",
                backgroundColor: "#00F5A0",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Upgrade to Pro
              <span
                style={{ display: "block", fontSize: "11px", fontWeight: 400, marginTop: "1px" }}
              >
                ₹499/mo
              </span>
            </button>
          ) : currentTier === "pro" ? (
            <span style={{ fontSize: "12px", color: "#555555", display: "block", textAlign: "center" as const }}>
              Current
            </span>
          ) : null}
        </div>
        {/* Elite */}
        <div style={{ padding: "0 12px" }}>
          {currentTier !== "elite" ? (
            <button
              style={{
                width: "100%",
                padding: "10px 0",
                fontSize: "13px",
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: "transparent",
                border: "1px solid #444444",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Upgrade to Elite
              <span
                style={{ display: "block", fontSize: "11px", fontWeight: 400, marginTop: "1px", color: "#888888" }}
              >
                ₹999/mo
              </span>
            </button>
          ) : (
            <span style={{ fontSize: "12px", color: "#555555", display: "block", textAlign: "center" as const }}>
              Current
            </span>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#00F5A0"
      strokeWidth="2.5"
      style={{ display: "inline-block" }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

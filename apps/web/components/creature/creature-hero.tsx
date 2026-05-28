"use client"

const STAGE_EMOJI: Record<string, string> = {
  egg: "🥚",
  hatchling: "🐣",
  creature: "🦎",
  beast: "🐲",
  legend: "🐉",
}

interface CreatureHeroProps {
  creature: {
    name: string
    type: string | null
    color: string | null
    stage: string
    currentStreak: number
    evolutionAvailable: boolean
    state: string
  }
}

export default function CreatureHero({ creature }: CreatureHeroProps) {
  const glowColor = creature.color ?? "#00F5A0"
  const emoji = STAGE_EMOJI[creature.stage] ?? "🥚"

  return (
    <>
      <style>{`
        @keyframes kevo-hero-pulse {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.08); }
        }
        .kevo-hero-pulse-ring {
          animation: kevo-hero-pulse 2s ease-in-out infinite;
        }
        @keyframes kevo-hero-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.025); }
        }
        .kevo-hero-breathe {
          animation: kevo-hero-breathe 4s ease-in-out infinite;
        }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "40px 0 20px",
        }}
      >
        {/* Creature circle */}
        <div
          style={{ position: "relative", width: "220px", height: "220px", marginBottom: "28px" }}
        >
          {creature.evolutionAvailable && (
            <div
              className="kevo-hero-pulse-ring"
              style={{
                position: "absolute",
                inset: "-10px",
                borderRadius: "50%",
                border: "2px solid #00F5A0",
                pointerEvents: "none",
              }}
            />
          )}
          <div
            className="kevo-hero-breathe"
            style={{
              width: "220px",
              height: "220px",
              borderRadius: "50%",
              backgroundColor: "#111111",
              border: "1px solid #2A2A2A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "104px",
              boxShadow: `0 0 70px ${glowColor}14`,
            }}
          >
            {emoji}
          </div>
        </div>

        {/* Name */}
        <h1
          style={{
            fontSize: "40px",
            fontWeight: 700,
            color: "#FFFFFF",
            margin: "0 0 6px",
            textAlign: "center",
          }}
        >
          {creature.name}
        </h1>

        {/* Type */}
        {creature.type && (
          <p
            style={{
              fontSize: "14px",
              color: "#888888",
              margin: "0 0 12px",
              textAlign: "center",
            }}
          >
            {creature.type}
          </p>
        )}

        {/* State */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: creature.state === "active" ? "#00F5A0" : "#888888",
              boxShadow: creature.state === "active" ? "0 0 6px #00F5A0" : "none",
            }}
          />
          <span style={{ fontSize: "13px", color: "#888888" }}>
            {creature.state === "active"
              ? "Active"
              : creature.state === "quiet"
              ? "Quiet"
              : "Resting"}
          </span>
        </div>

        {creature.evolutionAvailable && (
          <div
            style={{
              marginTop: "14px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#00F5A0",
              backgroundColor: "rgba(0, 245, 160, 0.08)",
              border: "1px solid rgba(0, 245, 160, 0.2)",
              padding: "5px 14px",
              borderRadius: "20px",
              letterSpacing: "0.04em",
            }}
          >
            Evolution available ✦
          </div>
        )}
      </div>
    </>
  )
}

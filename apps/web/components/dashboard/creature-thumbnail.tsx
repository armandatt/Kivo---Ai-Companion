"use client"

const CREATURE_EMOJI: Record<string, string> = {
  "1": "🔥",
  "2": "🐉",
  "3": "🐍",
}

const EVOLUTION_THRESHOLDS = [3, 7, 21, 50]

function getStage(streak: number): { emoji: string; label: string; nextAt: number | null } {
  if (streak < 3) return { emoji: "🥚", label: "Egg", nextAt: 3 }
  if (streak < 7) return { emoji: "🐣", label: "Hatchling", nextAt: 7 }
  if (streak < 21) return { emoji: "🦎", label: "Creature", nextAt: 21 }
  if (streak < 50) return { emoji: "🐲", label: "Beast", nextAt: 50 }
  return { emoji: "🐉", label: "Legend", nextAt: null }
}

interface CreatureThumbnailProps {
  creatureType: string | null
  creatureColor: string | null
  creatureName: string | null
  streak: number
}

export default function CreatureThumbnail({
  creatureType,
  creatureColor,
  creatureName,
  streak,
}: CreatureThumbnailProps) {
  const stage = getStage(streak)
  const evolutionAvailable = EVOLUTION_THRESHOLDS.includes(streak)
  const glowColor = creatureColor ?? "#00F5A0"
  const dotColor = streak > 0 ? "#00F5A0" : "#888888"
  const dotLabel = streak > 0 ? "active" : "resting"

  if (!creatureName && !creatureType) {
    return (
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "48px" }}>🥚</span>
        <p style={{ fontSize: "14px", color: "#FFFFFF", margin: 0, fontWeight: 600 }}>
          Companion waiting
        </p>
        <p style={{ fontSize: "12px", color: "#888888", margin: 0 }}>
          Complete onboarding to hatch your creature
        </p>
        <a
          href="/onboarding"
          style={{ fontSize: "13px", color: "#00F5A0", fontWeight: 600, textDecoration: "none" }}
        >
          Complete setup →
        </a>
      </div>
    )
  }

  const displayEmoji = streak >= 7 && creatureType
    ? CREATURE_EMOJI[creatureType] ?? stage.emoji
    : stage.emoji

  return (
    <>
      <style>{`
        @keyframes kevo-pulse-ring {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.07); }
        }
        .kevo-evolution-ring {
          animation: kevo-pulse-ring 1.6s ease-in-out infinite;
        }
      `}</style>
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "14px",
        }}
      >
        {/* Creature circle */}
        <div style={{ position: "relative", width: "100px", height: "100px" }}>
          {evolutionAvailable && (
            <div
              className="kevo-evolution-ring"
              style={{
                position: "absolute",
                inset: "-7px",
                borderRadius: "50%",
                border: "2px solid #00F5A0",
                pointerEvents: "none",
              }}
            />
          )}
          <div
            style={{
              width: "100px",
              height: "100px",
              borderRadius: "50%",
              backgroundColor: "#0D0D0D",
              border: "1px solid #2A2A2A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "52px",
              boxShadow: `0 0 28px ${glowColor}16`,
            }}
          >
            {displayEmoji}
          </div>
        </div>

        {/* Name + stage */}
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 3px" }}>
            {creatureName ?? "Companion"}
          </p>
          <p
            style={{
              fontSize: "10px",
              color: "#888888",
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
            }}
          >
            {stage.label}
          </p>
        </div>

        {/* State dot row */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: dotColor,
              boxShadow: streak > 0 ? `0 0 6px ${dotColor}` : "none",
            }}
          />
          <span style={{ fontSize: "11px", color: "#888888" }}>{dotLabel}</span>
          {stage.nextAt !== null && (
            <span style={{ fontSize: "11px", color: "#555555" }}>
              · evolves day {stage.nextAt}
            </span>
          )}
        </div>

        {evolutionAvailable && (
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "#00F5A0",
              backgroundColor: "rgba(0, 245, 160, 0.08)",
              border: "1px solid rgba(0, 245, 160, 0.2)",
              padding: "4px 10px",
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

import type { GymData } from "@/types/gym"

interface Props { gym: GymData }

export default function NextSessionTargets({ gym }: Props) {
  return (
    <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Next Session Targets
      </p>
      <p style={{ fontSize: "12px", color: "#444", margin: "0 0 16px" }}>
        {gym.nextSessionMuscles}
      </p>

      {gym.nextSessionTargets.length === 0 ? (
        <p style={{ fontSize: "13px", color: "#555" }}>Log a session to get targets.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {gym.nextSessionTargets.map(({ exercise, nextWeightKg, reps, flag }) => {
            const isHold     = flag === "maintain" || flag === "technique_check"
            const isIncrease = flag === "increase"
            const isRepInc   = flag === "rep_increase"
            const isDrop     = nextWeightKg === 0

            const flagColor  = isHold ? "#666" : isIncrease || isRepInc ? "#00F5A0" : "#888"
            const flagText   = isHold ? "hold"
              : isRepInc ? "+1 rep"
              : isIncrease ? `+2.5`
              : isDrop ? "new" : ""

            const weightStr  = nextWeightKg > 0 ? `${nextWeightKg} kg` : "—"

            return (
              <div
                key={exercise}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}
              >
                <span style={{ fontSize: "13px", color: "#CCCCCC", flex: 1 }}>{exercise}</span>
                <span style={{ fontSize: "13px", color: "#FFFFFF", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {weightStr} &times; {reps}
                </span>
                {flagText && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: flagColor,
                      minWidth: "40px",
                      textAlign: "right",
                    }}
                  >
                    {flagText}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

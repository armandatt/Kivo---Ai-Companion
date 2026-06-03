import type { GymData } from "@/types/gym"

interface Props { gym: GymData }

// ── Weekly volume bar chart ────────────────────────────────────────────────────

function VolumeBar({ muscle, sets, target }: { muscle: string; sets: number; target: number }) {
  const pct   = Math.min(100, Math.round((sets / target) * 100))
  const color = pct >= 85 ? "#00F5A0" : pct >= 55 ? "#F59E0B" : "#EF4444"

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <span style={{ fontSize: "12px", color: "#888", width: "90px", flexShrink: 0, textTransform: "capitalize" }}>
        {muscle}
      </span>
      <div style={{ flex: 1, height: "6px", backgroundColor: "#222", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: "3px", transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: "11px", color: pct >= 85 ? "#00F5A0" : pct < 55 ? "#EF4444" : "#F59E0B", width: "40px", textAlign: "right", flexShrink: 0 }}>
        {sets}/{target}
      </span>
    </div>
  )
}

// ── Training heatmap ───────────────────────────────────────────────────────────

function Heatmap({ heatmap, avgRpe, rpeDescription }: {
  heatmap:        GymData["heatmap"]
  avgRpe:         number | null
  rpeDescription: string
}) {
  // 84 days = 12 weeks × 7 days. Display Mon-Sun per column.
  // Reorder: heatmap[0] is 84 days ago. We need Mon-first columns.
  const weeks: typeof heatmap[] = []
  for (let w = 0; w < 12; w++) {
    weeks.push(heatmap.slice(w * 7, (w + 1) * 7))
  }

  const rpeColor = (rpe: number | null) => {
    if (!rpe) return "rgba(0,245,160,0.4)"
    if (rpe >= 9) return "#EF4444"
    if (rpe >= 8) return "#F59E0B"
    return "#00F5A0"
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "3px" }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {week.map((day, di) => (
              <div
                key={di}
                title={`${day.date}${day.trained ? (day.rpe ? ` · RPE ${day.rpe}` : " · trained") : " · rest"}`}
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "2px",
                  backgroundColor: day.trained ? rpeColor(day.rpe) : "#1C1C1C",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "10px" }}>
        <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#00F5A0", display: "inline-block" }} />
        <span style={{ fontSize: "11px", color: "#666" }}>
          {avgRpe !== null ? `avg RPE ${avgRpe} — ${rpeDescription}` : "no RPE data yet"}
        </span>
      </div>
    </div>
  )
}

// ── Combined card ─────────────────────────────────────────────────────────────

export default function VolumeHeatmap({ gym }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
      {/* Volume */}
      <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Weekly Volume by Muscle
        </p>
        {gym.weeklyVolume.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#555" }}>No sessions logged this week.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {gym.weeklyVolume.map(v => (
              <VolumeBar key={v.muscle} {...v} />
            ))}
          </div>
        )}
      </div>

      {/* Heatmap */}
      <div style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#555", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Training Heatmap — 12 Weeks
        </p>
        <div style={{ display: "flex", gap: "3px", fontSize: "10px", color: "#333", marginBottom: "10px" }}>
          {["12w ago", "", "", "", "", "", "", "", "", "", "", "this week"].map((l, i) => (
            <span key={i} style={{ flex: 1, textAlign: i === 0 ? "left" : i === 11 ? "right" : "center", fontSize: "9px", color: "#333" }}>{l}</span>
          ))}
        </div>
        <Heatmap heatmap={gym.heatmap} avgRpe={gym.avgRpe} rpeDescription={gym.rpeDescription} />
      </div>
    </div>
  )
}

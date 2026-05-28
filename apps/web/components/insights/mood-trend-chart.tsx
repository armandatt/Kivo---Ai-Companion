"use client"

interface MoodPoint {
  date: string
  score: number | null
  moodTag: string | null
}

interface MoodTrendChartProps {
  points: MoodPoint[]
  insight: string
}

const W = 600
const H = 120
const PAD = 10

function buildPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length === 1 ? `M ${pts[0][0]} ${pts[0][1]}` : ""
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const dx = (x1 - x0) / 3
    d += ` C ${(x0 + dx).toFixed(1)} ${y0.toFixed(1)}, ${(x1 - dx).toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  return d
}

export default function MoodTrendChart({ points, insight }: MoodTrendChartProps) {
  const n = points.length || 1
  const toX = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD)
  const toY = (score: number) => PAD + (1 - (score - 1) / 9) * (H - 2 * PAD)

  const segments: [number, number][][] = []
  let current: [number, number][] = []

  for (let i = 0; i < points.length; i++) {
    const { score } = points[i]
    if (score !== null) {
      current.push([toX(i), toY(score)])
    } else {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
    }
  }
  if (current.length > 0) segments.push(current)

  const hasData = segments.some((s) => s.length > 0)

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 14px" }}>
        Energy Trend
      </p>

      {hasData ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
            <defs>
              <linearGradient id="mood-gradient-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00F5A0" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#00F5A0" stopOpacity="0" />
              </linearGradient>
            </defs>

            {segments.map((seg, si) => {
              if (seg.length < 2) return null
              const linePath = buildPath(seg)
              const bottomY = H - PAD / 2
              const fillPath = `${linePath} L ${seg[seg.length - 1][0].toFixed(1)} ${bottomY} L ${seg[0][0].toFixed(1)} ${bottomY} Z`
              return (
                <g key={si}>
                  <path d={fillPath} fill="url(#mood-gradient-fill)" stroke="none" />
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#00F5A0"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )
            })}

            {points.map((p, i) =>
              p.score !== null ? (
                <circle
                  key={i}
                  cx={toX(i).toFixed(1)}
                  cy={toY(p.score).toFixed(1)}
                  r="2.5"
                  fill="#00F5A0"
                  opacity="0.8"
                />
              ) : null
            )}
          </svg>

          <p
            style={{
              fontSize: "12px",
              color: "#888888",
              fontStyle: "italic",
              margin: "10px 0 0",
              lineHeight: 1.5,
            }}
          >
            {insight}
          </p>
        </>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 0" }}>
          <p style={{ fontSize: "13px", color: "#444444", margin: 0, textAlign: "center" }}>
            No energy data yet. Log your mood daily with Kevo.
          </p>
        </div>
      )}
    </div>
  )
}

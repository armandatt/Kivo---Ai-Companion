import { cookies } from "next/headers"
import Link from "next/link"

type FocusSession = {
  id:          string
  durationMin: number
  status:      string
  startedAt:   string
  completedAt: string | null
}

type FocusData = {
  sessions:          FocusSession[]
  totalMinutes:      number
  completedCount:    number
  telegramConnected: boolean
  personaName:       string | null
}

async function fetchFocus(): Promise<FocusData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null
    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/focus`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache:   "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function formatDuration(min: number) {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const today     = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString())     return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Group sessions by date label
function groupByDate(sessions: FocusSession[]) {
  const groups: Record<string, FocusSession[]> = {}
  for (const s of sessions) {
    const label = formatDate(s.startedAt)
    if (!groups[label]) groups[label] = []
    groups[label]!.push(s)
  }
  return groups
}

// Sparkline for daily minutes over last 7 days
function Sparkline({ sessions }: { sessions: FocusSession[] }) {
  const days: number[] = Array(7).fill(0)
  const today = new Date()
  for (const s of sessions) {
    if (s.status !== "completed") continue
    const diff = Math.floor((today.getTime() - new Date(s.startedAt).getTime()) / 86400000)
    if (diff < 7) days[6 - diff] = (days[6 - diff] ?? 0) + s.durationMin
  }
  const mx = Math.max(...days, 1)
  const w = 120, h = 32
  const pts = days.map((v, i) => {
    const x = (i / 6) * (w - 6) + 3
    const y = h - 4 - (v / mx) * (h - 10)
    return `${x},${y}`
  }).join(" ")
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke="var(--kv-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {days.map((v, i) => {
        const x = (i / 6) * (w - 6) + 3
        const y = h - 4 - (v / mx) * (h - 10)
        return v > 0 ? <circle key={i} cx={x} cy={y} r="2.5" fill="var(--kv-accent)" /> : null
      })}
    </svg>
  )
}

function CircleProgress({ pct }: { pct: number }) {
  const r    = 28
  const circ = 2 * Math.PI * r
  const dash = Math.min(pct, 100) / 100 * circ
  return (
    <svg width={68} height={68} viewBox="0 0 68 68" style={{ transform: "rotate(-90deg)" }}>
      <circle cx={34} cy={34} r={r} fill="none" stroke="#2A2A2A"        strokeWidth="5" />
      <circle cx={34} cy={34} r={r} fill="none" stroke="var(--kv-accent)" strokeWidth="5"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
    </svg>
  )
}

export default async function FocusPage() {
  const data             = await fetchFocus()
  const sessions         = data?.sessions         ?? []
  const totalMinutes     = data?.totalMinutes      ?? 0
  const completedCount   = data?.completedCount    ?? 0
  const telegramConnected = data?.telegramConnected ?? false
  const personaName      = data?.personaName       ?? "Nova"

  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME ?? ""
  const deeplink    = botUsername ? `https://t.me/${botUsername}` : null

  const totalHours     = totalMinutes / 60
  const avgMin         = completedCount > 0 ? Math.round(totalMinutes / completedCount) : 0
  const abandonedCount = sessions.filter((s) => s.status === "abandoned").length
  const completionRate = sessions.length > 0
    ? Math.round((completedCount / sessions.length) * 100) : 0

  const grouped = groupByDate(sessions)
  const dateLabels = Object.keys(grouped)

  return (
    <div style={{ width: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
            Focus Tracker
          </h1>
          <p style={{ fontSize: "13px", color: "#888", margin: 0 }}>
            Your deep work sessions over the last 30 days.
          </p>
        </div>
        {telegramConnected && deeplink && (
          <a
            href={deeplink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize:       "13px",
              fontWeight:     700,
              color:          "#FFFFFF",
              background:     "linear-gradient(135deg, #7C3AED, #6366F1)",
              textDecoration: "none",
              padding:        "10px 20px",
              borderRadius:   "8px",
              whiteSpace:     "nowrap",
              display:        "flex",
              alignItems:     "center",
              gap:            "8px",
              boxShadow:      "0 4px 16px rgba(124,58,237,0.35)",
            }}
          >
            <span>▶</span> Start Focus Session
          </a>
        )}
      </div>

      {!telegramConnected ? (
        /* ── not connected ───────────────────────────────────────────── */
        <div style={{
          backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)",
          borderRadius: "16px", padding: "48px 32px", textAlign: "center", maxWidth: "520px",
        }}>
          <div style={{ width: "60px", height: "60px", borderRadius: "50%", background: "linear-gradient(135deg, #7C3AED, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", margin: "0 auto 16px" }}>
            ⏱
          </div>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 8px" }}>Focus sessions live on Telegram</p>
          <p style={{ fontSize: "13px", color: "#888", margin: "0 0 20px", lineHeight: 1.6 }}>
            Tell {personaName} what you want to focus on — she&apos;ll start a timer, check in with you, and log it here automatically.
          </p>
          {deeplink && (
            <a href={deeplink} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", padding: "10px 22px", borderRadius: "8px", background: "linear-gradient(135deg, #7C3AED, #6366F1)", color: "#FFFFFF", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
              Start on Telegram
            </a>
          )}
        </div>
      ) : sessions.length === 0 ? (
        /* ── no sessions yet ─────────────────────────────────────────── */
        <div style={{
          backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)",
          borderRadius: "16px", padding: "48px 32px", textAlign: "center", maxWidth: "520px",
        }}>
          <p style={{ fontSize: "22px", margin: "0 0 12px" }}>⏱</p>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 8px" }}>No sessions logged yet</p>
          <p style={{ fontSize: "13px", color: "#888", margin: "0 0 20px", lineHeight: 1.6 }}>
            Tell {personaName} "let&apos;s do a 45 minute focus session on [topic]" — she&apos;ll set a timer and log it here.
          </p>
          {deeplink && (
            <a href={deeplink} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", padding: "10px 22px", borderRadius: "8px", background: "linear-gradient(135deg, #7C3AED, #6366F1)", color: "#FFFFFF", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
              Start first session ▶
            </a>
          )}
        </div>
      ) : (
        <>
          {/* ── Stats row ─────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
            {/* Total hours */}
            <div style={{ backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "12px", padding: "18px 20px" }}>
              <p style={{ fontSize: "11px", fontWeight: 500, color: "#666", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Total Hours</p>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>{totalHours.toFixed(1)}</p>
              <p style={{ fontSize: "12px", color: "#888", margin: "4px 0 0" }}>in 30 days</p>
              <div style={{ marginTop: "10px" }}><Sparkline sessions={sessions} /></div>
            </div>

            {/* Sessions completed */}
            <div style={{ backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "12px", padding: "18px 20px" }}>
              <p style={{ fontSize: "11px", fontWeight: 500, color: "#666", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Completed</p>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>{completedCount}</p>
              <p style={{ fontSize: "12px", color: "#888", margin: "4px 0 0" }}>{abandonedCount} abandoned</p>
            </div>

            {/* Completion rate */}
            <div style={{ backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "12px", padding: "18px 20px", display: "flex", alignItems: "center", gap: "14px" }}>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 500, color: "#666", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Completion</p>
                <p style={{ fontSize: "28px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>{completionRate}%</p>
                <p style={{ fontSize: "12px", color: "#888", margin: "4px 0 0" }}>rate</p>
              </div>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <CircleProgress pct={completionRate} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#FFFFFF" }}>{completionRate}%</span>
                </div>
              </div>
            </div>

            {/* Avg session */}
            <div style={{ backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "12px", padding: "18px 20px" }}>
              <p style={{ fontSize: "11px", fontWeight: 500, color: "#666", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Avg Session</p>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>{formatDuration(avgMin)}</p>
              <p style={{ fontSize: "12px", color: "#888", margin: "4px 0 0" }}>per session</p>
            </div>
          </div>

          {/* ── 2-col main area ───────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "16px", alignItems: "start" }}>

            {/* Left: start session card */}
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {deeplink && (
                <div style={{
                  backgroundColor: "var(--kv-card-bg)",
                  border:          "1px solid var(--kv-card-border)",
                  borderRadius:    "14px",
                  padding:         "24px",
                  position:        "relative",
                  overflow:        "hidden",
                }}>
                  {/* glow */}
                  <div style={{ position: "absolute", right: "-20px", bottom: "-20px", width: "160px", height: "160px", background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%)", pointerEvents: "none" }} />
                  {/* sparkle dots */}
                  {[{ top: "18px", right: "80px", sz: "4px" }, { top: "40px", right: "50px", sz: "3px" }, { top: "60px", right: "90px", sz: "5px" }].map((d, i) => (
                    <div key={i} style={{ position: "absolute", top: d.top, right: d.right, width: d.sz, height: d.sz, borderRadius: "50%", backgroundColor: "#8B5CF6", opacity: 0.6 }} />
                  ))}

                  <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: "var(--kv-accent2, #6366F1)", margin: "0 0 12px", textTransform: "uppercase" }}>
                    Ready to focus?
                  </p>
                  <p style={{ fontSize: "18px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 6px", maxWidth: "70%" }}>
                    Start a deep work session
                  </p>
                  <p style={{ fontSize: "12px", color: "#888", margin: "0 0 20px", lineHeight: 1.5 }}>
                    Tell {personaName} what you&apos;re working on and she&apos;ll set a timer, keep you accountable, and log it here.
                  </p>
                  <a
                    href={deeplink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display:        "inline-flex",
                      alignItems:     "center",
                      gap:            "8px",
                      padding:        "10px 22px",
                      borderRadius:   "8px",
                      background:     "linear-gradient(135deg, #7C3AED, #6366F1)",
                      color:          "#FFFFFF",
                      fontSize:       "13px",
                      fontWeight:     700,
                      textDecoration: "none",
                      boxShadow:      "0 4px 16px rgba(124,58,237,0.35)",
                    }}
                  >
                    <span>▶</span> Start Focus Session
                  </a>
                </div>
              )}

              {/* Planner link */}
              <div style={{ backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "12px", padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 2px" }}>Today&apos;s Plan</p>
                  <p style={{ fontSize: "12px", color: "#666", margin: 0 }}>See your tasks for today</p>
                </div>
                <Link href="/dashboard/plan" style={{ fontSize: "12px", fontWeight: 600, color: "var(--kv-accent)", textDecoration: "none" }}>
                  Open →
                </Link>
              </div>
            </div>

            {/* Right: session history */}
            <div style={{ backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "14px", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#666", margin: 0, textTransform: "uppercase" }}>
                  Session History
                </p>
                <span style={{ fontSize: "11px", color: "#444" }}>Last 30 days</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0px" }}>
                {dateLabels.map((label, gi) => (
                  <div key={label}>
                    <p style={{ fontSize: "11px", fontWeight: 700, color: "#555", margin: gi === 0 ? "0 0 8px" : "16px 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {label}
                    </p>
                    {grouped[label]!.map((s, si) => (
                      <div
                        key={s.id}
                        style={{
                          display:         "flex",
                          alignItems:      "center",
                          gap:             "12px",
                          padding:         "10px 0",
                          borderBottom:    si < grouped[label]!.length - 1 ? "1px solid #1A1A1A" : "none",
                        }}
                      >
                        {/* Status dot */}
                        <div style={{
                          width:           "8px",
                          height:          "8px",
                          borderRadius:    "50%",
                          backgroundColor: s.status === "completed" ? "var(--kv-accent)" : s.status === "abandoned" ? "#F59E0B" : "#3A3A3A",
                          flexShrink:      0,
                        }} />

                        {/* Duration */}
                        <span style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", minWidth: "44px" }}>
                          {formatDuration(s.durationMin)}
                        </span>

                        {/* Status label */}
                        <span style={{
                          fontSize:        "10px",
                          fontWeight:      600,
                          textTransform:   "uppercase",
                          letterSpacing:   "0.06em",
                          color:           s.status === "completed" ? "var(--kv-accent)" : s.status === "abandoned" ? "#F59E0B" : "#888",
                        }}>
                          {s.status}
                        </span>

                        <span style={{ fontSize: "12px", color: "#555", marginLeft: "auto" }}>
                          {formatTime(s.startedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

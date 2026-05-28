"use client"

interface FocusSession {
  id: string
  durationMin: number
  status: "completed" | "abandoned"
  startedAt: string
}

interface FocusSessionLogProps {
  sessions: FocusSession[]
  tier: string
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function totalHours(sessions: FocusSession[]): string {
  const total = sessions.reduce((s, ss) => s + ss.durationMin, 0)
  if (total === 0) return "0h"
  if (total < 60) return `${total}m`
  return `${(total / 60).toFixed(1)}h`
}

export default function FocusSessionLog({ sessions, tier }: FocusSessionLogProps) {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
  const monthAgo = new Date(now.getTime() - 30 * 86400000)

  const weekSessions = sessions.filter((s) => new Date(s.startedAt) >= weekAgo)
  const monthSessions = sessions.filter((s) => new Date(s.startedAt) >= monthAgo)

  // Declining: recent4[0] is most recent. If each more-recent session is shorter → declining
  const recent4 = sessions.slice(0, 4)
  const isDecline =
    recent4.length >= 3 &&
    recent4.slice(1).every((s, i) => recent4[i].durationMin < s.durationMin)

  const isFree = tier === "free"
  const visibleSessions = isFree
    ? sessions.filter((s) => new Date(s.startedAt) >= weekAgo)
    : sessions
  const hasLockedData = isFree && sessions.length > visibleSessions.length

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
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 16px" }}>
        Focus Sessions
      </p>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
        {[
          { label: "This week", value: totalHours(weekSessions) },
          { label: "This month", value: totalHours(monthSessions) },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              backgroundColor: "#111111",
              border: "1px solid #2A2A2A",
              borderRadius: "8px",
              padding: "14px 16px",
            }}
          >
            <span
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "#FFFFFF",
                display: "block",
                lineHeight: 1.1,
                marginBottom: "3px",
              }}
            >
              {value}
            </span>
            <span style={{ fontSize: "11px", color: "#888888" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Fatigue callout */}
      {isDecline && (
        <div
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.07)",
            border: "1px solid rgba(245, 158, 11, 0.18)",
            borderRadius: "8px",
            padding: "10px 14px",
            marginBottom: "14px",
          }}
        >
          <span style={{ fontSize: "12px", color: "#F59E0B" }}>
            Sessions getting shorter — possible fatigue.
          </span>
        </div>
      )}

      {sessions.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 0" }}>
          <p style={{ fontSize: "13px", color: "#444444", margin: 0, textAlign: "center" }}>
            Focus sessions will appear here once you start tracking with Kevo.
          </p>
        </div>
      ) : (
        <div>
          {visibleSessions.slice(0, 10).map((session, i) => (
            <div
              key={session.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 0",
                borderBottom:
                  i < Math.min(visibleSessions.length, 10) - 1 ? "1px solid #2A2A2A" : "none",
              }}
            >
              <span style={{ flex: 1, fontSize: "12px", color: "#888888" }}>
                {new Date(session.startedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF" }}>
                {formatDuration(session.durationMin)}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  color: session.status === "completed" ? "#0D0D0D" : "#F59E0B",
                  backgroundColor:
                    session.status === "completed" ? "#00F5A0" : "rgba(245, 158, 11, 0.1)",
                  border:
                    session.status === "completed"
                      ? "none"
                      : "1px solid rgba(245, 158, 11, 0.3)",
                }}
              >
                {session.status === "completed" ? "Completed" : "Abandoned"}
              </span>
            </div>
          ))}

          {hasLockedData && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                backgroundColor: "#111111",
                border: "1px solid #2A2A2A",
                borderRadius: "8px",
                textAlign: "center",
              }}
            >
              <a
                href="/dashboard/settings"
                style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
              >
                Unlock 90 days →
              </a>
            </div>
          )}

          {sessions.length >= 5 && (
            <div
              style={{
                marginTop: "16px",
                padding: "14px",
                backgroundColor: "#111111",
                border: "1px solid #2A2A2A",
                borderRadius: "8px",
              }}
            >
              <p style={{ fontSize: "12px", color: "#FFFFFF", fontStyle: "italic", margin: 0, lineHeight: 1.5 }}>
                You focus best on Tuesday mornings.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

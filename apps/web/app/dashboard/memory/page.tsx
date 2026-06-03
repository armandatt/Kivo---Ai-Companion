import { cookies } from "next/headers"
import Link from "next/link"

type MemoryItem = {
  id:         string
  type:       string
  key:        string
  value:      string
  confidence: number
  createdAt:  string
}

type MemoryData = {
  memories:          MemoryItem[]
  telegramConnected: boolean
  personaName:       string | null
}

async function fetchMemory(): Promise<MemoryData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null
    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/memory`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache:   "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

const TYPE_LABELS: Record<string, string> = {
  goal:        "Goal",
  habit:       "Habit",
  preference:  "Preference",
  personality: "Personality",
  context:     "Context",
  health:      "Health",
  schedule:    "Schedule",
  study:       "Study",
  academic:    "Academic",
}

const TYPE_COLORS: Record<string, string> = {
  goal:        "#7C3AED",
  habit:       "#6366F1",
  preference:  "#8B5CF6",
  personality: "#A78BFA",
  context:     "#4F46E5",
  health:      "#06B6D4",
  schedule:    "#0EA5E9",
  study:       "#7C3AED",
  academic:    "#6366F1",
}

function typeLabel(t: string)  { return TYPE_LABELS[t]  ?? t.charAt(0).toUpperCase() + t.slice(1) }
function typeColor(t: string)  { return TYPE_COLORS[t]  ?? "#7C3AED" }

function formatKey(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{ flex: 1, height: "3px", borderRadius: "2px", backgroundColor: "#2A2A2A" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: "2px", background: "var(--kv-accent)" }} />
      </div>
      <span style={{ fontSize: "10px", color: "#555", minWidth: "30px", textAlign: "right" }}>{pct}%</span>
    </div>
  )
}

function MemoryCard({ item }: { item: MemoryItem }) {
  const color = typeColor(item.type)
  return (
    <div style={{
      backgroundColor: "var(--kv-card-bg)",
      border:          "1px solid var(--kv-card-border)",
      borderRadius:    "12px",
      padding:         "16px 18px",
      display:         "flex",
      flexDirection:   "column",
      gap:             "10px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <span style={{
          fontSize:        "10px",
          fontWeight:      700,
          letterSpacing:   "0.08em",
          textTransform:   "uppercase",
          color:           color,
          backgroundColor: `${color}18`,
          border:          `1px solid ${color}30`,
          padding:         "2px 8px",
          borderRadius:    "6px",
          flexShrink:      0,
        }}>
          {typeLabel(item.type)}
        </span>
        <span style={{ fontSize: "11px", color: "#444" }}>{formatDate(item.createdAt)}</span>
      </div>

      <div>
        <p style={{ fontSize: "11px", color: "#555", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {formatKey(item.key)}
        </p>
        <p style={{ fontSize: "14px", fontWeight: 600, color: "#EEEEEE", margin: 0, lineHeight: 1.4 }}>
          {item.value.length > 120 ? item.value.slice(0, 120) + "…" : item.value}
        </p>
      </div>

      <ConfidenceBar confidence={item.confidence} />
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      backgroundColor: "var(--kv-card-bg)",
      border:          "1px solid var(--kv-card-border)",
      borderRadius:    "10px",
      padding:         "14px 20px",
      display:         "flex",
      flexDirection:   "column",
      gap:             "4px",
    }}>
      <p style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>{value}</p>
      <p style={{ fontSize: "11px", color: "#666", margin: 0 }}>{label}</p>
    </div>
  )
}

export default async function MemoryPage() {
  const data             = await fetchMemory()
  const memories         = data?.memories ?? []
  const telegramConnected = data?.telegramConnected ?? false
  const personaName      = data?.personaName ?? "Nova"

  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME ?? ""
  const deeplink    = botUsername ? `https://t.me/${botUsername}` : null

  // Group by type
  const grouped = memories.reduce<Record<string, MemoryItem[]>>((acc, m) => {
    const t = m.type
    if (!acc[t]) acc[t] = []
    acc[t]!.push(m)
    return acc
  }, {})

  const categories = Object.keys(grouped).sort()
  const avgConf    = memories.length
    ? Math.round((memories.reduce((s, m) => s + m.confidence, 0) / memories.length) * 100)
    : 0

  return (
    <div style={{ width: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
            {personaName}&apos;s Memory
          </h1>
          <p style={{ fontSize: "13px", color: "#888", margin: 0 }}>
            What {personaName} has learned about you through your conversations.
          </p>
        </div>
        {telegramConnected && deeplink && (
          <a
            href={deeplink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize:        "13px",
              fontWeight:      600,
              color:           "#FFFFFF",
              background:      "var(--kv-accent)",
              textDecoration:  "none",
              padding:         "8px 16px",
              borderRadius:    "8px",
              whiteSpace:      "nowrap",
            }}
          >
            Chat with {personaName} ✨
          </a>
        )}
      </div>

      {!telegramConnected ? (
        /* ── no Telegram ─────────────────────────────────────────────── */
        <div style={{
          backgroundColor: "var(--kv-card-bg)",
          border:          "1px solid var(--kv-card-border)",
          borderRadius:    "16px",
          padding:         "48px 32px",
          textAlign:       "center",
          maxWidth:        "520px",
        }}>
          <div style={{
            width: "60px", height: "60px", borderRadius: "50%",
            background: "linear-gradient(135deg, #7C3AED, #6366F1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "22px", margin: "0 auto 16px",
          }}>
            🧠
          </div>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 8px" }}>
            No memories yet
          </p>
          <p style={{ fontSize: "13px", color: "#888", margin: "0 0 20px", lineHeight: 1.6 }}>
            Connect Telegram and start chatting with {personaName}. As you talk, she&apos;ll learn your habits, goals, and preferences — and remember them here.
          </p>
          {deeplink && (
            <a href={deeplink} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", padding: "10px 22px", borderRadius: "8px", background: "linear-gradient(135deg, #7C3AED, #6366F1)", color: "#FFFFFF", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
              Start chatting on Telegram
            </a>
          )}
        </div>
      ) : memories.length === 0 ? (
        /* ── connected but no facts yet ─────────────────────────────── */
        <div style={{
          backgroundColor: "var(--kv-card-bg)",
          border:          "1px solid var(--kv-card-border)",
          borderRadius:    "16px",
          padding:         "48px 32px",
          textAlign:       "center",
          maxWidth:        "520px",
        }}>
          <p style={{ fontSize: "22px", margin: "0 0 12px" }}>🧠</p>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 8px" }}>
            Memory building…
          </p>
          <p style={{ fontSize: "13px", color: "#888", margin: "0 0 20px", lineHeight: 1.6 }}>
            {personaName} hasn&apos;t picked up any facts yet. Keep chatting — she&apos;ll start remembering things about you.
          </p>
          {deeplink && (
            <a href={deeplink} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", padding: "10px 22px", borderRadius: "8px", background: "linear-gradient(135deg, #7C3AED, #6366F1)", color: "#FFFFFF", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
              Open {personaName} ✨
            </a>
          )}
        </div>
      ) : (
        <>
          {/* ── Stats row ─────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
            <StatPill label="Total memories"   value={memories.length} />
            <StatPill label="Categories"       value={categories.length} />
            <StatPill label="Avg confidence"   value={`${avgConf}%`} />
            <StatPill label="Most recent"      value={memories[0] ? formatDate(memories[0].createdAt) : "—"} />
          </div>

          {/* ── Grouped memory cards ──────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
            {categories.map((type) => (
              <div key={type}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <span style={{
                    fontSize:        "11px",
                    fontWeight:      700,
                    letterSpacing:   "0.1em",
                    textTransform:   "uppercase",
                    color:           typeColor(type),
                  }}>
                    {typeLabel(type)}
                  </span>
                  <span style={{
                    fontSize:        "10px",
                    color:           "#444",
                    backgroundColor: "#1A1A1A",
                    border:          "1px solid #2A2A2A",
                    borderRadius:    "10px",
                    padding:         "1px 8px",
                  }}>
                    {grouped[type]!.length}
                  </span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#1E1E1E" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                  {grouped[type]!.map((item) => (
                    <MemoryCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ── Footer note ───────────────────────────────────────────── */}
          <div style={{ marginTop: "32px", padding: "16px 20px", backgroundColor: "var(--kv-card-bg)", border: "1px solid var(--kv-card-border)", borderRadius: "10px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "16px" }}>💜</span>
            <p style={{ fontSize: "12px", color: "#666", margin: 0, lineHeight: 1.5 }}>
              These are {personaName}&apos;s internal notes about you. They make your conversations smarter over time. Keep chatting to refine them.{" "}
              {deeplink && (
                <Link href={deeplink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--kv-accent)", textDecoration: "none" }}>
                  Open {personaName} ↗
                </Link>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

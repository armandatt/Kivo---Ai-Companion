import Link from "next/link"
import { Flame, Target, BookOpen, CheckCircle2, Calendar, ChevronRight } from "lucide-react"
import type { BuiltTask } from "@/lib/plan-parser"

// ── color tokens ──────────────────────────────────────────────────────────────
const P   = "#7C3AED"   // primary purple
const P2  = "#6366F1"   // indigo variant
const PG  = "linear-gradient(135deg, #7C3AED 0%, #6366F1 100%)"
const PBG = "rgba(124,58,237,0.10)"
const CB  = "#0F0F1C"   // card background (slight blue tint)
const CBB = "#1E1E3A"   // card border

// ── helpers ───────────────────────────────────────────────────────────────────
function moodToScore(mood: string): number {
  const map: Record<string, number> = {
    amazing: 95, great: 85, good: 75, okay: 60,
    tired: 45, stressed: 40, bad: 30,
  }
  return map[mood?.toLowerCase()] ?? 65
}

function moodLabel(score: number) {
  if (score >= 85) return "Excellent"
  if (score >= 70) return "Good focus"
  if (score >= 55) return "Moderate"
  return "Rest needed"
}

function daysUntil(isoDate: string) {
  const diff = Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000)
  if (diff <= 0) return "Today"
  if (diff === 1) return "Tomorrow"
  return `In ${diff} days`
}

function greet(name: string | null) {
  const h = new Date().getHours()
  const time = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"
  const first = name?.split(" ")[0] ?? "there"
  return `Good ${time}, ${first} ✨`
}

// ── sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = P2, w = 80, h = 28 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (data.length < 2) {
    // Draw a gentle flat wave when no data
    const pts = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80]
      .map((x, i) => `${x},${h / 2 + (i % 2 === 0 ? 2 : -2)}`).join(" ")
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
      </svg>
    )
  }
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 4) + 2
    const y = h - 4 - ((v - mn) / rng) * (h - 10)
    return `${x},${y}`
  }).join(" ")
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── circular progress ─────────────────────────────────────────────────────────
function CircleProgress({ pct, size = 72 }: { pct: number; size?: number }) {
  const r    = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const dash = Math.min(Math.max(pct, 0), 100) / 100 * circ
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2A2A2A" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={P} strokeWidth="5"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
    </svg>
  )
}

// ── sub-card wrapper ──────────────────────────────────────────────────────────
function Card({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        backgroundColor: CB,
        border:          `1px solid ${CBB}`,
        borderRadius:    "12px",
        padding:         "18px 20px",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ── stat cards (top row) ──────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  sparkData,
  icon: Icon,
}: {
  label:     string
  value:     string
  sub:       string
  sparkData: number[]
  icon:      React.ComponentType<{ size: number; strokeWidth: number }>
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "11px", fontWeight: 500, color: "#666", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {label}
          </p>
          <p style={{ fontSize: "26px", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1 }}>{value}</p>
          <p style={{ fontSize: "12px", color: "#888", margin: "4px 0 0" }}>{sub}</p>
        </div>
        <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: PBG, border: `1px solid ${P}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={16} strokeWidth={2} />
        </div>
      </div>
      <div style={{ marginTop: "8px", alignSelf: "flex-end" }}>
        <Sparkline data={sparkData} />
      </div>
    </Card>
  )
}

// ── today's focus (big left card) ─────────────────────────────────────────────
function TodayFocusCard({
  task,
  taskCount,
}: {
  task:      BuiltTask | null
  taskCount: number
}) {
  const title    = task?.title ?? "No tasks planned today"
  const subtitle = taskCount > 1 ? `+${taskCount - 1} more tasks today` : "Today's top priority"

  return (
    <Card style={{ position: "relative", overflow: "hidden", minHeight: "200px" }}>
      {/* Decorative glow */}
      <div style={{
        position:     "absolute",
        right:        "-30px",
        bottom:       "-30px",
        width:        "200px",
        height:       "200px",
        background:   "radial-gradient(circle at 40% 40%, rgba(99,102,241,0.25) 0%, rgba(124,58,237,0.08) 55%, transparent 70%)",
        borderRadius: "50%",
        pointerEvents:"none",
      }} />
      {/* Sparkle dots */}
      {[
        { top: "22px", right: "100px", size: "4px" },
        { top: "48px", right: "65px",  size: "3px" },
        { top: "80px", right: "120px", size: "5px" },
        { top: "36px", right: "170px", size: "3px" },
      ].map((dot, i) => (
        <div key={i} style={{
          position:     "absolute",
          top:          dot.top,
          right:        dot.right,
          width:        dot.size,
          height:       dot.size,
          borderRadius: "50%",
          backgroundColor: "#8B5CF6",
          opacity:      0.5 + (i * 0.1),
          pointerEvents:"none",
        }} />
      ))}

      <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: P2, margin: "0 0 14px", textTransform: "uppercase" }}>
        Today&apos;s Focus
      </p>
      <p style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px", maxWidth: "70%", lineHeight: 1.3 }}>
        {title.length > 50 ? title.slice(0, 50) + "…" : title}
      </p>
      <p style={{ fontSize: "13px", color: "#888", margin: "0 0 16px" }}>{subtitle}</p>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <p style={{ fontSize: "12px", color: "#666", margin: 0 }}>
          Estimated: <span style={{ color: "#CCCCCC" }}>{taskCount} task{taskCount !== 1 ? "s" : ""}</span>
        </p>
      </div>
      <Link
        href="/dashboard/plan"
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          gap:            "8px",
          marginTop:      "18px",
          padding:        "10px 22px",
          borderRadius:   "8px",
          background:     PG,
          color:          "#FFFFFF",
          fontSize:       "13px",
          fontWeight:     700,
          textDecoration: "none",
          boxShadow:      `0 4px 16px rgba(124,58,237,0.35)`,
        }}
      >
        Open Planner
        <span style={{ fontSize: "14px" }}>▶</span>
      </Link>

      {/* Abstract Nova avatar on right */}
      <div style={{
        position:     "absolute",
        right:        "16px",
        bottom:       "16px",
        width:        "80px",
        height:       "80px",
        borderRadius: "50%",
        background:   "linear-gradient(135deg, rgba(124,58,237,0.4) 0%, rgba(99,102,241,0.2) 100%)",
        border:       "1px solid rgba(124,58,237,0.3)",
        display:      "flex",
        alignItems:   "center",
        justifyContent:"center",
        fontSize:     "28px",
        fontWeight:   700,
        color:        "rgba(255,255,255,0.5)",
        letterSpacing:"-1px",
      }}>
        N
      </div>
    </Card>
  )
}

// ── discipline score card ─────────────────────────────────────────────────────
function DisciplineCard({ streak }: { streak: number }) {
  const score  = Math.min(100, streak * 4 + 50)
  const label  = score >= 85 ? "Excellent" : score >= 65 ? "Good" : "Building"
  const deltaStr = streak > 0 ? `↑ ${streak} day streak` : "Start your streak"

  return (
    <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", color: "#666", margin: 0, textTransform: "uppercase" }}>
        Discipline
      </p>
      <div style={{ position: "relative", display: "inline-flex" }}>
        <CircleProgress pct={score} size={68} />
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF" }}>{score}</span>
          <span style={{ fontSize: "9px", color: "#888" }}>/100</span>
        </div>
      </div>
      <p style={{ fontSize: "12px", fontWeight: 600, color: P2, margin: 0 }}>{label}</p>
      <p style={{ fontSize: "10px", color: "#555", margin: 0, textAlign: "center" }}>{deltaStr}</p>
    </Card>
  )
}

// ── weekly progress card ──────────────────────────────────────────────────────
function WeeklyProgressCard({ taskCount, moodScore }: { taskCount: number; moodScore: number }) {
  const pct = Math.min(100, Math.round((taskCount / Math.max(taskCount, 5)) * 100 * 0.6 + moodScore * 0.3))

  return (
    <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", color: "#666", margin: 0, textTransform: "uppercase" }}>
        Weekly
      </p>
      <div style={{ position: "relative", display: "inline-flex" }}>
        <CircleProgress pct={pct} size={68} />
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF" }}>{pct}%</span>
        </div>
      </div>
      <p style={{ fontSize: "12px", fontWeight: 600, color: "#FFFFFF", margin: 0 }}>Progress</p>
      <p style={{ fontSize: "10px", color: P2, margin: 0 }}>Keep pushing!</p>
    </Card>
  )
}

// ── next deadline card ────────────────────────────────────────────────────────
function NextGoalCard({ deadline }: { deadline: { title: string; dueAt: string } | null }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", color: "#666", margin: 0, textTransform: "uppercase" }}>
        Next Deadline
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: PBG, border: `1px solid ${P}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Calendar size={16} strokeWidth={2} style={{ color: P2 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          {deadline ? (
            <>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {deadline.title.length > 22 ? deadline.title.slice(0, 22) + "…" : deadline.title}
              </p>
              <p style={{ fontSize: "11px", color: P2, margin: "2px 0 0" }}>
                {daysUntil(deadline.dueAt)}
              </p>
            </>
          ) : (
            <p style={{ fontSize: "12px", color: "#555", margin: 0 }}>No upcoming deadlines</p>
          )}
        </div>
      </div>
      <Link href="/dashboard/goals" style={{ fontSize: "11px", color: "#555", textDecoration: "none", display: "flex", alignItems: "center", gap: "2px" }}>
        View all <ChevronRight size={10} />
      </Link>
    </Card>
  )
}

// ── Nova's message card ───────────────────────────────────────────────────────
function NovaMessageCard({
  message,
  personaName,
}: {
  message:     { text: string; timestamp: string } | null
  personaName: string | null
}) {
  const name = personaName ?? "Nova"
  const text = message?.text
    ?? "You have the potential to do extraordinary things. The only difference between you and the top 1% is daily discipline. Keep showing up."

  return (
    <Card style={{ position: "relative", overflow: "hidden" }}>
      {/* background glow */}
      <div style={{
        position:     "absolute",
        top:          "-20px",
        right:        "-20px",
        width:        "120px",
        height:       "120px",
        background:   "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)",
        pointerEvents:"none",
      }} />

      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
        {/* Nova avatar */}
        <div style={{
          width:          "44px",
          height:         "44px",
          borderRadius:   "50%",
          background:     PG,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          fontSize:       "16px",
          fontWeight:     700,
          color:          "#FFFFFF",
          flexShrink:     0,
        }}>
          {name.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: P2, margin: "0 0 8px", textTransform: "uppercase" }}>
            {name}&apos;s Message For You
          </p>
          <p style={{ fontSize: "22px", fontWeight: 700, color: P2, margin: "0 0 10px", lineHeight: 1 }}>&ldquo;</p>
          <p style={{ fontSize: "13px", color: "#CCCCCC", lineHeight: 1.6, margin: "0 0 10px" }}>
            {text.length > 160 ? text.slice(0, 160) + "…" : text}
          </p>
          <p style={{ fontSize: "12px", color: "#666", margin: 0 }}>— {name} ♥</p>
        </div>
      </div>
    </Card>
  )
}

// ── today's plan card ─────────────────────────────────────────────────────────
function TodayPlanCard({ tasks }: { tasks: BuiltTask[] }) {
  const shown = tasks.slice(0, 5)

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#666", margin: 0, textTransform: "uppercase" }}>
          Today&apos;s Plan
        </p>
        <Link href="/dashboard/plan" style={{ fontSize: "11px", color: P2, textDecoration: "none" }}>
          View planner
        </Link>
      </div>

      {shown.length === 0 ? (
        <p style={{ fontSize: "13px", color: "#555", margin: 0 }}>No tasks today. Add one in the planner.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {shown.map((task, i) => (
            <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <div style={{
                width:        "18px",
                height:       "18px",
                borderRadius: "50%",
                border:       `1.5px solid ${i < 2 ? P : "#3A3A3A"}`,
                backgroundColor: i < 2 ? PBG : "transparent",
                display:      "flex",
                alignItems:   "center",
                justifyContent:"center",
                flexShrink:   0,
                marginTop:    "1px",
              }}>
                {i < 2 && <span style={{ fontSize: "10px", color: P2 }}>✓</span>}
              </div>
              <p style={{
                fontSize:   "13px",
                color:      i < 2 ? "#666" : "#CCCCCC",
                margin:     0,
                lineHeight: 1.4,
                textDecoration: i < 2 ? "line-through" : "none",
              }}>
                {task.title.length > 40 ? task.title.slice(0, 40) + "…" : task.title}
              </p>
            </div>
          ))}
        </div>
      )}

      <Link href="/dashboard/plan" style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "14px", fontSize: "12px", color: "#555", textDecoration: "none" }}>
        <span style={{ fontSize: "14px", color: P2 }}>+</span> Add task
      </Link>
    </Card>
  )
}

// ── recent achievement card ───────────────────────────────────────────────────
function RecentAchievementCard({
  streak,
  personaName,
  telegramConnected,
}: {
  streak:            number
  personaName:       string | null
  telegramConnected: boolean
}) {
  const name = personaName ?? "Nova"
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME ?? ""
  const deeplink    = botUsername ? `https://t.me/${botUsername}` : null

  const title    = streak >= 1 ? `${streak} Day Streak` : "First session awaits"
  const subtitle = streak >= 7 ? "Keep the momentum going!" :
                   streak >= 3 ? "You&apos;re building a habit!" :
                   streak >= 1 ? "Longest streak this month." :
                   "Start chatting to build your streak."

  return (
    <Card style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{
        width:          "48px",
        height:         "48px",
        borderRadius:   "12px",
        background:     "linear-gradient(135deg, #7C3AED, #6366F1)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        fontSize:       "22px",
        flexShrink:     0,
        boxShadow:      "0 4px 12px rgba(124,58,237,0.4)",
      }}>
        🔥
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>{title}</p>
          <span style={{ fontSize: "11px" }}>✨</span>
        </div>
        <p style={{ fontSize: "11px", color: "#888", margin: 0 }}>{subtitle}</p>
      </div>
      {telegramConnected && deeplink && (
        <a
          href={deeplink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize:       "11px",
            fontWeight:     600,
            color:          P2,
            textDecoration: "none",
            whiteSpace:     "nowrap",
            flexShrink:     0,
          }}
        >
          Open {name} ✨
        </a>
      )}
    </Card>
  )
}

// ── main export ───────────────────────────────────────────────────────────────
type Props = {
  userName:          string | null
  streak:            { current: number; best: number; broken: boolean }
  mood:              Array<{ date: string; mood: string }>
  todayTasks:        BuiltTask[]
  deadlines:         Array<{ id: string; title: string; dueAt: string }>
  lastMessage:       { text: string; timestamp: string } | null
  primaryGoal:       string | null
  telegramConnected: boolean
  personaName:       string | null
}

export default function NovaDashboard({
  userName,
  streak,
  mood,
  todayTasks,
  deadlines,
  lastMessage,
  telegramConnected,
  personaName,
}: Props) {
  const moodScores   = mood.slice(0, 7).map((m) => moodToScore(m.mood))
  const latestScore  = moodScores[0] ?? 65
  const streakSpark  = Array.from({ length: 7 }, (_, i) => Math.max(0, streak.current - (6 - i)))
  const taskSpark    = mood.slice(0, 7).map((_, i) => Math.max(0, todayTasks.length - i))

  return (
    <div style={{ maxWidth: "1200px" }}>
      {/* Greeting */}
      <div style={{ marginBottom: "22px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          {greet(userName)}
        </h1>
        <p style={{ fontSize: "14px", color: "#888", margin: 0 }}>
          I&apos;m {personaName ?? "Nova"}, your study companion. Let&apos;s make today count.
        </p>
      </div>

      {/* 4 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <StatCard
          label="Study Streak"
          value={`${streak.current} days`}
          sub={`Best: ${streak.best} days`}
          sparkData={streakSpark}
          icon={Flame as React.ComponentType<{ size: number; strokeWidth: number }>}
        />
        <StatCard
          label="Focus Score"
          value={`${latestScore}`}
          sub={moodLabel(latestScore)}
          sparkData={moodScores.length ? moodScores : [65]}
          icon={Target as React.ComponentType<{ size: number; strokeWidth: number }>}
        />
        <StatCard
          label="Today"
          value={`${todayTasks.length} tasks`}
          sub="From your plan"
          sparkData={taskSpark}
          icon={BookOpen as React.ComponentType<{ size: number; strokeWidth: number }>}
        />
        <StatCard
          label="Upcoming"
          value={`${deadlines.length}`}
          sub={deadlines.length === 1 ? "1 deadline" : `${deadlines.length} deadlines`}
          sparkData={Array.from({ length: 7 }, (_, i) => deadlines.length - i < 0 ? 0 : deadlines.length - i)}
          icon={CheckCircle2 as React.ComponentType<{ size: number; strokeWidth: number }>}
        />
      </div>

      {/* Main 2-col grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "12px", alignItems: "start" }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TodayFocusCard task={todayTasks[0] ?? null} taskCount={todayTasks.length} />

          {/* 3 small cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <DisciplineCard streak={streak.current} />
            <WeeklyProgressCard taskCount={todayTasks.length} moodScore={latestScore} />
            <NextGoalCard deadline={deadlines[0] ?? null} />
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <NovaMessageCard message={lastMessage} personaName={personaName} />
          <TodayPlanCard tasks={todayTasks} />
          <RecentAchievementCard
            streak={streak.current}
            personaName={personaName}
            telegramConnected={telegramConnected}
          />
        </div>
      </div>
    </div>
  )
}

export const metadata = {
  title: "Rex — Feature Guide",
  description: "Everything Rex can do. Commands, natural language, auto-schedules.",
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const COMMANDS = [
  { cmd: "/log",                example: "/log",               desc: "Start today's session. Rex prompts with your exercises, tracks sets/reps/weight as you go." },
  { cmd: "/pr",                 example: "/pr",                desc: "All personal records, sorted by exercise." },
  { cmd: "/progress [exercise]",example: "/progress bench",   desc: "Visual lift progression chart for any exercise across your last 8 sessions." },
  { cmd: "/history [n]",        example: "/history 10",        desc: "Last n sessions (default 5) — date, muscles, sets, duration." },
  { cmd: "/overload",           example: "/overload",          desc: "Tomorrow's targets based on last session data and progressive overload rules." },
  { cmd: "/streak",             example: "/streak",            desc: "Current training streak in days." },
  { cmd: "/split",              example: "/split",             desc: "Your active split, each day, and which session comes next (→)." },
]

const SETUP_COMMANDS = [
  { cmd: "/setup gym_time",  example: "/setup gym_time 19:30",       desc: "Update your gym time. Pre-session messages shift automatically. Accepts 7pm, 19:30, or 7." },
  { cmd: "/setup goal",      example: "/setup goal fat_loss",        desc: "Change your goal: fat_loss / muscle / recomp / performance." },
  { cmd: "/setup weight",    example: "/setup weight 82",            desc: "Update bodyweight in kg. Differences over 15kg trigger a confirmation before saving." },
  { cmd: "/setup split",     example: "/setup split PPL",           desc: "Reconfigure your training split. Resets cycle counter. Options: PPL, upper_lower, full_body, bro_split." },
]

const REMINDER_COMMANDS = [
  { cmd: "/reminders",  example: "/reminders",   desc: "List all active reminders with their time, frequency, and index number." },
  { cmd: "/cancel [n]", example: "/cancel 2",    desc: "Delete reminder #2 from the list." },
]

const NL_FEATURES = [
  { trigger: "Workout log",      example: "bench 100kg 4×8, squat 120kg 3×5",   desc: "Log inline — no slash command. Rex parses the exercises, weight, sets, and reps." },
  { trigger: "Skip day",         example: "can't train today",                    desc: "Rex asks for a reason: skip / injury / sick / life. Each type handled differently." },
  { trigger: "Gym time change",  example: "moving gym to 7am from tomorrow",     desc: "Rex detects the new time, updates the DB, and confirms the pre-session shift time." },
  { trigger: "Set reminder",     example: "remind me at 8am to eat protein",     desc: "Creates a reminder. Rex asks: one-time, daily, or weekly if not specified." },
  { trigger: "Commitment",       example: "I'll bench 100kg by end of month",    desc: "Stored as a deadline. Rex follows up 3 days before it's due." },
]

const AUTO_CRONS = [
  { name: "Pre-session fire-up",      time: "30 min before gym",           desc: "Last lifts + today's target weight. Includes stall fix or deload note if applicable." },
  { name: "Post-session log prompt",  time: "Gym time + avg session length", desc: "\"Done? Log what you hit.\" — fires once your typical session should be over." },
  { name: "Missed session chase",     time: "+3hrs, +5hrs after gym time", desc: "Two follow-ups if nothing logged. Last chance message at the second attempt." },
  { name: "Daily check-in",          time: "9am every day",               desc: "LLM-generated. References your streak, goal, and today's plan. Never repeats." },
  { name: "Rest day morning",         time: "9am on rest days",            desc: "Recovery reminder — protein, sleep, and what's coming next session." },
  { name: "Backdate prompt",          time: "9am after missed training day", desc: "\"You didn't log yesterday. Did you train? I can backdate it.\"" },
  { name: "Silence reactivation",     time: "After 5 days quiet",          desc: "Max 2 total messages per inactivity period. Different copy for users with no sessions yet." },
  { name: "Weekly summary",           time: "Sunday 8pm",                  desc: "Cycle stats, best lift, one fix, and next cycle directive. LLM-generated." },
  { name: "Commitment follow-up",     time: "10am, 3 days before deadline", desc: "\"3 days left. [Your goal]. Going for it?\" — then marks expired ones as missed." },
]

const SMART_SESSION = [
  { name: "Progressive overload",     desc: "Rex tracks weight per exercise across sessions and flags increases, stalls, and regressions." },
  { name: "PR detection",             desc: "Instant alert when a new personal record is set mid-session." },
  { name: "Stall intervention",       desc: "Same weight 3 sessions in a row — Rex prescribes a deload reset: drop to 90%, run 4×6." },
  { name: "Deload week",              desc: "Every 4 completed cycles, Rex tells you to run 60% weights, 2 sets max." },
  { name: "Muscle mismatch",          desc: "Logging exercises that don't match today's planned group? Rex asks: Instead or Adding?" },
  { name: "Duplicate session",        desc: "Already logged today's muscles? Rex asks before creating a second session." },
  { name: "Unrealistic weight check", desc: "First 3 sessions: weights > 2× bodyweight (upper) or > 3× (lower) trigger a confirm before saving as baseline." },
]

const SKIP_HANDLING = [
  { reason: "skip",    desc: "One grace per 7 days — streak resets on the second skip within that window." },
  { reason: "injury",  desc: "Rex logs the issue and asks what's affected. No streak penalty." },
  { reason: "sick",    desc: "No streak penalty. Rex advises not training." },
  { reason: "life",    desc: "Acknowledged. Rex confirms the next session target." },
]

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page:    { maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" } as React.CSSProperties,
  header:  { marginBottom: 56 } as React.CSSProperties,
  eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#666", marginBottom: 12 } as React.CSSProperties,
  title:   { fontSize: 36, fontWeight: 700, color: "#fff", margin: "0 0 12px", lineHeight: 1.1 } as React.CSSProperties,
  sub:     { fontSize: 15, color: "#888", margin: 0 } as React.CSSProperties,
  section: { marginBottom: 56 } as React.CSSProperties,
  sh:      { fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#555", marginBottom: 20, paddingBottom: 10, borderBottom: "1px solid #1f1f1f" } as React.CSSProperties,
  grid:    { display: "grid", gap: 2 } as React.CSSProperties,
  row:     { display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, padding: "14px 0", borderBottom: "1px solid #141414", alignItems: "start" } as React.CSSProperties,
  cmd:     { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 13, color: "#e2e8f0", fontWeight: 500 } as React.CSSProperties,
  eg:      { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 11, color: "#555", marginTop: 3 } as React.CSSProperties,
  left:    { display: "flex", flexDirection: "column" as const } as React.CSSProperties,
  desc:    { fontSize: 14, color: "#999", lineHeight: 1.6, margin: 0 } as React.CSSProperties,
  nl:      { display: "grid", gridTemplateColumns: "180px 200px 1fr", gap: 16, padding: "14px 0", borderBottom: "1px solid #141414", alignItems: "start" } as React.CSSProperties,
  trigger: { fontSize: 13, color: "#c4b5fd", fontWeight: 500 } as React.CSSProperties,
  badge:   { display: "inline-block", fontSize: 11, background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 4, padding: "2px 7px", color: "#777", fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" } as React.CSSProperties,
  cron:    { display: "grid", gridTemplateColumns: "200px 200px 1fr", gap: 16, padding: "14px 0", borderBottom: "1px solid #141414", alignItems: "start" } as React.CSSProperties,
  cronName:{ fontSize: 13, color: "#86efac", fontWeight: 500 } as React.CSSProperties,
  time:    { fontSize: 12, color: "#555" } as React.CSSProperties,
  smart:   { display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, padding: "14px 0", borderBottom: "1px solid #141414" } as React.CSSProperties,
  smartN:  { fontSize: 13, color: "#fbbf24", fontWeight: 500 } as React.CSSProperties,
  skipR:   { display: "grid", gridTemplateColumns: "80px 1fr", gap: 16, padding: "14px 0", borderBottom: "1px solid #141414" } as React.CSSProperties,
  skipKey: { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 13, color: "#f87171", fontWeight: 500 } as React.CSSProperties,
  footer:  { marginTop: 64, paddingTop: 24, borderTop: "1px solid #1a1a1a", fontSize: 12, color: "#3a3a3a" } as React.CSSProperties,
} as const

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <p style={S.eyebrow}>Kivo / Rex</p>
        <h1 style={S.title}>Feature Guide</h1>
        <p style={S.sub}>Everything Rex can do — commands, natural language, and auto-scheduled messages.</p>
      </div>

      {/* Commands */}
      <section style={S.section}>
        <p style={S.sh}>Commands</p>
        <div style={S.grid}>
          {COMMANDS.map(c => (
            <div key={c.cmd} style={S.row}>
              <div style={S.left}>
                <span style={S.cmd}>{c.cmd}</span>
                <span style={S.eg}>{c.example}</span>
              </div>
              <p style={S.desc}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Setup */}
      <section style={S.section}>
        <p style={S.sh}>Setup Commands</p>
        <div style={S.grid}>
          {SETUP_COMMANDS.map(c => (
            <div key={c.cmd} style={S.row}>
              <div style={S.left}>
                <span style={S.cmd}>{c.cmd}</span>
                <span style={S.eg}>{c.example}</span>
              </div>
              <p style={S.desc}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Reminders */}
      <section style={S.section}>
        <p style={S.sh}>Reminder Commands</p>
        <div style={S.grid}>
          {REMINDER_COMMANDS.map(c => (
            <div key={c.cmd} style={S.row}>
              <div style={S.left}>
                <span style={S.cmd}>{c.cmd}</span>
                <span style={S.eg}>{c.example}</span>
              </div>
              <p style={S.desc}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Natural Language */}
      <section style={S.section}>
        <p style={S.sh}>Natural Language — No Commands Needed</p>
        <div style={S.grid}>
          {NL_FEATURES.map(f => (
            <div key={f.trigger} style={S.nl}>
              <span style={S.trigger}>{f.trigger}</span>
              <span style={{ ...S.badge }}>{f.example}</span>
              <p style={S.desc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Auto-Scheduled */}
      <section style={S.section}>
        <p style={S.sh}>Auto-Scheduled Messages</p>
        <p style={{ ...S.desc, marginBottom: 16 }}>These fire automatically. No input needed.</p>
        <div style={S.grid}>
          {AUTO_CRONS.map(c => (
            <div key={c.name} style={S.cron}>
              <span style={S.cronName}>{c.name}</span>
              <span style={S.time}>{c.time}</span>
              <p style={S.desc}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Smart Session */}
      <section style={S.section}>
        <p style={S.sh}>Smart Session Features</p>
        <div style={S.grid}>
          {SMART_SESSION.map(f => (
            <div key={f.name} style={S.smart}>
              <span style={S.smartN}>{f.name}</span>
              <p style={S.desc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Skip Handling */}
      <section style={S.section}>
        <p style={S.sh}>Skip & Injury Handling</p>
        <p style={{ ...S.desc, marginBottom: 16 }}>Say "can't train today" — Rex asks for a reason.</p>
        <div style={S.grid}>
          {SKIP_HANDLING.map(s => (
            <div key={s.reason} style={S.skipR}>
              <span style={S.skipKey}>{s.reason}</span>
              <p style={S.desc}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer style={S.footer}>
        Kivo · Rex Gym Coaching · All data belongs to the user
      </footer>

    </div>
  )
}

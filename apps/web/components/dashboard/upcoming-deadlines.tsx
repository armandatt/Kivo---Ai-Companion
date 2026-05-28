interface Deadline {
  id: string
  title: string
  dueAt: string
}

function formatDue(dueAt: string): { label: string; overdue: boolean } {
  const diff = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000)
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, overdue: true }
  if (diff === 0) return { label: "Today", overdue: false }
  if (diff === 1) return { label: "Tomorrow", overdue: false }
  if (diff <= 7) return { label: `${diff}d`, overdue: false }
  return {
    label: new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    overdue: false,
  }
}

interface UpcomingDeadlinesProps {
  deadlines: Deadline[]
}

export default function UpcomingDeadlines({ deadlines }: UpcomingDeadlinesProps) {
  if (!deadlines.length) return null

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      <p style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
        Upcoming Deadlines
      </p>
      <div>
        {deadlines.slice(0, 3).map((d, i, arr) => {
          const { label, overdue } = formatDue(d.dueAt)
          return (
            <div
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "13px 0",
                borderBottom: i < arr.length - 1 ? "1px solid #2A2A2A" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "3px",
                    height: "16px",
                    borderRadius: "2px",
                    backgroundColor: overdue ? "#F59E0B" : "#2A2A2A",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: "14px", color: "#FFFFFF", fontWeight: 500 }}>
                  {d.title}
                </span>
              </div>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: overdue ? "#F59E0B" : "#888888",
                  backgroundColor: overdue ? "rgba(245, 158, 11, 0.08)" : "transparent",
                  border: overdue ? "1px solid rgba(245, 158, 11, 0.2)" : "none",
                  padding: overdue ? "2px 8px" : "0",
                  borderRadius: "4px",
                  flexShrink: 0,
                }}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

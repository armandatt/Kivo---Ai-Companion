import { TELEGRAM_BOT_URL } from "@/lib/telegram"

interface LastMessageProps {
  message: { text: string; timestamp: string } | null
  personaName: string | null
}

function truncate(text: string, max = 180): string {
  const lines = text.split("\n").slice(0, 2).join(" ")
  return lines.length > max ? lines.slice(0, max) + "…" : lines
}

export default function LastMessage({ message, personaName }: LastMessageProps) {
  const name = personaName?.toUpperCase() ?? "KEVO"

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      {/* Companion header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <div
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "50%",
            backgroundColor: "rgba(0, 245, 160, 0.1)",
            border: "1px solid rgba(0, 245, 160, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
            fontWeight: 700,
            color: "#00F5A0",
            flexShrink: 0,
          }}
        >
          {name.charAt(0)}
        </div>
        <div>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.2 }}>
            {name}
          </p>
          {message ? (
            <p style={{ fontSize: "11px", color: "#888888", margin: 0 }}>
              {new Date(message.timestamp).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          ) : (
            <p style={{ fontSize: "11px", color: "#888888", margin: 0 }}>Your companion</p>
          )}
        </div>
      </div>

      {/* Message body */}
      {message ? (
        <>
          <p
            style={{
              fontSize: "14px",
              color: "#888888",
              margin: "0 0 16px",
              lineHeight: 1.6,
            }}
          >
            {truncate(message.text)}
          </p>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
          >
            Continue conversation →
          </a>
        </>
      ) : (
        <>
          <p
            style={{
              fontSize: "14px",
              color: "#888888",
              margin: "0 0 16px",
              lineHeight: 1.6,
            }}
          >
            No conversation yet. Open Telegram to start talking with your companion.
          </p>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
          >
            Start conversation →
          </a>
        </>
      )}
    </div>
  )
}

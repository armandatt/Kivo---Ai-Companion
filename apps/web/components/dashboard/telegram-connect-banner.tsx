"use client"

import { useState } from "react"

export default function TelegramConnectBanner() {
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)

  const handleConnect = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/telegram/generate-token", { method: "POST" })
      if (!res.ok) return
      const data = (await res.json()) as { deeplink?: string }
      if (data.deeplink) {
        window.open(data.deeplink, "_blank", "noopener,noreferrer")
        setConnected(true)
      }
    } finally {
      setLoading(false)
    }
  }

  if (connected) return null

  return (
    <div
      style={{
        backgroundColor: "#141414",
        border: "1px solid #1E3A2F",
        borderRadius: "12px",
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            backgroundColor: "#0D2B20",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#00F5A0">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.61c-.153.683-.554.85-1.123.528l-3.1-2.284-1.496 1.44c-.165.165-.304.304-.624.304l.223-3.163 5.756-5.196c.25-.223-.054-.347-.389-.124L7.19 14.354l-3.06-.956c-.665-.208-.679-.665.138-.985l11.96-4.611c.553-.2 1.037.135.334.446z" />
          </svg>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#FFFFFF" }}>
            Connect your Telegram companion
          </p>
          <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#888888", lineHeight: 1.4 }}>
            Get daily check-ins, track goals, and chat with your companion directly in Telegram.
          </p>
        </div>
      </div>
      <button
        onClick={handleConnect}
        disabled={loading}
        style={{
          padding: "9px 20px",
          borderRadius: "20px",
          backgroundColor: "#00F5A0",
          color: "#0D0D0D",
          border: "none",
          fontSize: "13px",
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
          whiteSpace: "nowrap",
          flexShrink: 0,
          transition: "opacity 0.15s",
        }}
      >
        {loading ? "Opening..." : "Connect Telegram →"}
      </button>
    </div>
  )
}

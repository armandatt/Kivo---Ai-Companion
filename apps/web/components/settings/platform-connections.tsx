"use client"

import { useState } from "react"
import { TELEGRAM_BOT_URL } from "@/lib/telegram"

interface Platform {
  connected: boolean
  handle: string | null
  broken: boolean
}

interface Props {
  platforms: {
    telegram: Platform
    whatsapp: Platform
  }
}

export default function PlatformConnections({ platforms }: Props) {
  const [telegramConnecting, setTelegramConnecting] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(platforms.telegram.connected)
  const [deeplink, setDeeplink] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  async function handleTelegramConnect() {
    setTelegramConnecting(true)
    setDeeplink(null)
    setConnectError(null)
    try {
      const res = await fetch("/api/telegram/generate-token", { method: "POST" })
      if (!res.ok) {
        setConnectError("Couldn't generate link. Try again.")
        return
      }
      const data = (await res.json()) as { deeplink?: string }
      if (data.deeplink) {
        setDeeplink(data.deeplink)
      } else {
        setConnectError("No link returned. Try again.")
      }
    } catch {
      setConnectError("Something went wrong. Try again.")
    } finally {
      setTelegramConnecting(false)
    }
  }

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 20px" }}>
        Platform connections
      </p>

      {connectError && (
        <p style={{ fontSize: "12px", color: "#EF4444", marginBottom: "12px" }}>{connectError}</p>
      )}

      {deeplink && (
        <div
          style={{
            backgroundColor: "rgba(0, 245, 160, 0.05)",
            border: "1px solid rgba(0, 245, 160, 0.2)",
            borderRadius: "8px",
            padding: "12px 14px",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "12px", color: "#888888" }}>
            Click to open Telegram and connect
          </span>
          <a
            href={deeplink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setTelegramConnected(true)}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#00F5A0",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Open Telegram →
          </a>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        <PlatformRow
          name="Telegram"
          icon={<TelegramIcon />}
          platform={{ ...platforms.telegram, connected: telegramConnected }}
          onConnect={handleTelegramConnect}
          connecting={telegramConnecting}
        />
        <div style={{ height: "1px", backgroundColor: "#2A2A2A", margin: "0" }} />
        <PlatformRow
          name="WhatsApp"
          icon={<WhatsAppIcon />}
          platform={platforms.whatsapp}
          comingSoon
        />
      </div>
    </div>
  )
}

function PlatformRow({
  name,
  icon,
  platform,
  comingSoon,
  onConnect,
  connecting,
}: {
  name: string
  icon: React.ReactNode
  platform: Platform
  comingSoon?: boolean
  onConnect?: () => void
  connecting?: boolean
}) {
  const dotColor = platform.broken
    ? "#EF4444"
    : platform.connected
    ? "#00F5A0"
    : "#555555"

  return (
    <div>
      {platform.broken && (
        <div
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.25)",
            borderRadius: "8px",
            padding: "10px 14px",
            marginBottom: "12px",
            display: "flex",
            gap: "10px",
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontSize: "13px", color: "#F59E0B", fontWeight: 600 }}>
            Connection lost —
          </span>
          <span style={{ fontSize: "13px", color: "#888888" }}>
            Reconnect {name} to resume check-ins.
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 0",
        }}
      >
        <div style={{ color: "#888888", flexShrink: 0 }}>{icon}</div>

        <div
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: dotColor,
            boxShadow: platform.connected && !platform.broken ? "0 0 6px #00F5A0" : "none",
            flexShrink: 0,
          }}
        />

        <div style={{ flex: 1 }}>
          <span style={{ fontSize: "14px", color: platform.connected ? "#FFFFFF" : "#888888" }}>
            {platform.connected && platform.handle
              ? platform.handle
              : comingSoon
              ? "Coming soon"
              : platform.connected
              ? "Connected"
              : "Not connected"}
          </span>
          <span
            style={{
              display: "block",
              fontSize: "11px",
              color: "#555555",
              marginTop: "1px",
            }}
          >
            {name}
          </span>
        </div>

        {!comingSoon && (
          <div style={{ display: "flex", gap: "8px" }}>
            {platform.connected ? (
              <GhostButton label="Open chat" onClick={() => window.open(TELEGRAM_BOT_URL, "_blank", "noopener,noreferrer")} />
            ) : (
              <GhostButton
                label={connecting ? "Opening…" : "Connect"}
                accent
                onClick={onConnect}
                disabled={connecting}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GhostButton({
  label,
  accent,
  onClick,
  disabled,
}: {
  label: string
  accent?: boolean
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 14px",
        fontSize: "12px",
        fontWeight: 500,
        color: accent ? "#00F5A0" : "#888888",
        backgroundColor: "transparent",
        border: `1px solid ${accent ? "rgba(0, 245, 160, 0.3)" : "#2A2A2A"}`,
        borderRadius: "6px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        whiteSpace: "nowrap" as const,
        transition: "color 0.12s, border-color 0.12s, opacity 0.12s",
      }}
    >
      {label}
    </button>
  )
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 5L2 12.5l7 1M21 5l-2.5 15L9 13.5M21 5L9 13.5m0 0V19l3.5-3" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  )
}

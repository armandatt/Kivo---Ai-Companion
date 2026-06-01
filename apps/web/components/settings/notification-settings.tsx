"use client"

import { useState, useRef } from "react"

interface Props {
  browserNotifications: boolean
  emailDigest: boolean
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: "relative",
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        backgroundColor: checked ? "#00F5A0" : "#2A2A2A",
        border: "none",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background-color 0.15s",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "18px" : "2px",
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          backgroundColor: checked ? "#0D0D0D" : "#666666",
          transition: "left 0.15s, background-color 0.15s",
        }}
      />
    </button>
  )
}

export default function NotificationSettings({ browserNotifications, emailDigest }: Props) {
  const [browser, setBrowser] = useState(browserNotifications)
  const [digest, setDigest] = useState(emailDigest)
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function persist(updates: { browserNotifications?: boolean; emailDigest?: boolean }) {
    try {
      await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setSaved(true)
      saveTimer.current = setTimeout(() => setSaved(false), 2000)
    } catch {
      // silent — non-critical
    }
  }

  function toggleBrowser() {
    const next = !browser
    setBrowser(next)
    persist({ browserNotifications: next })
  }

  function toggleDigest() {
    const next = !digest
    setDigest(next)
    persist({ emailDigest: next })
  }

  const rows = [
    { label: "Browser notifications", checked: browser, onChange: toggleBrowser },
    { label: "Email digest", checked: digest, onChange: toggleDigest },
  ]

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: 0 }}>
          Notifications
        </p>
        {saved && (
          <span style={{ fontSize: "11px", color: "#00F5A0", fontWeight: 500 }}>Saved</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 0",
              borderBottom: i < rows.length - 1 ? "1px solid #222222" : "none",
            }}
          >
            <span style={{ fontSize: "13px", color: "#CCCCCC" }}>{row.label}</span>
            <Toggle checked={row.checked} onChange={row.onChange} />
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: "12px",
          color: "#888888",
          fontStyle: "italic",
          margin: "16px 0 0",
          lineHeight: 1.55,
        }}
      >
        Check-in frequency is set by talking to your companion directly.
      </p>
    </div>
  )
}

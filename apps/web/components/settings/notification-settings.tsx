"use client"

import { useState } from "react"

const TOGGLES = [
  { key: "daily", label: "Daily check-in reminders", defaultOn: true },
  { key: "weekly", label: "Weekly review notifications", defaultOn: true },
  { key: "streak", label: "Streak milestone alerts", defaultOn: true },
  { key: "deadlines", label: "Goal deadline alerts", defaultOn: true },
]

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

export default function NotificationSettings() {
  const [states, setStates] = useState<Record<string, boolean>>(
    Object.fromEntries(TOGGLES.map((t) => [t.key, t.defaultOn]))
  )

  function toggle(key: string) {
    setStates((prev) => ({ ...prev, [key]: !prev[key] }))
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
        Notifications
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {TOGGLES.map((t, i) => (
          <div
            key={t.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 0",
              borderBottom: i < TOGGLES.length - 1 ? "1px solid #222222" : "none",
            }}
          >
            <span style={{ fontSize: "13px", color: "#CCCCCC" }}>{t.label}</span>
            <Toggle checked={states[t.key]} onChange={() => toggle(t.key)} />
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
        Notification frequency is set by talking to your companion directly.
      </p>
    </div>
  )
}

"use client"

import { useState } from "react"

interface CreatureSettingsProps {
  name: string
  type: string | null
}

export default function CreatureSettings({ name, type }: CreatureSettingsProps) {
  const [value, setValue] = useState(name !== "Your Creature" ? name : "")
  const [isFocused, setIsFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await fetch("/api/creature-rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
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
        Settings
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {/* Rename */}
        <div>
          <label
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#888888",
              display: "block",
              marginBottom: "8px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Name
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder={name}
              maxLength={50}
              style={{
                flex: 1,
                backgroundColor: "#2A2A2A",
                border: isFocused ? "1px solid #00F5A0" : "1px solid #333333",
                borderRadius: "6px",
                padding: "9px 12px",
                fontSize: "14px",
                color: "#FFFFFF",
                outline: "none",
                transition: "border-color 0.15s",
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !value.trim()}
              style={{
                padding: "9px 18px",
                fontSize: "13px",
                fontWeight: 600,
                color: saved ? "#0D0D0D" : "#FFFFFF",
                backgroundColor: saved ? "#00F5A0" : "transparent",
                border: "1px solid #333333",
                borderRadius: "6px",
                cursor: saving || !value.trim() ? "not-allowed" : "pointer",
                opacity: saving || !value.trim() ? 0.45 : 1,
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              {saved ? "Saved" : saving ? "Saving…" : "Rename"}
            </button>
          </div>
        </div>

        {/* Naming ceremony link */}
        <a
          href="/onboarding"
          style={{ fontSize: "13px", color: "#00F5A0", textDecoration: "none" }}
        >
          View naming ceremony →
        </a>

        {/* Type (read-only) */}
        {type && (
          <div>
            <label
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "#888888",
                display: "block",
                marginBottom: "6px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Type
            </label>
            <span style={{ fontSize: "14px", color: "#888888" }}>{type}</span>
          </div>
        )}
      </div>
    </div>
  )
}

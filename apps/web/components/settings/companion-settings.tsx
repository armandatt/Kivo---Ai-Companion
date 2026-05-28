"use client"

import { useState } from "react"

const PERSONAS = [
  { key: "rex", name: "Rex", description: "Hard and direct" },
  { key: "nova", name: "Nova", description: "Warm and calm" },
  { key: "vera", name: "Vera", description: "Structured and precise" },
  { key: "zen", name: "Zen", description: "Philosophical and mindful" },
  { key: "spark", name: "Spark", description: "High-energy and motivating" },
  { key: "compass", name: "Compass", description: "Strategic and guiding" },
  { key: "anchor", name: "Anchor", description: "Stable and grounding" },
  { key: "lingua", name: "Lingua", description: "Adaptive and perceptive" },
]

const ACCOUNTABILITY_STYLES = [
  { key: "hard", label: "Hard" },
  { key: "soft", label: "Soft" },
  { key: "dynamic", label: "Dynamic" },
]

const LANGUAGES = [
  "English", "Hindi", "Spanish", "French", "German",
  "Portuguese", "Japanese", "Arabic", "Mandarin", "Russian",
]

const TIME_OPTIONS: string[] = []
for (let h = 5; h <= 23; h++) {
  const hh = h.toString().padStart(2, "0")
  TIME_OPTIONS.push(`${hh}:00`, `${hh}:30`)
}

function formatTime(t: string): string {
  const [hh, mm] = t.split(":")
  const h = parseInt(hh, 10)
  const ampm = h < 12 ? "AM" : "PM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${mm} ${ampm}`
}

interface Props {
  persona: string | null
  checkInTime: string | null
  accountabilityStyle: string | null
  tier: string
}

export default function CompanionSettings({ persona, checkInTime, accountabilityStyle, tier }: Props) {
  const [selectedPersona, setSelectedPersona] = useState(persona ?? "nova")
  const [selectedTime, setSelectedTime] = useState(checkInTime ?? "09:00")
  const [selectedStyle, setSelectedStyle] = useState(accountabilityStyle ?? "dynamic")
  const [selectedLanguage, setSelectedLanguage] = useState("English")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: selectedPersona,
          checkInTime: selectedTime,
          accountabilityStyle: selectedStyle,
        }),
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
        Companion
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Persona grid */}
        <div>
          <label style={labelStyle}>Persona</label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "8px",
            }}
          >
            {PERSONAS.map((p) => {
              const isSelected = selectedPersona === p.key
              const isLocked = tier === "free" && !isSelected
              return (
                <div
                  key={p.key}
                  onClick={() => !isLocked && setSelectedPersona(p.key)}
                  style={{
                    backgroundColor: "#2A2A2A",
                    border: isSelected ? "1.5px solid #00F5A0" : "1.5px solid transparent",
                    borderRadius: "8px",
                    padding: "10px",
                    cursor: isLocked ? "default" : "pointer",
                    opacity: isLocked ? 0.5 : 1,
                    transition: "border-color 0.15s, opacity 0.15s",
                  }}
                >
                  <p
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      margin: "0 0 3px",
                    }}
                  >
                    {p.name}
                  </p>
                  <p style={{ fontSize: "10px", color: "#888888", margin: 0, lineHeight: 1.35 }}>
                    {p.description}
                  </p>
                  {isLocked && (
                    <p style={{ fontSize: "9px", color: "#00F5A0", fontWeight: 600, margin: "6px 0 0" }}>
                      Pro only →
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Check-in time */}
        <div>
          <label style={labelStyle}>Check-in time</label>
          <p style={{ fontSize: "11px", color: "#888888", margin: "0 0 10px" }}>
            Pick a time that actually works, not an optimistic one.
          </p>
          <select
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            style={{
              backgroundColor: "#2A2A2A",
              border: "1px solid #333333",
              borderRadius: "6px",
              padding: "9px 12px",
              fontSize: "14px",
              color: "#00F5A0",
              outline: "none",
              cursor: "pointer",
              width: "160px",
            }}
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t} style={{ backgroundColor: "#2A2A2A", color: "#FFFFFF" }}>
                {formatTime(t)}
              </option>
            ))}
          </select>
        </div>

        {/* Accountability style */}
        <div>
          <label style={labelStyle}>Accountability style</label>
          <div style={{ display: "flex", gap: "6px" }}>
            {ACCOUNTABILITY_STYLES.map((s) => {
              const isActive = selectedStyle === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setSelectedStyle(s.key)}
                  style={{
                    padding: "7px 20px",
                    borderRadius: "20px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: isActive ? 600 : 400,
                    backgroundColor: isActive ? "#00F5A0" : "#2A2A2A",
                    color: isActive ? "#0D0D0D" : "#888888",
                    transition: "background-color 0.15s, color 0.15s",
                  }}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Language */}
        <div>
          <label style={labelStyle}>Language</label>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            style={{
              backgroundColor: "#2A2A2A",
              border: "1px solid #333333",
              borderRadius: "6px",
              padding: "9px 12px",
              fontSize: "14px",
              color: "#00F5A0",
              outline: "none",
              cursor: "pointer",
              width: "200px",
            }}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang} style={{ backgroundColor: "#2A2A2A", color: "#FFFFFF" }}>
                {lang}
              </option>
            ))}
          </select>
        </div>

        {/* Save */}
        <div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "9px 24px",
              fontSize: "13px",
              fontWeight: 600,
              color: saved ? "#0D0D0D" : "#FFFFFF",
              backgroundColor: saved ? "#00F5A0" : "transparent",
              border: `1px solid ${saved ? "#00F5A0" : "#333333"}`,
              borderRadius: "6px",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
              transition: "all 0.2s",
            }}
          >
            {saved ? "Saved" : saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  fontSize: "10px",
  fontWeight: 600,
  color: "#888888",
  display: "block" as const,
  marginBottom: "8px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
}

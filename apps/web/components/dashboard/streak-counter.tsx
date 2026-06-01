"use client"

import { useEffect, useState } from "react"
import { TELEGRAM_BOT_URL } from "@/lib/telegram"

interface StreakCounterProps {
  current: number
  best: number
  broken: boolean
  skipUsed: boolean
}

export default function StreakCounter({ current, best, broken, skipUsed }: StreakCounterProps) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (current <= 0) { setDisplay(0); return }
    const duration = 900
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(ease * current))
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [current])

  /* Re-engagement — streak hasn't started yet */
  if (current === 0 && !broken) {
    return (
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "28px" }}>🌱</span>
        <p style={{ fontSize: "17px", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.3 }}>
          Start your streak today
        </p>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0, lineHeight: 1.55 }}>
          Complete your first workout to light the flame. Every legend starts at zero.
        </p>
        <a
          href={TELEGRAM_BOT_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            marginTop: "6px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#00F5A0",
            textDecoration: "none",
          }}
        >
          Tell Kevo on Telegram →
        </a>
      </div>
    )
  }

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "0",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", lineHeight: 1 }}>
            <span
              style={{
                fontSize: "64px",
                fontWeight: 900,
                color: "#FFFFFF",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {broken ? current : display}
            </span>
            <span style={{ fontSize: "15px", color: "#888888", fontWeight: 500, paddingBottom: "6px" }}>
              day streak
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "#888888", margin: "10px 0 0" }}>
            Best: {best} day{best !== 1 ? "s" : ""}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", paddingTop: "4px" }}>
          <span
            style={{
              fontSize: "36px",
              filter: broken ? "grayscale(1) opacity(0.4)" : "none",
              transition: "filter 0.3s ease",
            }}
          >
            🔥
          </span>
          {skipUsed && (
            <span
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "#F59E0B",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.25)",
                padding: "2px 6px",
                borderRadius: "4px",
                textTransform: "uppercase",
              }}
            >
              Skip used
            </span>
          )}
        </div>
      </div>

      {broken && (
        <div
          style={{
            marginTop: "16px",
            padding: "10px 12px",
            backgroundColor: "rgba(245, 158, 11, 0.06)",
            border: "1px solid rgba(245, 158, 11, 0.18)",
            borderRadius: "8px",
          }}
        >
          <p style={{ fontSize: "12px", color: "#F59E0B", margin: 0, lineHeight: 1.5 }}>
            Streak broken — start again today. Day 1 counts.
          </p>
        </div>
      )}
    </div>
  )
}

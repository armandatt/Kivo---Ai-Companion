"use client"

import { useState } from "react"

interface WeeklyReview {
  id: string
  weekLabel: string
  summary: string
  fullContent: string
  createdAt: string
}

interface WeeklyReviewArchiveProps {
  reviews: WeeklyReview[]
  tier: string
}

export default function WeeklyReviewArchive({ reviews, tier }: WeeklyReviewArchiveProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const isFree = tier === "free"
  const visibleReviews = isFree ? reviews.slice(0, 1) : reviews
  const lockedCount = isFree ? Math.max(0, reviews.length - 1) : 0

  return (
    <div
      style={{
        backgroundColor: "#1A1A1A",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 16px" }}>
        Weekly Reviews
      </p>

      {reviews.length === 0 ? (
        <p style={{ fontSize: "13px", color: "#444444", textAlign: "center", padding: "16px 0" }}>
          Weekly reviews will appear here after your first full week with Kevo.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {visibleReviews.map((review) => {
            const isExpanded = expandedId === review.id
            return (
              <div
                key={review.id}
                style={{ border: "1px solid #2A2A2A", borderRadius: "8px", overflow: "hidden" }}
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : review.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 16px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#888888",
                        display: "block",
                        marginBottom: "3px",
                      }}
                    >
                      {review.weekLabel}
                    </span>
                    <span style={{ fontSize: "13px", color: "#FFFFFF" }}>{review.summary}</span>
                  </div>
                  <span
                    style={{
                      fontSize: "16px",
                      color: "#555555",
                      display: "inline-block",
                      transform: isExpanded ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                    }}
                  >
                    ▾
                  </span>
                </button>
                {isExpanded && (
                  <div
                    style={{
                      padding: "0 16px 16px",
                      borderTop: "1px solid #2A2A2A",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#CCCCCC",
                        lineHeight: 1.6,
                        margin: "12px 0 0",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {review.fullContent}
                    </p>
                  </div>
                )}
              </div>
            )
          })}

          {lockedCount > 0 && (
            <div style={{ position: "relative" }}>
              <div style={{ filter: "blur(5px)", pointerEvents: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                {Array.from({ length: Math.min(lockedCount, 3) }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #2A2A2A",
                      borderRadius: "8px",
                      padding: "14px 16px",
                    }}
                  >
                    <span style={{ fontSize: "11px", color: "#888888", display: "block", marginBottom: "3px" }}>
                      Week of May 12
                    </span>
                    <span style={{ fontSize: "13px", color: "#FFFFFF" }}>
                      Strong week overall — 5 of 7 tasks completed.
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(26, 26, 26, 0.6)",
                  borderRadius: "8px",
                }}
              >
                <a
                  href="/dashboard/settings"
                  style={{ fontSize: "13px", fontWeight: 600, color: "#00F5A0", textDecoration: "none" }}
                >
                  Unlock 90 days →
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

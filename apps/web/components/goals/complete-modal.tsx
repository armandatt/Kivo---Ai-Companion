"use client"

interface CompleteModalProps {
  isOpen: boolean
  goalTitle: string
  onConfirm: () => void
  onClose: () => void
}

export default function CompleteModal({ isOpen, goalTitle, onConfirm, onClose }: CompleteModalProps) {
  if (!isOpen) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "16px",
          padding: "28px",
          maxWidth: "420px",
          width: "90%",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 8px" }}>
            Archive this goal?
          </p>
          <p style={{ fontSize: "13px", color: "#888888", margin: 0, lineHeight: 1.55 }}>
            &ldquo;{goalTitle}&rdquo;
          </p>
        </div>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0, lineHeight: 1.55 }}>
          This will move the goal to your archive. Tell Kevo to set a new one when you&apos;re ready.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              fontSize: "13px",
              fontWeight: 600,
              color: "#0D0D0D",
              backgroundColor: "#00F5A0",
              border: "none",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Archive goal
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              fontSize: "13px",
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

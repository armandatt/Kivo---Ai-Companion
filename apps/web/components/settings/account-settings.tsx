"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

const TIMEZONES = [
  "(UTC-12:00) International Date Line West",
  "(UTC-08:00) Pacific Time",
  "(UTC-07:00) Mountain Time",
  "(UTC-06:00) Central Time",
  "(UTC-05:00) Eastern Time",
  "(UTC-03:00) Buenos Aires",
  "(UTC+00:00) London",
  "(UTC+01:00) Paris, Berlin",
  "(UTC+02:00) Cairo",
  "(UTC+03:00) Moscow",
  "(UTC+05:30) Mumbai, Kolkata",
  "(UTC+07:00) Bangkok",
  "(UTC+08:00) Singapore, Beijing",
  "(UTC+09:00) Tokyo",
  "(UTC+10:00) Sydney",
  "(UTC+12:00) Auckland",
]

interface Props {
  email: string
  name: string
  isGoogleOAuth: boolean
  timezone: string | null
}

export default function AccountSettings({ email, name, isGoogleOAuth, timezone }: Props) {
  const router = useRouter()
  const [nameValue, setNameValue] = useState(name)
  const [nameFocused, setNameFocused] = useState(false)
  const [selectedTimezone, setSelectedTimezone] = useState(
    timezone ?? "(UTC+05:30) Mumbai, Kolkata"
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteInput, setDeleteInput] = useState("")
  const [deleting, setDeleting] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameValue, timezone: selectedTimezone }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAccount() {
    if (deleteInput !== "DELETE") return
    setDeleting(true)
    try {
      await fetch("/api/delete-account", { method: "DELETE" })
      window.location.href = "/"
    } catch {
      setDeleting(false)
    }
  }

  return (
    <>
      <div
        style={{
          backgroundColor: "#1A1A1A",
          border: "1px solid #2A2A2A",
          borderRadius: "12px",
          padding: "20px",
        }}
      >
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 20px" }}>
          Account
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Display name</label>
            <input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="Your name"
              style={{
                width: "100%",
                boxSizing: "border-box" as const,
                backgroundColor: "#2A2A2A",
                border: nameFocused ? "1px solid #00F5A0" : "1px solid #333333",
                borderRadius: "6px",
                padding: "9px 12px",
                fontSize: "14px",
                color: "#FFFFFF",
                outline: "none",
                transition: "border-color 0.15s",
              }}
            />
          </div>

          {/* Email */}
          <div>
            <label style={labelStyle}>Email</label>
            <div style={{ position: "relative" }}>
              <input
                value={email}
                readOnly
                style={{
                  width: "100%",
                  boxSizing: "border-box" as const,
                  backgroundColor: "#1E1E1E",
                  border: "1px solid #2A2A2A",
                  borderRadius: "6px",
                  padding: "9px 40px 9px 12px",
                  fontSize: "14px",
                  color: "#555555",
                  outline: "none",
                  cursor: "default",
                }}
              />
              {isGoogleOAuth && (
                <div
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#555555",
                  }}
                >
                  <LockIcon />
                </div>
              )}
            </div>
            {isGoogleOAuth && (
              <p style={{ fontSize: "11px", color: "#555555", margin: "6px 0 0" }}>
                Managed by Google OAuth.
              </p>
            )}
          </div>

          {/* Timezone */}
          <div>
            <label style={labelStyle}>Timezone</label>
            <select
              value={selectedTimezone}
              onChange={(e) => setSelectedTimezone(e.target.value)}
              style={{
                width: "100%",
                backgroundColor: "#2A2A2A",
                border: "1px solid #333333",
                borderRadius: "6px",
                padding: "9px 12px",
                fontSize: "14px",
                color: "#FFFFFF",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} style={{ backgroundColor: "#2A2A2A" }}>
                  {tz}
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

          {/* Divider */}
          <div style={{ height: "1px", backgroundColor: "#2A2A2A" }} />

          {/* Danger zone */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 3px" }}>
                Export my data
              </p>
              <p style={{ fontSize: "11px", color: "#888888", margin: 0 }}>
                Download a copy of your goals, logs, and history.
              </p>
            </div>
            <button
              style={{
                padding: "7px 16px",
                fontSize: "12px",
                fontWeight: 500,
                color: "#FFFFFF",
                backgroundColor: "transparent",
                border: "1px solid #333333",
                borderRadius: "6px",
                cursor: "pointer",
                whiteSpace: "nowrap" as const,
              }}
            >
              Export
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#EF4444", margin: "0 0 3px" }}>
                Delete account
              </p>
              <p style={{ fontSize: "11px", color: "#888888", margin: 0 }}>
                Permanently remove your account and all data.
              </p>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              style={{
                padding: "7px 16px",
                fontSize: "12px",
                fontWeight: 500,
                color: "#EF4444",
                backgroundColor: "transparent",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                borderRadius: "6px",
                cursor: "pointer",
                whiteSpace: "nowrap" as const,
              }}
            >
              Delete account
            </button>
          </div>
        </div>
      </div>

      {/* Delete modal */}
      {showDeleteModal && (
        <div
          onClick={() => setShowDeleteModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
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
              borderRadius: "12px",
              padding: "28px",
              width: "400px",
              maxWidth: "90vw",
            }}
          >
            <p
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "#FFFFFF",
                margin: "0 0 8px",
              }}
            >
              Delete account
            </p>
            <p style={{ fontSize: "13px", color: "#888888", margin: "0 0 20px", lineHeight: 1.55 }}>
              This will permanently delete your account, goals, streak history, and all data. This
              cannot be undone.
            </p>
            <p style={{ fontSize: "12px", color: "#888888", margin: "0 0 8px" }}>
              Type <span style={{ color: "#FFFFFF", fontWeight: 600 }}>DELETE</span> to confirm.
            </p>
            <input
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box" as const,
                backgroundColor: "#2A2A2A",
                border: "1px solid #333333",
                borderRadius: "6px",
                padding: "9px 12px",
                fontSize: "14px",
                color: "#FFFFFF",
                outline: "none",
                marginBottom: "16px",
              }}
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteInput("")
                }}
                style={{
                  padding: "8px 18px",
                  fontSize: "13px",
                  color: "#888888",
                  backgroundColor: "transparent",
                  border: "1px solid #2A2A2A",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteInput !== "DELETE" || deleting}
                style={{
                  padding: "8px 18px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  backgroundColor: "#EF4444",
                  border: "none",
                  borderRadius: "6px",
                  cursor: deleteInput !== "DELETE" || deleting ? "not-allowed" : "pointer",
                  opacity: deleteInput !== "DELETE" ? 0.35 : deleting ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
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

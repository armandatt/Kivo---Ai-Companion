"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Bell } from "lucide-react"
import { KivoLogoWithWordmark } from "@/components/KivoLogo"

const PAGE_TITLES: Array<[string, string, boolean]> = [
  ["/dashboard/goals", "Goals", false],
  ["/dashboard/plan", "Planner", false],
  ["/dashboard/deadlines", "Deadlines", false],
  ["/dashboard/progress", "Insights", false],
  ["/dashboard/creature", "Creature", false],
  ["/dashboard/upgrade", "Upgrade", false],
  ["/dashboard/settings", "Settings", false],
  ["/dashboard", "Home", true],
]

interface Props {
  user: { name: string | null; email: string; image: string | null }
  tier: string
  hasUnread: boolean
  telegramConnected: boolean
  telegramDeeplink: string | null
  whatsappConnected: boolean
}

export default function TopBar({
  user,
  hasUnread,
  telegramConnected,
  telegramDeeplink,
  whatsappConnected,
}: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [telegramUrl, setTelegramUrl] = useState(telegramDeeplink)
  const [isGeneratingTelegramLink, setIsGeneratingTelegramLink] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const pageTitle =
    PAGE_TITLES.find(([path, , exact]) => (exact ? pathname === path : pathname.startsWith(path)))?.[1] ??
    "Dashboard"

  const showBothButtons = telegramConnected && whatsappConnected
  const onlyWhatsapp = !telegramConnected && whatsappConnected

  useEffect(() => {
    setTelegramUrl(telegramDeeplink)
  }, [telegramDeeplink])

  const handleTelegramClick = async () => {
    if (telegramConnected && telegramUrl) {
      window.open(telegramUrl, "_blank", "noopener,noreferrer")
      return
    }

    setIsGeneratingTelegramLink(true)
    try {
      const res = await fetch("/api/telegram/generate-token", { method: "POST" })
      if (!res.ok) return

      const data = (await res.json()) as { deeplink?: string }
      if (data.deeplink) {
        setTelegramUrl(data.deeplink)
        window.open(data.deeplink, "_blank", "noopener,noreferrer")
      }
    } finally {
      setIsGeneratingTelegramLink(false)
    }
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    await fetch("/api/logout", { method: "POST" })
    setDropdownOpen(false)
    router.push("/")
    router.refresh()
  }

  useEffect(() => {
    if (!dropdownOpen) return
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [dropdownOpen])

  return (
    <header
      style={{
        height: "60px",
        minHeight: "60px",
        borderBottom: "1px solid #2A2A2A",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        backgroundColor: "#111111",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Left */}
      <div>
        {/* Desktop: page title */}
        <h2
          className="kevo-desktop-only"
          style={{ fontSize: "16px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}
        >
          {pageTitle}
        </h2>
        {/* Mobile: logo */}
        <div className="kevo-mobile-only" style={{ display: "none" }}>
          <KivoLogoWithWordmark size={26} />
        </div>
      </div>

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Messenger buttons — desktop only */}
        <div className="kevo-desktop-only" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {onlyWhatsapp ? (
            <PlatformButton href="https://wa.me/" label="Open WhatsApp" primary />
          ) : showBothButtons ? (
            <>
              <PlatformButton
                label={isGeneratingTelegramLink ? "Preparing..." : "Telegram"}
                onClick={handleTelegramClick}
                primary
              />
              <PlatformButton href="https://wa.me/" label="WhatsApp" />
            </>
          ) : (
            <PlatformButton
              label={
                isGeneratingTelegramLink
                  ? "Preparing..."
                  : telegramConnected
                    ? "Open Telegram →"
                    : "Connect Telegram →"
              }
              onClick={handleTelegramClick}
              primary
            />
          )}
        </div>

        {/* Bell */}
        <button
          style={{
            position: "relative",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "6px",
            color: "#FFFFFF",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Bell size={18} strokeWidth={2} />
          {hasUnread && (
            <span
              style={{
                position: "absolute",
                top: "4px",
                right: "4px",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#00F5A0",
                boxShadow: "0 0 4px #00F5A0",
              }}
            />
          )}
        </button>

        {/* Avatar + dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <UserAvatar user={user} size={32} />
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                backgroundColor: "#1A1A1A",
                border: "1px solid #2A2A2A",
                borderRadius: "10px",
                minWidth: "190px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                overflow: "hidden",
                zIndex: 50,
              }}
            >
              {/* User info */}
              <div style={{ padding: "12px 16px 10px" }}>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 2px" }}>
                  {user.name?.split(" ")[0] ?? user.email.split("@")[0]}
                </p>
                <p
                  style={{
                    fontSize: "11px",
                    color: "#888888",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {user.email}
                </p>
              </div>
              <div style={{ height: "1px", backgroundColor: "#2A2A2A" }} />
              <DropdownLink href="/dashboard/settings" onClick={() => setDropdownOpen(false)}>
                Settings
              </DropdownLink>
              <div style={{ height: "1px", backgroundColor: "#2A2A2A" }} />
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={handleLogout}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 16px",
                  fontSize: "13px",
                  color: "#888888",
                  background: "none",
                  border: "none",
                  cursor: isLoggingOut ? "default" : "pointer",
                  textAlign: "left",
                  opacity: isLoggingOut ? 0.7 : 1,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
              >
                {isLoggingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function PlatformButton({
  href,
  label,
  primary,
  onClick,
}: {
  href?: string
  label: string
  primary?: boolean
  onClick?: () => void
}) {
  const commonStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 18px",
    borderRadius: "20px",
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
    backgroundColor: primary ? "#00F5A0" : "transparent",
    color: primary ? "#0D0D0D" : "#888888",
    border: primary ? "none" : "1px solid #333333",
    whiteSpace: "nowrap",
    transition: "opacity 0.15s",
  } as const

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...commonStyle,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        ...commonStyle,
      }}
    >
      {label}
    </a>
  )
}

function DropdownLink({
  href,
  onClick,
  children,
}: {
  href: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: "block",
        padding: "10px 16px",
        fontSize: "13px",
        color: "#CCCCCC",
        textDecoration: "none",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.backgroundColor = "transparent")
      }
    >
      {children}
    </Link>
  )
}

function UserAvatar({
  user,
  size,
}: {
  user: { name: string | null; email: string; image: string | null }
  size: number
}) {
  const initial = ((user.name ?? user.email).charAt(0) ?? "?").toUpperCase()

  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
      />
    )
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: "#2A2A2A",
        border: "1px solid #3A3A3A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.4) + "px",
        fontWeight: 700,
        color: "#FFFFFF",
      }}
    >
      {initial}
    </div>
  )
}

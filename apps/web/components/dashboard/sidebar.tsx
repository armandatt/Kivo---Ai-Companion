"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Target, Calendar, BarChart2, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { KivoLogoWithWordmark } from "@/components/KivoLogo"

const STAGE_EMOJI: Record<string, string> = {
  egg: "🥚",
  hatchling: "🐣",
  creature: "🦎",
  beast: "🐲",
  legend: "🐉",
}

type BadgeType = "streak" | "goals" | "planner" | "insights-dot" | "evolution-dot" | null

type NavItemDef = {
  href: string
  label: string
  exact?: boolean
  Icon: LucideIcon | null
  emoji?: true
  badgeType: BadgeType
}

const NAV_ITEMS: NavItemDef[] = [
  { href: "/dashboard", label: "Home", exact: true, Icon: Home, badgeType: "streak" },
  { href: "/dashboard/goals", label: "Goals", Icon: Target, badgeType: "goals" },
  { href: "/dashboard/plan", label: "Planner", Icon: Calendar, badgeType: "planner" },
  { href: "/dashboard/progress", label: "Insights", Icon: BarChart2, badgeType: "insights-dot" },
  { href: "/dashboard/creature", label: "Creature", Icon: null, emoji: true, badgeType: "evolution-dot" },
  { href: "/dashboard/settings", label: "Settings", Icon: Settings, badgeType: null },
]

interface Props {
  streakCount: number
  activeGoalCount: number
  overdueCount: number
  hasUnreadReviews: boolean
  evolutionAvailable: boolean
  creatureStage: string
  user: { name: string | null; email: string; image: string | null }
  tier: string
}

export default function Sidebar({
  streakCount,
  activeGoalCount,
  overdueCount,
  hasUnreadReviews,
  evolutionAvailable,
  creatureStage,
  user,
  tier,
}: Props) {
  const pathname = usePathname()
  const [hovered, setHovered] = useState<string | null>(null)
  const creatureEmoji = STAGE_EMOJI[creatureStage] ?? "🥚"

  function active(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  function getBadge(badgeType: BadgeType): React.ReactNode {
    if (badgeType === "streak" && streakCount > 0) return <CountBadge n={streakCount} />
    if (badgeType === "goals" && activeGoalCount > 0) return <CountBadge n={activeGoalCount} />
    if (badgeType === "planner" && overdueCount > 0) return <CountBadge n={overdueCount} amber />
    if (badgeType === "insights-dot" && hasUnreadReviews) return <DotBadge />
    if (badgeType === "evolution-dot" && evolutionAvailable) return <DotBadge />
    return null
  }

  return (
    <nav
      style={{
        width: "240px",
        minWidth: "240px",
        height: "100vh",
        backgroundColor: "#111111",
        borderRight: "1px solid #2A2A2A",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "22px 20px 24px" }}>
        <KivoLogoWithWordmark size={28} />
      </div>

      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: "2px 0" }}>
        {NAV_ITEMS.map(({ href, label, exact, Icon, emoji, badgeType }) => {
          const isActive = active(href, exact)
          const isHov = hovered === href
          const badge = getBadge(badgeType)

          return (
            <Link
              key={href}
              href={href}
              onMouseEnter={() => setHovered(href)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "9px 14px 9px 13px",
                textDecoration: "none",
                borderLeft: isActive ? "3px solid #00F5A0" : "3px solid transparent",
                backgroundColor: isActive
                  ? "#1A1A1A"
                  : isHov
                  ? "rgba(255, 255, 255, 0.03)"
                  : "transparent",
                color: isActive ? "#FFFFFF" : isHov ? "#CCCCCC" : "#888888",
                fontSize: "14px",
                fontWeight: isActive ? 600 : 400,
                transition: "background-color 0.12s, color 0.12s, border-color 0.12s",
              }}
            >
              {emoji ? (
                <span
                  style={{
                    fontSize: "16px",
                    lineHeight: 1,
                    opacity: isActive ? 1 : 0.6,
                    flexShrink: 0,
                  }}
                >
                  {creatureEmoji}
                </span>
              ) : Icon ? (
                <Icon
                  size={15}
                  strokeWidth={isActive ? 2.5 : 2}
                  style={{ opacity: isActive ? 1 : 0.6, flexShrink: 0 }}
                />
              ) : null}
              <span style={{ flex: 1 }}>{label}</span>
              {badge}
            </Link>
          )
        })}
      </div>

      {/* User footer */}
      <div style={{ padding: "14px 16px 18px", borderTop: "1px solid #2A2A2A" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: tier === "free" ? "10px" : "0",
          }}
        >
          <UserAvatar user={user} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#FFFFFF",
                margin: "0 0 3px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.name?.split(" ")[0] ?? user.email.split("@")[0]}
            </p>
            <TierPill tier={tier} />
          </div>
        </div>
        {tier === "free" && (
          <Link
            href="/dashboard/upgrade"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#00F5A0",
              textDecoration: "none",
              display: "block",
            }}
          >
            Upgrade →
          </Link>
        )}
      </div>
    </nav>
  )
}

function CountBadge({ n, amber }: { n: number; amber?: boolean }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 700,
        backgroundColor: amber ? "#F59E0B" : "#00F5A0",
        color: "#0D0D0D",
        padding: "1px 6px",
        borderRadius: "10px",
        minWidth: "18px",
        textAlign: "center",
        lineHeight: "16px",
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  )
}

function DotBadge() {
  return (
    <span
      style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: "#00F5A0",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
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
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
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
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  )
}

function TierPill({ tier }: { tier: string }) {
  const color = tier === "elite" ? "#FFFFFF" : tier === "pro" ? "#00F5A0" : "#888888"
  const borderColor = tier === "elite" ? "#FFFFFF" : tier === "pro" ? "#00F5A0" : "#555555"
  return (
    <span
      style={{
        fontSize: "9px",
        fontWeight: 700,
        color,
        border: `1px solid ${borderColor}`,
        padding: "1px 6px",
        borderRadius: "10px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        display: "inline-block",
      }}
    >
      {tier}
    </span>
  )
}

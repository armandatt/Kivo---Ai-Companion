"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  Target,
  Calendar,
  BarChart2,
  Settings,
  Dumbbell,
} from "lucide-react"
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

const NOVA_TOP_NAV: NavItemDef[] = [
  { href: "/dashboard",          label: "Home",     exact: true, Icon: Home,     badgeType: "streak" },
  { href: "/dashboard/goals",    label: "Goals",                 Icon: Target,   badgeType: "goals" },
  { href: "/dashboard/plan",     label: "Planner",               Icon: Calendar, badgeType: "planner" },
  { href: "/dashboard/progress", label: "Insights",              Icon: BarChart2,badgeType: "insights-dot" },
]

const NOVA_PERSONA_NAV: NavItemDef[] = [
  { href: "/dashboard/creature", label: "Companion", Icon: null, emoji: true, badgeType: "evolution-dot" },
]

const REX_TOP_NAV: NavItemDef[] = [
  { href: "/dashboard",          label: "Home",     exact: true, Icon: Home,      badgeType: "streak" },
  { href: "/dashboard/goals",    label: "Goals",                 Icon: Target,    badgeType: "goals" },
  { href: "/dashboard/progress", label: "Training",              Icon: Dumbbell,  badgeType: null },
]

const REX_PERSONA_NAV: NavItemDef[] = []

interface Props {
  streakCount:       number
  activeGoalCount:   number
  overdueCount:      number
  hasUnreadReviews:  boolean
  evolutionAvailable: boolean
  creatureStage:     string
  persona:           string
  user:              { name: string | null; email: string; image: string | null }
  tier:              string
}

export default function Sidebar({
  streakCount,
  activeGoalCount,
  overdueCount,
  hasUnreadReviews,
  evolutionAvailable,
  creatureStage,
  persona,
  user,
  tier,
}: Props) {
  const pathname       = usePathname()
  const [hovered, setHovered] = useState<string | null>(null)
  const creatureEmoji  = STAGE_EMOJI[creatureStage] ?? "🥚"

  const isRex    = persona === "rex"
  const ACCENT   = isRex ? "#00F5A0" : "#7C3AED"
  const ACCENT_BG = isRex ? "rgba(0,245,160,0.08)" : "rgba(124,58,237,0.10)"

  const topNav     = isRex ? REX_TOP_NAV     : NOVA_TOP_NAV
  const personaNav = isRex ? REX_PERSONA_NAV : NOVA_PERSONA_NAV
  const sectionLabel = isRex ? "REX" : "NOVA"

  function active(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  function getBadge(badgeType: BadgeType): React.ReactNode {
    if (badgeType === "streak"        && streakCount > 0)      return <CountBadge n={streakCount} accent={ACCENT} />
    if (badgeType === "goals"         && activeGoalCount > 0)  return <CountBadge n={activeGoalCount} accent={ACCENT} />
    if (badgeType === "planner"       && overdueCount > 0)     return <CountBadge n={overdueCount} amber />
    if (badgeType === "insights-dot"  && hasUnreadReviews)     return <DotBadge accent={ACCENT} />
    if (badgeType === "evolution-dot" && evolutionAvailable)   return <DotBadge accent={ACCENT} />
    return null
  }

  function NavItem({ href, label, exact, Icon, emoji, badgeType }: NavItemDef) {
    const isActive = active(href, exact)
    const isHov    = hovered === href
    const badge    = getBadge(badgeType)

    return (
      <Link
        href={href}
        onMouseEnter={() => setHovered(href)}
        onMouseLeave={() => setHovered(null)}
        style={{
          display:         "flex",
          alignItems:      "center",
          gap:             "10px",
          padding:         "9px 14px 9px 13px",
          textDecoration:  "none",
          borderLeft:      isActive ? `3px solid ${ACCENT}` : "3px solid transparent",
          backgroundColor: isActive ? ACCENT_BG : isHov ? "rgba(255,255,255,0.03)" : "transparent",
          color:           isActive ? "#FFFFFF"  : isHov ? "#CCCCCC" : "#888888",
          fontSize:        "14px",
          fontWeight:      isActive ? 600 : 400,
          transition:      "background-color 0.12s, color 0.12s, border-color 0.12s",
        }}
      >
        {emoji ? (
          <span style={{ fontSize: "16px", lineHeight: 1, opacity: isActive ? 1 : 0.6, flexShrink: 0 }}>
            {creatureEmoji}
          </span>
        ) : Icon ? (
          <Icon size={15} strokeWidth={isActive ? 2.5 : 2} style={{ opacity: isActive ? 1 : 0.6, flexShrink: 0 }} />
        ) : null}
        <span style={{ flex: 1 }}>{label}</span>
        {badge}
      </Link>
    )
  }

  return (
    <nav
      style={{
        width:           "240px",
        minWidth:        "240px",
        height:          "100vh",
        backgroundColor: "#111111",
        borderRight:     "1px solid #2A2A2A",
        display:         "flex",
        flexDirection:   "column",
        flexShrink:      0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "22px 20px 24px" }}>
        <KivoLogoWithWordmark size={28} />
      </div>

      {/* Top nav items */}
      <div style={{ padding: "2px 0" }}>
        {topNav.map((item) => <NavItem key={item.href} {...item} />)}
      </div>

      {/* Persona section */}
      <div style={{ margin: "16px 0 4px", padding: "0 16px" }}>
        <p
          style={{
            fontSize:      "10px",
            fontWeight:    700,
            letterSpacing: "0.12em",
            color:         ACCENT,
            margin:        0,
            textTransform: "uppercase",
            opacity:       0.8,
          }}
        >
          {sectionLabel}
        </p>
      </div>
      <div style={{ padding: "2px 0", flex: 1 }}>
        {personaNav.map((item) => <NavItem key={item.href} {...item} />)}
        {personaNav.length === 0 && (
          <p style={{ fontSize: "12px", color: "#444", padding: "6px 16px", margin: 0 }}>
            {isRex ? "Gym dashboard →" : ""}
          </p>
        )}
      </div>

      {/* Settings always at bottom of flex */}
      <div>
        <NavItem
          href="/dashboard/settings"
          label="Settings"
          Icon={Settings}
          badgeType={null}
        />
      </div>

      {/* User footer */}
      <div style={{ padding: "14px 16px 18px", borderTop: "1px solid #2A2A2A" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: tier === "free" ? "10px" : "0" }}>
          <UserAvatar user={user} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize:      "13px",
                fontWeight:    600,
                color:         "#FFFFFF",
                margin:        "0 0 3px",
                overflow:      "hidden",
                textOverflow:  "ellipsis",
                whiteSpace:    "nowrap",
              }}
            >
              {user.name?.split(" ")[0] ?? user.email.split("@")[0]}
            </p>
            <TierPill tier={tier} accent={ACCENT} />
          </div>
        </div>
        {tier === "free" && (
          <Link
            href="/dashboard/upgrade"
            style={{ fontSize: "12px", fontWeight: 600, color: ACCENT, textDecoration: "none", display: "block" }}
          >
            Upgrade →
          </Link>
        )}
      </div>
    </nav>
  )
}

function CountBadge({ n, amber, accent = "#00F5A0" }: { n: number; amber?: boolean; accent?: string }) {
  return (
    <span
      style={{
        fontSize:        "10px",
        fontWeight:      700,
        backgroundColor: amber ? "#F59E0B" : accent,
        color:           "#0D0D0D",
        padding:         "1px 6px",
        borderRadius:    "10px",
        minWidth:        "18px",
        textAlign:       "center",
        lineHeight:      "16px",
        flexShrink:      0,
      }}
    >
      {n}
    </span>
  )
}

function DotBadge({ accent = "#00F5A0" }: { accent?: string }) {
  return (
    <span
      style={{
        width:           "6px",
        height:          "6px",
        borderRadius:    "50%",
        backgroundColor: accent,
        display:         "inline-block",
        flexShrink:      0,
      }}
    />
  )
}

function UserAvatar({ user, size }: { user: { name: string | null; email: string; image: string | null }; size: number }) {
  const initial = ((user.name ?? user.email).charAt(0) ?? "?").toUpperCase()

  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    )
  }

  return (
    <div
      style={{
        width:           size,
        height:          size,
        borderRadius:    "50%",
        backgroundColor: "#2A2A2A",
        border:          "1px solid #3A3A3A",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        fontSize:        Math.round(size * 0.4) + "px",
        fontWeight:      700,
        color:           "#FFFFFF",
        flexShrink:      0,
      }}
    >
      {initial}
    </div>
  )
}

function TierPill({ tier, accent = "#00F5A0" }: { tier: string; accent?: string }) {
  const color       = tier === "elite" ? "#FFFFFF" : tier === "pro" ? accent : "#888888"
  const borderColor = tier === "elite" ? "#FFFFFF" : tier === "pro" ? accent : "#555555"
  return (
    <span
      style={{
        fontSize:        "9px",
        fontWeight:      700,
        color,
        border:          `1px solid ${borderColor}`,
        padding:         "1px 6px",
        borderRadius:    "10px",
        letterSpacing:   "0.08em",
        textTransform:   "uppercase",
        display:         "inline-block",
      }}
    >
      {tier}
    </span>
  )
}

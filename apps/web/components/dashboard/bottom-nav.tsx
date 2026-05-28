"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Target, Calendar, Settings } from "lucide-react"

const STAGE_EMOJI: Record<string, string> = {
  egg: "🥚",
  hatchling: "🐣",
  creature: "🦎",
  beast: "🐲",
  legend: "🐉",
}

interface Props {
  creatureStage: string
}

export default function BottomNav({ creatureStage }: Props) {
  const pathname = usePathname()
  const creatureEmoji = STAGE_EMOJI[creatureStage] ?? "🥚"

  const tabs = [
    { href: "/dashboard", label: "Home", exact: true, icon: "home" as const },
    { href: "/dashboard/goals", label: "Goals", icon: "goals" as const },
    { href: "/dashboard/plan", label: "Planner", icon: "planner" as const },
    { href: "/dashboard/creature", label: "Creature", icon: "creature" as const },
    { href: "/dashboard/settings", label: "Settings", icon: "settings" as const },
  ]

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <nav
      className="kevo-bottom-nav"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "60px",
        backgroundColor: "#111111",
        borderTop: "1px solid #2A2A2A",
        display: "none",
        alignItems: "center",
        justifyContent: "space-around",
        zIndex: 50,
      }}
    >
      {tabs.map(({ href, label, icon, exact }) => {
        const active = isActive(href, exact)
        const color = active ? "#00F5A0" : "#888888"

        return (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              textDecoration: "none",
              color,
              fontSize: "10px",
              fontWeight: active ? 600 : 400,
              padding: "8px 12px",
              minWidth: "56px",
            }}
          >
            {icon === "creature" ? (
              <span style={{ fontSize: "20px", lineHeight: 1, opacity: active ? 1 : 0.55 }}>
                {creatureEmoji}
              </span>
            ) : icon === "home" ? (
              <Home size={20} strokeWidth={active ? 2.5 : 2} style={{ opacity: active ? 1 : 0.55 }} />
            ) : icon === "goals" ? (
              <Target size={20} strokeWidth={active ? 2.5 : 2} style={{ opacity: active ? 1 : 0.55 }} />
            ) : icon === "planner" ? (
              <Calendar size={20} strokeWidth={active ? 2.5 : 2} style={{ opacity: active ? 1 : 0.55 }} />
            ) : (
              <Settings size={20} strokeWidth={active ? 2.5 : 2} style={{ opacity: active ? 1 : 0.55 }} />
            )}
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

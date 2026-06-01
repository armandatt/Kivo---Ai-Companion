import { cookies } from "next/headers"
import CompanionSettings from "@/components/settings/companion-settings"
import PlatformConnections from "@/components/settings/platform-connections"
import AccountSettings from "@/components/settings/account-settings"
import NotificationSettings from "@/components/settings/notification-settings"

type Platform = { connected: boolean; handle: string | null; broken: boolean }

type SettingsData = {
  email: string
  name: string
  isGoogleOAuth: boolean
  persona: string | null
  checkInTime: string | null
  accountabilityStyle: string | null
  timezone: string | null
  tier: string
  browserNotifications: boolean
  emailDigest: boolean
  platforms: { telegram: Platform; whatsapp: Platform }
}

async function fetchSettings(): Promise<SettingsData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/settings`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function SettingsPage() {
  const data = await fetchSettings()

  const fallback: SettingsData = {
    email: "",
    name: "",
    isGoogleOAuth: false,
    persona: null,
    checkInTime: null,
    accountabilityStyle: null,
    timezone: null,
    tier: "free",
    browserNotifications: true,
    emailDigest: true,
    platforms: {
      telegram: { connected: false, handle: null, broken: false },
      whatsapp: { connected: false, handle: null, broken: false },
    },
  }

  const s = data ?? fallback

  return (
    <div style={{ maxWidth: "720px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          Settings
        </h1>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          Manage your companion, connections, and account.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <CompanionSettings
          persona={s.persona}
          checkInTime={s.checkInTime}
          accountabilityStyle={s.accountabilityStyle}
          tier={s.tier}
        />

        <PlatformConnections platforms={s.platforms} />

        <AccountSettings
          email={s.email}
          name={s.name}
          isGoogleOAuth={s.isGoogleOAuth}
          timezone={s.timezone}
        />

        <NotificationSettings
          browserNotifications={s.browserNotifications}
          emailDigest={s.emailDigest}
        />
      </div>
    </div>
  )
}

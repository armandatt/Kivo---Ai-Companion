import { cookies } from "next/headers"
import TierComparisonTable from "@/components/upgrade/tier-comparison-table"
import UsageMeter from "@/components/upgrade/usage-meter"

type UsageData = { messagesUsedToday: number; messagesLimit: number; tier: string }

async function fetchUsage(): Promise<UsageData> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return { messagesUsedToday: 0, messagesLimit: 50, tier: "free" }

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const res = await fetch(`${apiUrl}/api/usage`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: "no-store",
    })
    if (!res.ok) return { messagesUsedToday: 0, messagesLimit: 50, tier: "free" }
    return res.json()
  } catch {
    return { messagesUsedToday: 0, messagesLimit: 50, tier: "free" }
  }
}

export default async function UpgradePage() {
  const usage = await fetchUsage()

  return (
    <div style={{ maxWidth: "860px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          Plans
        </h1>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          You&apos;re on the free plan. Upgrade to unlock the full Kevo experience.
        </p>
      </div>

      <UsageMeter
        used={usage.messagesUsedToday}
        limit={usage.messagesLimit}
        tier={usage.tier}
      />

      <div style={{ height: "20px" }} />

      <TierComparisonTable currentTier={usage.tier as "free" | "pro" | "elite"} />
    </div>
  )
}

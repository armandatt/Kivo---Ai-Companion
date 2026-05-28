import TierComparisonTable from "@/components/upgrade/tier-comparison-table"
import UsageMeter from "@/components/upgrade/usage-meter"

export default function UpgradePage() {
  return (
    <div style={{ maxWidth: "860px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#FFFFFF", margin: "0 0 4px" }}>
          Plans
        </h1>
        <p style={{ fontSize: "13px", color: "#888888", margin: 0 }}>
          You're on the free plan. Upgrade to unlock the full Kevo experience.
        </p>
      </div>

      <UsageMeter used={0} limit={50} tier="free" />

      <div style={{ height: "20px" }} />

      <TierComparisonTable currentTier="free" />
    </div>
  )
}

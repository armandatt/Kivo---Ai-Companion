import { KioTile } from "@/components/brand/kio-brand"

/** Kio's app icon (the orbit mark on its white tile). The identity lives in components/brand. */
export function KioLogo({ size = 40 }: { size?: number }) {
  return <KioTile size={size} />
}

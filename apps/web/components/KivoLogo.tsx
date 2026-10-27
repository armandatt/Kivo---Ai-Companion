import { KivoTile } from "@/components/brand/kivo-brand"

/** Kivo's app icon (the orbit mark on its white tile). The identity lives in components/brand. */
export function KivoLogo({ size = 40 }: { size?: number }) {
  return <KivoTile size={size} />
}

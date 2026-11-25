import type { Metadata } from 'next'
import { PortableMaps } from '@/components/nova/portable/portable-maps'

export const metadata: Metadata = { title: 'Import a map' }

export default function ImportMapPage() {
  return <PortableMaps mode="import" />
}

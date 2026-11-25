import type { Metadata } from 'next'
import { PortableMaps } from '@/components/nova/portable/portable-maps'

export const metadata: Metadata = { title: 'Share your map' }

export default function ShareMapPage() {
  return <PortableMaps mode="share" />
}
